// server.js — Main Express server

require('dotenv').config();
const express        = require('express');
const session        = require('express-session');
const SqliteStore    = require('connect-sqlite3')(session);
const rateLimit      = require('express-rate-limit');
const path           = require('path');
const {
  init, upsertUser, getUser, updatePreferences, setEnabled, deleteUser,
} = require('./db');
const {
  exchangeCodeForTokens, getActivityWithRetry, updateActivityDescription,
  createWebhookSubscription, listWebhookSubscriptions,
} = require('./strava');
const { generateDescription } = require('./ai');

const app  = express();
const PORT = process.env.PORT || 3000;

// Marker we add to enriched descriptions — lets us detect already-enriched activities
const ENRICHMENT_MARKER = '✨ —';

// Trust reverse proxy (Railway, Render, Cloudflare) so req.ip is the real client IP
// and secure cookies work behind HTTPS terminators
app.set('trust proxy', 1);

// ── Rate limiters ──────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: 'Too many requests, please try again later.',
});

const enrichLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  message: 'Slow down — max 5 enrichments per minute.',
});

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(session({
  store:  new SqliteStore({ db: 'sessions.db', dir: path.join(__dirname, '..') }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === 'production', // HTTPS only in prod
    httpOnly: true,                                  // JS can't read it (XSS protection)
    sameSite: 'lax',                                 // blocks CSRF on POST endpoints
    maxAge:   7 * 24 * 60 * 60 * 1000,
  },
}));

// ── Auth middleware ────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.athleteId) return res.redirect('/');
  next();
}

function requireAdmin(req, res, next) {
  if (req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// ══════════════════════════════════════════════════════════════════════════════
// STRAVA OAUTH
// ══════════════════════════════════════════════════════════════════════════════

app.get('/auth/strava', authLimiter, (req, res) => {
  const scope    = 'read,activity:read_all,activity:write';
  const redirect = `${process.env.APP_URL}/auth/strava/callback`;
  const url = `https://www.strava.com/oauth/authorize?client_id=${process.env.STRAVA_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=${scope}`;
  res.redirect(url);
});

app.get('/auth/strava/callback', authLimiter, async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?error=auth_failed');

  try {
    const data    = await exchangeCodeForTokens(code);
    const athlete = data.athlete;

    await upsertUser({
      athlete_id:    athlete.id,
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      token_expires: data.expires_at,
      firstname:     athlete.firstname,
      lastname:      athlete.lastname,
      profile_pic:   athlete.profile_medium,
    });

    req.session.athleteId = athlete.id;
    res.redirect('/dashboard.html');
  } catch (err) {
    console.error('OAuth callback error:', err.response?.data || err.message);
    res.redirect('/?error=token_exchange_failed');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ══════════════════════════════════════════════════════════════════════════════
// STRAVA WEBHOOK
// ══════════════════════════════════════════════════════════════════════════════

// Strava verifies our endpoint first with a GET
app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === process.env.STRAVA_VERIFY_TOKEN) {
    console.log('✅ Webhook verified by Strava');
    return res.json({ 'hub.challenge': challenge });
  }
  res.status(403).json({ error: 'Forbidden' });
});

// Strava POSTs here on new activities AND on deauthorization
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // always respond immediately — Strava retries if we're slow

  const event = req.body;
  const athleteId = event.owner_id;

  // ── Deauth: user revoked our access on Strava — delete their data ────────────
  if (event.object_type === 'athlete' &&
      event.aspect_type === 'update' &&
      event.updates?.authorized === 'false') {
    console.log(`🚪 Athlete ${athleteId} deauthorized — deleting user record`);
    try { await deleteUser(athleteId); } catch (e) { console.error('Deauth cleanup failed:', e.message); }
    return;
  }

  // ── New activity ─────────────────────────────────────────────────────────────
  if (event.object_type !== 'activity' || event.aspect_type !== 'create') return;

  const activityId = event.object_id;

  try {
    const user = await getUser(athleteId);
    if (!user)         { console.log(`⚠️  Athlete ${athleteId} not connected`); return; }
    if (!user.enabled) { console.log(`⏸️  Enrichment paused for ${athleteId}`); return; }

    await enrichActivity(user, activityId);
  } catch (err) {
    console.error(`❌ Error on activity ${activityId}:`, err.response?.data || err.message);
  }
});

// Shared enrichment logic — used by webhook and manual enrich
// Dedup is via the marker in the description itself — if we see it, skip.
// This means: a failed enrichment can be safely retried by Strava's webhook
// retries, and a user clicking "Enrich" twice never double-enriches.
async function enrichActivity(user, activityId) {
  const athleteId = user.athlete_id;
  console.log(`🏃 Enriching activity ${activityId} for athlete ${athleteId}`);

  const activity = await getActivityWithRetry(athleteId, activityId);

  // Sport filter
  const type = activity.type?.toLowerCase() || '';
  if (user.sport_focus === 'run'  && !type.includes('run'))  { console.log('⏭️  Sport filter skip'); return null; }
  if (user.sport_focus === 'ride' && !type.includes('ride')) { console.log('⏭️  Sport filter skip'); return null; }

  // Dedup: if description already has our marker, it's been enriched before
  const existing = (activity.description || '').trim();
  if (existing.includes(ENRICHMENT_MARKER)) {
    console.log(`⏭️  Activity ${activityId} already enriched — skipping`);
    return null;
  }

  const aiText    = await generateDescription(activity, user.tone || 'playful', existing);
  const finalDesc = existing ? `${existing}\n\n${ENRICHMENT_MARKER}\n${aiText}` : `${ENRICHMENT_MARKER}\n${aiText}`;

  await updateActivityDescription(athleteId, activityId, finalDesc);
  console.log(`✅ Updated activity ${activityId}`);
  return finalDesc;
}

// ══════════════════════════════════════════════════════════════════════════════
// API ROUTES
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/me', requireAuth, async (req, res) => {
  const user = await getUser(req.session.athleteId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { access_token, refresh_token, ...safe } = user;
  res.json(safe);
});

app.post('/api/preferences', requireAuth, async (req, res) => {
  const { tone, sport_focus } = req.body;
  if (!['playful','motivational','stats'].includes(tone) ||
      !['all','run','ride'].includes(sport_focus)) {
    return res.status(400).json({ error: 'Invalid preferences' });
  }
  await updatePreferences(req.session.athleteId, tone, sport_focus);
  res.json({ success: true });
});

app.post('/api/toggle', requireAuth, async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean' });
  await setEnabled(req.session.athleteId, enabled);
  res.json({ success: true, enabled });
});

app.post('/api/enrich', requireAuth, enrichLimiter, async (req, res) => {
  const { activityId } = req.body;
  if (!activityId) return res.status(400).json({ error: 'activityId required' });

  try {
    const user        = await getUser(req.session.athleteId);
    const description = await enrichActivity(user, activityId);

    if (description === null) {
      return res.status(200).json({
        success: false,
        alreadyEnriched: true,
        message: 'This activity has already been enriched or doesn\'t match your sport filter.',
      });
    }
    res.json({ success: true, description });
  } catch (err) {
    console.error('Manual enrich error:', err.response?.data || err.message);
    // Don't leak internal error details to the client
    res.status(500).json({ error: 'Failed to enrich activity. Please try again.' });
  }
});

// ── Admin routes (protected by ADMIN_SECRET) ───────────────────────────────────
app.post('/api/admin/register-webhook', requireAdmin, async (req, res) => {
  try {
    const result = await createWebhookSubscription(
      `${process.env.APP_URL}/webhook`,
      process.env.STRAVA_VERIFY_TOKEN
    );
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

app.get('/api/admin/webhook-status', requireAdmin, async (req, res) => {
  res.json(await listWebhookSubscriptions());
});

app.get('/healthz', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── Start ──────────────────────────────────────────────────────────────────────
init().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 StravaAI running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});

// server.js — Main Express server
// Handles: Strava OAuth login, webhook events, user dashboard API

require('dotenv').config();
const express        = require('express');
const session        = require('express-session');
const path           = require('path');
const { init, upsertUser, getUser, updatePreferences } = require('./db');
const { exchangeCodeForTokens, getActivity, updateActivityDescription,
        createWebhookSubscription, listWebhookSubscriptions } = require('./strava');
const { generateDescription } = require('./claude');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
}));

// ── Auth middleware ────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.athleteId) return res.redirect('/');
  next();
}

// ══════════════════════════════════════════════════════════════════════════════
// STRAVA OAUTH ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// Step 1: Redirect user to Strava to approve the app
app.get('/auth/strava', (req, res) => {
  const scope    = 'read,activity:read_all,activity:write';
  const redirect = `${process.env.APP_URL}/auth/strava/callback`;
  const url = `https://www.strava.com/oauth/authorize?client_id=${process.env.STRAVA_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=${scope}`;
  res.redirect(url);
});

// Step 2: Strava redirects back here with a code
app.get('/auth/strava/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    console.error('OAuth error:', error);
    return res.redirect('/?error=auth_failed');
  }

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

// Log out
app.get('/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ══════════════════════════════════════════════════════════════════════════════
// STRAVA WEBHOOK ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// Strava verifies our webhook endpoint with a GET request first
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.STRAVA_VERIFY_TOKEN) {
    console.log('✅ Webhook verified by Strava');
    return res.json({ 'hub.challenge': challenge });
  }
  res.status(403).json({ error: 'Forbidden' });
});

// Strava POSTs here whenever a user creates/updates an activity
app.post('/webhook', async (req, res) => {
  // Always respond 200 immediately — Strava will retry if we're slow
  res.sendStatus(200);

  const event = req.body;
  console.log('📨 Webhook event:', JSON.stringify(event));

  // We only care about new activity creations
  if (event.object_type !== 'activity' || event.aspect_type !== 'create') return;

  const athleteId  = event.owner_id;
  const activityId = event.object_id;

  try {
    const user = await getUser(athleteId);
    if (!user) {
      console.log(`⚠️  Athlete ${athleteId} is not connected — ignoring`);
      return;
    }

    // Check sport filter preference
    const activityType = event.updates?.type?.toLowerCase() || '';
    if (user.sport_focus === 'run' && !activityType.includes('run')) return;
    if (user.sport_focus === 'ride' && !activityType.includes('ride')) return;

    console.log(`🏃 Processing activity ${activityId} for athlete ${athleteId}`);

    // Small delay — Strava sometimes needs a moment before the activity is fully available
    await new Promise(r => setTimeout(r, 3000));

    const activity = await getActivity(athleteId, activityId);

    // Apply sport filter based on full activity data
    if (user.sport_focus === 'run' && !activity.type?.toLowerCase().includes('run')) return;
    if (user.sport_focus === 'ride' && !activity.type?.toLowerCase().includes('ride')) return;

    const aiText = await generateDescription(
      activity,
      user.tone || 'playful',
      activity.description || ''
    );

    const existingDesc = (activity.description || '').trim();
    const separator    = existingDesc ? '\n\n✨ —\n' : '';
    const finalDesc    = `${existingDesc}${separator}${aiText}`;

    await updateActivityDescription(athleteId, activityId, finalDesc);
    console.log(`✅ Updated activity ${activityId} for athlete ${athleteId}`);

  } catch (err) {
    console.error(`❌ Error processing activity ${activityId}:`, err.response?.data || err.message);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// API ROUTES (used by the frontend dashboard)
// ══════════════════════════════════════════════════════════════════════════════

// Get the logged-in user's profile + preferences
app.get('/api/me', requireAuth, async (req, res) => {
  const user = await getUser(req.session.athleteId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { access_token, refresh_token, ...safe } = user;
  res.json(safe);
});

// Update user preferences
app.post('/api/preferences', requireAuth, async (req, res) => {
  const { tone, sport_focus } = req.body;
  const validTones  = ['playful', 'motivational', 'stats'];
  const validSports = ['all', 'run', 'ride'];

  if (!validTones.includes(tone) || !validSports.includes(sport_focus)) {
    return res.status(400).json({ error: 'Invalid preferences' });
  }

  await updatePreferences(req.session.athleteId, tone, sport_focus);
  res.json({ success: true });
});

// Manually enrich a past activity by ID
app.post('/api/enrich', requireAuth, async (req, res) => {
  const { activityId } = req.body;
  if (!activityId) return res.status(400).json({ error: 'activityId required' });

  try {
    const user     = await getUser(req.session.athleteId);
    const activity = await getActivity(req.session.athleteId, activityId);
    const aiText   = await generateDescription(activity, user.tone || 'playful', activity.description || '');

    const existingDesc = (activity.description || '').trim();
    const separator    = existingDesc ? '\n\n✨ —\n' : '';
    const finalDesc    = `${existingDesc}${separator}${aiText}`;

    await updateActivityDescription(req.session.athleteId, activityId, finalDesc);
    res.json({ success: true, description: finalDesc });
  } catch (err) {
    console.error('Manual enrich error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// Admin: register webhook with Strava (run once during setup)
app.post('/api/admin/register-webhook', async (req, res) => {
  if (req.query.secret !== process.env.SESSION_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
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

app.get('/api/admin/webhook-status', async (req, res) => {
  if (req.query.secret !== process.env.SESSION_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(await listWebhookSubscriptions());
});

// ── Start server ───────────────────────────────────────────────────────────────
init().then(() => {
  app.listen(PORT, () => {
    console.log(`
🚀 Strava Claude is running!
   Local:   http://localhost:${PORT}
   Webhook: ${process.env.APP_URL}/webhook
    `);
  });
}).catch(err => {
  console.error('Failed to initialise database:', err);
  process.exit(1);
});

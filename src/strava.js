// strava.js — All Strava API interactions
// Docs: https://developers.strava.com/docs/reference/

const axios = require('axios');
const { updateTokens, getUser } = require('./db');

const STRAVA_BASE = 'https://www.strava.com/api/v3';
const TOKEN_URL   = 'https://www.strava.com/oauth/token';

// ── Token refresh ─────────────────────────────────────────────────────────────
// Strava access tokens expire every 6 hours, so we refresh when needed

async function getFreshToken(athleteId) {
  const user = await getUser(athleteId);
  if (!user) throw new Error(`No user found for athlete ${athleteId}`);

  // If token still has 5+ minutes left, use it as-is
  const fiveMinutes = 5 * 60;
  if (user.token_expires > Math.floor(Date.now() / 1000) + fiveMinutes) {
    return user.access_token;
  }

  // Token is expiring — refresh it
  console.log(`🔄 Refreshing token for athlete ${athleteId}`);
  const res = await axios.post(TOKEN_URL, {
    client_id:     process.env.STRAVA_CLIENT_ID,
    client_secret: process.env.STRAVA_CLIENT_SECRET,
    grant_type:    'refresh_token',
    refresh_token: user.refresh_token,
  });

  const { access_token, refresh_token, expires_at } = res.data;
  await updateTokens(athleteId, access_token, refresh_token, expires_at);
  return access_token;
}

// ── Activity helpers ───────────────────────────────────────────────────────────

async function getActivity(athleteId, activityId) {
  const token = await getFreshToken(athleteId);
  const res = await axios.get(`${STRAVA_BASE}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

// Retries with backoff. Strava sometimes returns 404 right after creation, and
// 500s or network errors happen occasionally. We retry all transient errors.
async function getActivityWithRetry(athleteId, activityId, attempts = [1000, 4000, 10000]) {
  for (let i = 0; i <= attempts.length; i++) {
    try {
      return await getActivity(athleteId, activityId);
    } catch (err) {
      const status = err.response?.status;
      const isLast = i === attempts.length;
      // Transient = 404 (not ready), 5xx (Strava issue), or no response (network)
      const isTransient = status === 404 || (status >= 500 && status < 600) || !err.response;

      if (isLast || !isTransient) throw err;

      console.log(`⏳ Activity ${activityId} — transient error (${status || 'network'}), retrying in ${attempts[i]}ms...`);
      await new Promise(r => setTimeout(r, attempts[i]));
    }
  }
  // Unreachable — the loop either returns or throws
  throw new Error('getActivityWithRetry exhausted retries');
}

async function updateActivityDescription(athleteId, activityId, description) {
  const token = await getFreshToken(athleteId);
  const res = await axios.put(
    `${STRAVA_BASE}/activities/${activityId}`,
    { description },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data;
}

// ── OAuth exchange ─────────────────────────────────────────────────────────────
// After the user approves on Strava, we exchange the code for tokens

async function exchangeCodeForTokens(code) {
  const res = await axios.post(TOKEN_URL, {
    client_id:     process.env.STRAVA_CLIENT_ID,
    client_secret: process.env.STRAVA_CLIENT_SECRET,
    code,
    grant_type:    'authorization_code',
  });
  return res.data; // { access_token, refresh_token, expires_at, athlete }
}

// ── Webhook subscription ───────────────────────────────────────────────────────
// Register our webhook endpoint with Strava so they ping us on new activities

async function createWebhookSubscription(callbackUrl, verifyToken) {
  try {
    const res = await axios.post('https://www.strava.com/api/v3/push_subscriptions', {
      client_id:     process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      callback_url:  callbackUrl,
      verify_token:  verifyToken,
    });
    return res.data;
  } catch (err) {
    // Strava returns 409 if a subscription already exists
    if (err.response?.status === 409) {
      console.log('ℹ️  Webhook subscription already exists');
      return null;
    }
    throw err;
  }
}

async function listWebhookSubscriptions() {
  const res = await axios.get('https://www.strava.com/api/v3/push_subscriptions', {
    params: {
      client_id:     process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
    },
  });
  return res.data;
}

module.exports = {
  getActivity,
  getActivityWithRetry,
  updateActivityDescription,
  exchangeCodeForTokens,
  createWebhookSubscription,
  listWebhookSubscriptions,
};

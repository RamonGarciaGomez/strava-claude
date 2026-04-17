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
  updateActivityDescription,
  exchangeCodeForTokens,
  createWebhookSubscription,
  listWebhookSubscriptions,
};

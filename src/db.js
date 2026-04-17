// db.js — SQLite database via @libsql/client (works on all Node versions)
// Stores user tokens and preferences in a local file: data.db

const { createClient } = require('@libsql/client');
const path = require('path');

const db = createClient({
  url: `file:${path.join(__dirname, '..', 'data.db')}`,
});

// Run once at startup to create tables if they don't exist
async function init() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      athlete_id    INTEGER PRIMARY KEY,
      access_token  TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_expires INTEGER NOT NULL,
      firstname     TEXT,
      lastname      TEXT,
      profile_pic   TEXT,
      tone          TEXT DEFAULT 'playful',
      sport_focus   TEXT DEFAULT 'all',
      created_at    INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);
}

// ── User helpers ──────────────────────────────────────────────────────────────

async function upsertUser(athlete) {
  await db.execute({
    sql: `
      INSERT INTO users (athlete_id, access_token, refresh_token, token_expires, firstname, lastname, profile_pic)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(athlete_id) DO UPDATE SET
        access_token  = excluded.access_token,
        refresh_token = excluded.refresh_token,
        token_expires = excluded.token_expires,
        firstname     = excluded.firstname,
        lastname      = excluded.lastname,
        profile_pic   = excluded.profile_pic
    `,
    args: [
      athlete.athlete_id, athlete.access_token, athlete.refresh_token,
      athlete.token_expires, athlete.firstname, athlete.lastname, athlete.profile_pic,
    ],
  });
}

async function getUser(athleteId) {
  const result = await db.execute({
    sql: 'SELECT * FROM users WHERE athlete_id = ?',
    args: [athleteId],
  });
  return result.rows[0] || null;
}

async function updateTokens(athleteId, accessToken, refreshToken, tokenExpires) {
  await db.execute({
    sql: 'UPDATE users SET access_token = ?, refresh_token = ?, token_expires = ? WHERE athlete_id = ?',
    args: [accessToken, refreshToken, tokenExpires, athleteId],
  });
}

async function updatePreferences(athleteId, tone, sportFocus) {
  await db.execute({
    sql: 'UPDATE users SET tone = ?, sport_focus = ? WHERE athlete_id = ?',
    args: [tone, sportFocus, athleteId],
  });
}

module.exports = { init, upsertUser, getUser, updateTokens, updatePreferences };

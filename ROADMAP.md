# 🗺️ StravaAI — Code Audit & Roadmap

> Deep review of the codebase as of April 2026. What's working, what's broken, and the path to a professional, publicly-hosted product.

---

## 🎯 Vision

Ship a polished, public version of StravaAI hosted at a subdomain of Ramon's personal website — where anyone can sign up with their Strava account and start getting AI-enriched activity descriptions automatically. No install, no setup, just click-and-go.

---

## ✅ What's working

- **OAuth flow** — Strava login, token storage, automatic token refresh are all solid
- **Webhook handler** — responds 200 immediately (Strava best practice), then processes async
- **Multi-provider AI** — elegant fallback from Gemini → OpenAI → Claude by cost
- **Unit conversions** — clean helpers for meters→miles, seconds→pace, etc.
- **Dashboard UI** — clean, on-brand, the toggle + live previews feel professional
- **Separation of concerns** — `server.js` / `ai.js` / `strava.js` / `db.js` split is clean
- **README** — clearly explains what the project does

---

## 🐛 Bugs / Issues Found

### Critical (fix before any public use)

1. **Invalid Claude model name** (`src/ai.js:136`)
   `claude-haiku-4-5` is not a real model. Should be `claude-haiku-4-5` only works if that's actually released — but right now the safe value is `claude-3-5-haiku-latest`.

2. **Sessions stored in memory** (`src/server.js:20`)
   `express-session` without a store uses in-memory sessions. This means:
   - Users get logged out every time the server restarts
   - Won't work if you run multiple server instances for scale
   - Express itself warns: *"MemoryStore is not designed for a production environment"*
   **Fix:** use `connect-sqlite3` or `connect-redis` for persistent sessions.

3. **No duplicate-webhook protection**
   If Strava retries a webhook (which it does on timeouts), we'll enrich the same activity twice, doubling the AI description.
   **Fix:** track processed `(athleteId, activityId)` pairs in the DB and skip duplicates.

4. **Admin endpoint reuses `SESSION_SECRET`** (`src/server.js:218, 233`)
   Using the session cookie secret as an admin auth secret mixes two concerns. If the session secret leaks from a cookie, admin is exposed.
   **Fix:** add a separate `ADMIN_SECRET` env var.

5. **No HTTPS enforcement in production**
   `cookie: { secure: false }` is fine locally but must be `true` behind HTTPS so cookies can't be intercepted.

### Moderate

6. **Hardcoded 3-second sleep** (`src/server.js:134`)
   Strava sometimes returns 404 for activities that were just created. The hacky `setTimeout(3000)` is brittle.
   **Fix:** retry with exponential backoff (3 attempts: 1s, 3s, 8s).

7. **Pre-fetch sport filter never fires** (`src/server.js:127-129`)
   `event.updates` is only populated for *update* events, not *create* events. This filter is dead code — the real filter runs at line 139 after fetch.

8. **Only handles `aspect_type: 'create'`**
   Strava webhooks also fire on `update` events (user renames activity, etc.). We could re-enrich on update, or at least acknowledge the event.

9. **No rate limiting**
   Anyone could hammer `/api/enrich` and drain your AI budget. Need `express-rate-limit`.

10. **No input validation library**
    Manually checking `validTones.includes(tone)` works but doesn't scale. Use `zod` for type-safe validation.

### Minor

11. **`ALTER TABLE` hack in `init()`** — won't scale. Need a real migrations system (`umzug` or similar).
12. **All logs go to `console.log`** — fine locally, useless in production. Need structured logging (`pino`).
13. **No way to know AI spend** — add cost tracking per request.
14. **Hardcoded `/mile` units** — no metric support for international users.
15. **`getProviderStatus()` is exported but never used** — dead export.

---

## 🚀 Roadmap — 4 phases

### Phase 1 — Fixes & production hardening *(next session)*

Must-do before any real user touches it.

- [ ] Fix Claude model name to a real one
- [ ] Swap in-memory sessions for SQLite-backed sessions (`connect-sqlite3`)
- [ ] Add duplicate-webhook protection (track processed activity IDs)
- [ ] Split `ADMIN_SECRET` from `SESSION_SECRET`
- [ ] Retry logic for Strava activity fetch (replace 3s sleep)
- [ ] Rate-limit `/api/enrich` and `/auth/strava` routes
- [ ] Add structured logging with `pino`
- [ ] Fix Ramon's Gemini API key and verify AI works end-to-end
- [ ] Set up ngrok and test real webhook flow

### Phase 2 — Deploy to the cloud *(session 2-3)*

Get off localhost so Strava can reach it 24/7.

- [ ] **Database:** migrate from local SQLite file to [Turso](https://turso.tech) (libsql cloud) — same API, ~30-second change, free tier covers us
- [ ] **Host:** deploy to [Railway](https://railway.app) ($5/mo) or [Render](https://render.com) (free tier)
- [ ] **Domain:** set up `strava.yourdomain.com` pointing to the service
- [ ] **HTTPS:** enable `secure: true` cookies
- [ ] **Env vars:** move secrets to the platform's secret manager
- [ ] **Register webhook** on production URL
- [ ] **Submit Strava app for review** — required to go above 1 connected athlete
  ([strava.com/settings/api](https://strava.com/settings/api) → "Request Increase")

### Phase 3 — Polish & trust-building *(before sharing publicly)*

Features that make it feel like a real product, not a weekend project.

- [ ] **Account page** — profile pic, connected status, "Disconnect Strava" button
- [ ] **Activity history** — dashboard shows last 10 enrichments with the generated text
- [ ] **Undo button** — revert an enrichment (we store the previous description)
- [ ] **Custom prompt** — power users can tune their own tone in plain English
- [ ] **Metric units** — toggle between miles/km based on user preference (also auto-detect from Strava profile)
- [ ] **Error-tracking dashboard** — [Sentry](https://sentry.io) free tier for catching production errors
- [ ] **Health check endpoint** (`/healthz`) for uptime monitoring
- [ ] **Privacy policy + Terms of Service pages** — required for Strava approval + trust
- [ ] **Account deletion** — GDPR-required, one-click "delete all my data"
- [ ] **Welcome email** on first connection (via Resend or Postmark)

### Phase 4 — Growth features *(post-launch)*

Things that make it worth sharing.

- [ ] **Weather integration** — pull weather conditions at activity start time via OpenWeatherMap, include in AI prompt
- [ ] **Route/location facts** — "You ran through Central Park — Olmsted's 1858 masterpiece"
- [ ] **Personal milestones** — "Your 100th run of the year!", weekly streak detection
- [ ] **Comparison to past activities** — "25 seconds faster than your last 10K"
- [ ] **Activity tagging** — auto-detect types like "commute", "race", "hill workout"
- [ ] **Weekly summary email** — recap of the week with AI-generated highlights
- [ ] **Social sharing** — "share your favourite AI description" → lands on a public page
- [ ] **Leaderboards** — funniest descriptions voted by the community
- [ ] **Billing / Pro tier** — free users get X enrichments/month, Pro unlimited
- [ ] **Browser extension** — bonus enrichments on the Strava web UI (our very first idea!)

---

## 🏗️ Deployment architecture (target state)

```
  Ramon's domain (yourname.com)
         │
         └── strava.yourname.com  (CNAME → Railway/Render)
                    │
                    ▼
         ┌──────────────────────────┐
         │   Node/Express server    │
         │   - OAuth routes         │
         │   - Webhook handler      │
         │   - Dashboard API        │
         └──────────┬───────────────┘
                    │
         ┌──────────┼───────────┬───────────┐
         ▼          ▼           ▼           ▼
      Turso      Gemini      Strava     Sentry
    (SQLite     API         API       (errors)
     cloud)
```

**Estimated cost at 100 users:**
- Hosting (Railway): $5/mo
- Database (Turso free tier): $0 (up to 500M rows)
- AI (Gemini Flash): ~$1-2/mo
- **Total: under $10/mo**

---

## 🧪 Testing strategy

Currently: none. At minimum we need:

- [ ] Unit tests for `buildStatsSummary()`, unit conversions, prompt builders
- [ ] Integration tests for OAuth flow, webhook handling (with mocked Strava)
- [ ] E2E test: create a test Strava activity, verify description updates

Tooling: `vitest` (fast, simple) + `supertest` for HTTP integration tests.

---

## 📊 Metrics to track (once live)

- Connected athletes (total, daily active)
- Activities processed per day
- AI cost per day / per user
- Error rate
- Webhook latency (Strava → description updated)
- Most popular tone choice
- User retention (% still active after 30 days)

---

## ⚡ Top 5 priorities for next session

1. **Fix the Gemini key** and do an end-to-end test with a real activity
2. **Production-ize sessions + webhook dedup** (Phase 1 critical items)
3. **Deploy to Railway** with Turso — get off localhost permanently
4. **Set up the custom subdomain** on your personal website
5. **Add activity history + undo** to the dashboard (makes it feel real)

After those 5, we'll have something you can confidently share with friends.

---

*Last updated: April 2026. This doc is a living plan — update as we ship.*

# ⚡ StravaAI

Automatically enriches your Strava activity descriptions with fun facts, stats, and comparisons — powered by AI. Works in the background so every ride or run you post gets a unique, personalised description right inside the Strava app on your phone.

---

## What it does

When you post a new activity to Strava, StravaAI automatically appends a fun AI-generated paragraph below your description. For example:

**Playful tone — 42 mile ride:**
> "That's further than cycling from NYC to Philadelphia — except you did it before most people finished their coffee ☕. The 1,840 ft of climbing is basically 184 flights of stairs, but infinitely more fun and with way better views."

**Motivational tone — half marathon:**
> "13.1 miles of proof that you show up even when the couch is calling. Averaged 8:34/mile from start to finish — consistent, controlled, and strong. This is what your training has been building towards."

**Stats tone — threshold ride:**
> "42.3 miles at 18.4 mph average. Total elevation: 1,840 ft. Estimated caloric burn: ~1,250 kcal. Distance ranks in the top 15% of your rides this year."

---

## Features

- ✅ **Auto-enrichment** — triggers automatically via Strava webhooks on every new activity
- ✅ **3 tones** — Playful, Motivational, or Stats-focused
- ✅ **Sport filter** — enrich all activities, runs only, or rides only
- ✅ **On/Off toggle** — pause and resume anytime from the dashboard
- ✅ **Live previews** — see exactly what each tone looks like before saving
- ✅ **Manual enrichment** — test it on any past activity by pasting the URL
- ✅ **Multi-provider AI** — uses Gemini, OpenAI, or Claude (whichever is cheapest / available)
- ✅ **Respects existing descriptions** — your text stays, AI adds below it

---

## Tech stack

| Layer | Tech |
|---|---|
| Backend | Node.js + Express |
| Database | SQLite via `@libsql/client` |
| Auth | Strava OAuth 2.0 |
| AI | Gemini 2.0 Flash / GPT-4o-mini / Claude Haiku (auto-routed by cost) |
| Frontend | Vanilla HTML/CSS/JS |

---

## Getting started

### 1. Clone the repo

```bash
git clone https://github.com/RamonGarciaGomez/strava-claude.git
cd strava-claude
npm install
```

### 2. Set up credentials

```bash
cp .env.example .env
```

Open `.env` and fill in:

| Variable | Where to get it |
|---|---|
| `STRAVA_CLIENT_ID` | [strava.com/settings/api](https://www.strava.com/settings/api) |
| `STRAVA_CLIENT_SECRET` | Same page |
| `STRAVA_VERIFY_TOKEN` | Any random string you choose |
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) *(optional)* |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) *(optional)* |
| `SESSION_SECRET` | Any long random string |
| `APP_URL` | Your public URL (use ngrok for local dev) |

### 3. Run locally

```bash
npm start
# → http://localhost:3000
```

### 4. Set up the Strava webhook (needed for auto-enrichment)

Strava needs a public URL to send events to. For local development, use [ngrok](https://ngrok.com):

```bash
ngrok http 3000
```

Copy the `https://xxxx.ngrok.io` URL, update `APP_URL` in your `.env`, then register the webhook:

```bash
curl -X POST "http://localhost:3000/api/admin/register-webhook?secret=YOUR_SESSION_SECRET"
```

---

## Project structure

```
strava-claude/
├── src/
│   ├── server.js    # Express server — routes, OAuth, webhook handler
│   ├── ai.js        # Multi-provider AI router (Gemini → OpenAI → Claude)
│   ├── strava.js    # Strava API client
│   └── db.js        # SQLite database (users, tokens, preferences)
├── public/
│   ├── index.html   # Landing page
│   ├── dashboard.html # User dashboard
│   └── style.css
└── .env.example
```

---

## Roadmap

- [ ] Deploy to Railway / Render so it runs 24/7 without needing your laptop open
- [ ] Add weather data to descriptions (temp, conditions at time of activity)
- [ ] Weekly summary emails
- [ ] Support for multiple users / public launch

---

Built by [@RamonGarciaGomez](https://github.com/RamonGarciaGomez) with help from Claude AI.

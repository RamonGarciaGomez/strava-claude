// ai.js — Multi-provider AI router
// Tries providers in cost order (cheapest first), falls back if one fails.
// Just add API keys to .env — it uses whatever is available.

const Anthropic         = require('@anthropic-ai/sdk');
const { OpenAI }        = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ── Provider definitions (ordered cheapest → most expensive) ──────────────────
// Approximate cost per 1M tokens as of early 2026 — update as prices change.
const PROVIDERS = [
  {
    name:          'Gemini Flash',
    available:     () => !!process.env.GEMINI_API_KEY,
    costPer1MOut:  0.30,   // USD — Gemini 2.0 Flash output
    generate:      generateGemini,
  },
  {
    name:          'GPT-4o mini',
    available:     () => !!process.env.OPENAI_API_KEY,
    costPer1MOut:  0.60,   // USD — GPT-4o-mini output
    generate:      generateOpenAI,
  },
  {
    name:          'Claude Haiku',
    available:     () => !!process.env.ANTHROPIC_API_KEY,
    costPer1MOut:  4.00,   // USD — Claude 3.5 Haiku output
    generate:      generateClaude,
  },
];

// ── Tone instructions (shared across all providers) ───────────────────────────
const TONE_INSTRUCTIONS = {
  playful: `
    Write in a fun, witty, slightly humorous tone — like a sports commentator who loves puns
    and pop culture references. Include at least one funny comparison or analogy. Keep it light.
  `,
  motivational: `
    Write in an energetic, motivational tone — like a coach giving a post-race pep talk.
    Celebrate the achievement, highlight the effort, end with something that fires the athlete up.
  `,
  stats: `
    Write in a clean, data-focused tone — like a sports analyst. Lead with the most impressive
    numbers, make interesting comparisons, keep it concise and factual. Minimal fluff.
  `,
};

const SYSTEM_PROMPT_BASE = `
You are a creative sports writer who crafts short, engaging Strava activity summaries.
Rules:
- Keep the total response under 200 words
- Include at least 2-3 fun comparisons (e.g. "that's the height of 4 Eiffel Towers in elevation")
- Do NOT use hashtags
- Do NOT start with "I"
- Write as a single flowing paragraph or 2-3 short punchy lines — not a bullet list
- Do NOT include preamble like "Here's your summary:" — just write the content directly
`;

// ── Unit helpers ──────────────────────────────────────────────────────────────
function metersToMiles(m)  { return (m / 1609.34).toFixed(2); }
function metersToKm(m)     { return (m / 1000).toFixed(2); }
function metersToFeet(m)   { return Math.round(m * 3.281); }
function secondsToTime(s)  {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s`;
}
function secondsToPace(s, distM) {
  if (!distM) return null;
  const spm = s / (distM / 1609.34);
  return `${Math.floor(spm / 60)}:${Math.round(spm % 60).toString().padStart(2,'0')} /mile`;
}

function buildStatsSummary(activity) {
  const lines = [];
  if (activity.name)                   lines.push(`Activity: ${activity.name}`);
  if (activity.type)                   lines.push(`Sport: ${activity.type}`);
  if (activity.distance)               lines.push(`Distance: ${metersToMiles(activity.distance)} miles (${metersToKm(activity.distance)} km)`);
  if (activity.moving_time)            lines.push(`Moving time: ${secondsToTime(activity.moving_time)}`);
  if (activity.distance && activity.moving_time) {
    const pace = secondsToPace(activity.moving_time, activity.distance);
    if (pace) lines.push(`Pace: ${pace}`);
  }
  if (activity.total_elevation_gain)   lines.push(`Elevation gain: ${metersToFeet(activity.total_elevation_gain)} ft`);
  if (activity.average_heartrate)      lines.push(`Avg heart rate: ${Math.round(activity.average_heartrate)} bpm`);
  if (activity.average_watts)          lines.push(`Avg power: ${Math.round(activity.average_watts)}W`);
  if (activity.average_speed)          lines.push(`Avg speed: ${(activity.average_speed * 2.237).toFixed(1)} mph`);
  if (activity.calories)               lines.push(`Calories: ${Math.round(activity.calories)}`);
  if (activity.pr_count)               lines.push(`Personal records: ${activity.pr_count} 🏆`);
  if (activity.achievement_count)      lines.push(`Achievements: ${activity.achievement_count}`);
  if (activity.suffer_score)           lines.push(`Suffer score: ${activity.suffer_score}`);
  return lines.join('\n');
}

function buildPrompts(activity, tone, existingDescription) {
  const toneInstr  = TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS.playful;
  const systemText = `${SYSTEM_PROMPT_BASE}\n${toneInstr}`;
  const stats      = buildStatsSummary(activity);
  const sport      = activity.type || 'activity';
  const existing   = existingDescription?.trim();

  const userText = `Write a fun description for this Strava ${sport}:\n\n${stats}${
    existing ? `\n\nThe athlete already wrote: "${existing}"\nAdd your fun facts BELOW their text.` : ''
  }`;

  return { systemText, userText };
}

// ── Provider implementations ──────────────────────────────────────────────────

async function generateGemini(systemText, userText) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemText,
  });
  const result = await model.generateContent(userText);
  return result.response.text().trim();
}

async function generateOpenAI(systemText, userText) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 300,
    messages: [
      { role: 'system', content: systemText },
      { role: 'user',   content: userText },
    ],
  });
  return res.choices[0].message.content.trim();
}

async function generateClaude(systemText, userText) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: 'claude-3-5-haiku-latest',
    max_tokens: 300,
    system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userText }],
  });
  return res.content[0].text.trim();
}

// ── Main export ───────────────────────────────────────────────────────────────

async function generateDescription(activity, tone = 'playful', existingDescription = '') {
  const { systemText, userText } = buildPrompts(activity, tone, existingDescription);

  // Sort available providers by cost, try cheapest first
  const available = PROVIDERS
    .filter(p => p.available())
    .sort((a, b) => a.costPer1MOut - b.costPer1MOut);

  if (available.length === 0) {
    throw new Error('No AI provider configured — add at least one API key to your .env file');
  }

  for (const provider of available) {
    try {
      console.log(`🤖 Using ${provider.name} (~$${provider.costPer1MOut}/M tokens)`);
      const text = await provider.generate(systemText, userText);
      console.log(`✅ Generated with ${provider.name}`);
      return text;
    } catch (err) {
      console.warn(`⚠️  ${provider.name} failed: ${err.message} — trying next provider`);
    }
  }

  throw new Error('All AI providers failed — check your API keys and quotas');
}

// Show which providers are configured (useful for the dashboard)
function getProviderStatus() {
  return PROVIDERS.map(p => ({
    name:      p.name,
    active:    p.available(),
    costRank:  p.costPer1MOut,
  })).sort((a, b) => a.costRank - b.costRank);
}

module.exports = { generateDescription, getProviderStatus };

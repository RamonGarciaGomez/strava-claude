// claude.js — Uses the Claude API to generate fun, personalised activity descriptions
// We pass in all the activity stats and let Claude craft something unique each time

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic(); // picks up ANTHROPIC_API_KEY from env

// ── Sport type labels ─────────────────────────────────────────────────────────
const SPORT_LABELS = {
  Run:          'run',
  Ride:         'ride',
  Swim:         'swim',
  Walk:         'walk',
  Hike:         'hike',
  VirtualRide:  'virtual ride',
  VirtualRun:   'virtual run',
  WeightTraining: 'weight training',
  Yoga:         'yoga',
  // fallback handled below
};

// ── Tone prompts ──────────────────────────────────────────────────────────────
const TONE_INSTRUCTIONS = {
  playful: `
    You write in a fun, witty, slightly humorous tone — like a sports commentator who loves puns and
    pop culture references. Include at least one funny comparison or analogy. Keep it light and shareable.
  `,
  motivational: `
    You write in an energetic, motivational tone — like a coach giving a post-race pep talk.
    Celebrate the achievement, highlight the effort, and end with something that fires the athlete up.
  `,
  stats: `
    You write in a clean, data-focused tone — like a sports analyst. Lead with the most impressive
    numbers, make interesting comparisons, and keep it concise and factual. Minimal fluff.
  `,
};

// ── Unit helpers ──────────────────────────────────────────────────────────────
function metersToMiles(m)  { return (m / 1609.34).toFixed(2); }
function metersToKm(m)     { return (m / 1000).toFixed(2); }
function secondsToPace(s, distM) {
  if (!distM) return null;
  const secPerMile = s / (distM / 1609.34);
  const min = Math.floor(secPerMile / 60);
  const sec = Math.round(secPerMile % 60).toString().padStart(2, '0');
  return `${min}:${sec} /mile`;
}
function secondsToTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}h ${m}m ${sec}s`
    : `${m}m ${sec}s`;
}
function metersToFeet(m) { return Math.round(m * 3.281); }

// ── Main generator ────────────────────────────────────────────────────────────

async function generateDescription(activity, tone = 'playful', existingDescription = '') {
  const sportLabel = SPORT_LABELS[activity.type] || activity.type?.toLowerCase() || 'activity';
  const toneInstructions = TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS.playful;

  // Build a structured summary of the activity stats
  const stats = buildStatsSummary(activity);

  const systemPrompt = `
    You are a creative sports writer who crafts short, engaging Strava activity summaries.
    ${toneInstructions}

    Rules:
    - Keep the total response under 200 words
    - Always include at least 2-3 fun comparisons (e.g. "that's the height of 4 Eiffel Towers in elevation")
    - Include a personal milestone or streak fact if one is provided
    - Do NOT use hashtags
    - Do NOT start with "I"
    - Do NOT repeat the athlete's name
    - Write it as a single flowing paragraph or 2-3 short punchy lines — not a bullet list
    - Do NOT include any preamble like "Here's your summary:" — just write the content directly
  `;

  const userPrompt = `
    Write a fun description for this Strava ${sportLabel}:

    ${stats}

    ${existingDescription ? `The athlete already wrote: "${existingDescription}"\nAdd your fun facts BELOW their text — don't repeat what they said.` : ''}
  `;

  // Use prompt caching for the system prompt (it's always the same structure)
  const response = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 300,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' }, // cache the system prompt to save costs
      },
    ],
    messages: [
      { role: 'user', content: userPrompt },
    ],
  });

  return response.content[0].text.trim();
}

// ── Stats builder ─────────────────────────────────────────────────────────────
// Pulls the most useful stats out of a raw Strava activity object

function buildStatsSummary(activity) {
  const lines = [];

  if (activity.name)          lines.push(`Activity name: ${activity.name}`);
  if (activity.type)          lines.push(`Sport: ${activity.type}`);
  if (activity.distance)      lines.push(`Distance: ${metersToMiles(activity.distance)} miles (${metersToKm(activity.distance)} km)`);
  if (activity.moving_time)   lines.push(`Moving time: ${secondsToTime(activity.moving_time)}`);
  if (activity.elapsed_time)  lines.push(`Total time: ${secondsToTime(activity.elapsed_time)}`);

  if (activity.distance && activity.moving_time) {
    const pace = secondsToPace(activity.moving_time, activity.distance);
    if (pace) lines.push(`Pace: ${pace}`);
  }

  if (activity.total_elevation_gain) {
    lines.push(`Elevation gain: ${metersToFeet(activity.total_elevation_gain)} ft (${Math.round(activity.total_elevation_gain)} m)`);
  }

  if (activity.average_heartrate)  lines.push(`Avg heart rate: ${Math.round(activity.average_heartrate)} bpm`);
  if (activity.max_heartrate)      lines.push(`Max heart rate: ${Math.round(activity.max_heartrate)} bpm`);
  if (activity.average_watts)      lines.push(`Avg power: ${Math.round(activity.average_watts)}W`);
  if (activity.weighted_average_watts) lines.push(`Normalized power: ${Math.round(activity.weighted_average_watts)}W`);
  if (activity.average_speed)     lines.push(`Avg speed: ${(activity.average_speed * 2.237).toFixed(1)} mph`);
  if (activity.max_speed)         lines.push(`Max speed: ${(activity.max_speed * 2.237).toFixed(1)} mph`);
  if (activity.calories)          lines.push(`Calories: ${Math.round(activity.calories)}`);
  if (activity.suffer_score)      lines.push(`Suffer score: ${activity.suffer_score}`);
  if (activity.achievement_count) lines.push(`Achievements: ${activity.achievement_count}`);
  if (activity.pr_count)          lines.push(`Personal records: ${activity.pr_count} 🏆`);
  if (activity.kudos_count != null) lines.push(`Kudos so far: ${activity.kudos_count}`);

  // Start date/time
  if (activity.start_date_local) {
    const d = new Date(activity.start_date_local);
    lines.push(`Start time: ${d.toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' })}`);
  }

  return lines.join('\n');
}

module.exports = { generateDescription };

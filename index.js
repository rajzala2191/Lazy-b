const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { fetchCalDAVEvents } = require('./caldav');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'Lazy B', version: '1.0.0' });
});

// ─── CALDAV SYNC ENDPOINT ────────────────────────────────────────────────────
// Fetches live events from iCloud CalDAV and returns parsed JSON
app.get('/api/calendar/events', async (req, res) => {
  try {
    const { username, password, calendarUrl } = getCredentials(req);
    const daysAhead = parseInt(req.query.days) || 60;
    const daysBehind = parseInt(req.query.behind) || 90;
    const events = await fetchCalDAVEvents(username, password, calendarUrl, daysAhead, daysBehind);
    res.json({ success: true, events, synced: new Date().toISOString() });
  } catch (err) {
    console.error('CalDAV error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── CALDAV SETUP TEST ───────────────────────────────────────────────────────
// Test credentials before saving
app.post('/api/calendar/test', async (req, res) => {
  try {
    const { username, password, calendarUrl } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Missing credentials' });
    }
    const events = await fetchCalDAVEvents(username, password, calendarUrl, 7);
    res.json({ success: true, message: `Connected — found ${events.length} events in the next 7 days` });
  } catch (err) {
    res.status(401).json({ success: false, error: 'Connection failed: ' + err.message });
  }
});

// ─── AI NUDGE ENDPOINT (proxies Anthropic) ───────────────────────────────────
app.post('/api/ai/nudge', async (req, res) => {
  try {
    const { context, type } = req.body;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: buildNudgeSystem(type),
        messages: [{ role: 'user', content: context || 'Give me a nudge for today.' }]
      })
    });
    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    res.json({ success: true, nudge: text });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── AI TASK GENERATOR ───────────────────────────────────────────────────────
app.post('/api/ai/task', async (req, res) => {
  try {
    const { prompt } = req.body;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: `You are a smart task assistant for Valentina — a left-handed makeup artist at NARS, microblading student, Instagram beauty creator, managing PCOS. Her goals: microblading license, grow on Instagram, stay healthy (gluten-free). Return ONLY valid JSON: {"task":"task text","tag":"micro|content|wellness|work","time":"suggested time","note":"one short encouraging sentence"}. No markdown, no extra text.`,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json({ success: true, task: parsed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── SERVE FRONTEND (catch-all) ──────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'lazy-b-preview.html'));
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getCredentials(req) {
  // Prefer env vars (server-side stored) over query params
  return {
    username: process.env.ICLOUD_USERNAME || req.query.username,
    password: process.env.ICLOUD_APP_PASSWORD || req.query.password,
    calendarUrl: process.env.ICLOUD_CALENDAR_URL || req.query.calendarUrl
  };
}

function buildNudgeSystem(type) {
  const base = `You are Lazy B, a warm and encouraging AI daily companion for Valentina — a left-handed makeup artist at NARS, microblading student building toward her license, Instagram beauty creator, managing PCOS and gluten intolerance. Be concise (2-3 sentences max), warm, and specific. Never generic.`;
  const contexts = {
    micro: base + ' Focus on microblading practice and left-hand technique.',
    content: base + ' Focus on Instagram content creation and her beauty creator journey.',
    wellness: base + ' Focus on PCOS management, energy, gluten-free nutrition, and back pain.',
    daily: base + ' Give a general motivating nudge based on her day.'
  };
  return contexts[type] || contexts.daily;
}

app.listen(PORT, () => {
  console.log(`🐝 Lazy B running on port ${PORT}`);
});

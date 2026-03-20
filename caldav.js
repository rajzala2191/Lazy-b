const https = require('https');
const http = require('http');

// ─── MAIN: Fetch events from iCloud CalDAV ───────────────────────────────────
async function fetchCalDAVEvents(username, password, calendarUrl, daysAhead = 14, daysBehind = 90) {
  if (!username || !username.includes('@')) {
    throw new Error('Invalid iCloud username (must be an Apple ID email)');
  }

  const now = new Date();
  const past = new Date(now);
  past.setDate(past.getDate() - daysBehind);
  const future = new Date(now);
  future.setDate(future.getDate() + daysAhead);
  const dtStart = toCalDAVDate(past);
  const dtEnd = toCalDAVDate(future);

  const baseUrl = calendarUrl || 'https://caldav.icloud.com/';
  const body = buildCalDAVReport(dtStart, dtEnd);

  // Auto-discover calendar collections from principal or root URL
  let calendarUrls;
  try {
    calendarUrls = await discoverCalendars(baseUrl, username, password);
  } catch (_) {
    calendarUrls = [baseUrl];
  }

  // Fetch events from all discovered calendars
  const allEvents = [];
  for (const url of calendarUrls) {
    try {
      const raw = await calDAVRequest(url, username, password, body);
      allEvents.push(...parseICalResponse(raw));
    } catch (_) {}
  }

  allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
  return allEvents;
}

// ─── CALENDAR DISCOVERY ───────────────────────────────────────────────────────
async function discoverCalendars(url, username, password) {
  // Step 1: Get current-user-principal (handles root or unknown entry points)
  const principalXml = `<?xml version="1.0"?><propfind xmlns="DAV:"><prop><current-user-principal/></prop></propfind>`;
  let principalUrl = url;
  try {
    const resp = await calDAVPropfind(url, username, password, principalXml, '0');
    const m = resp.match(/<[^:>]*:?href[^>]*>(\S+principal\/)<\/[^:>]*:?href>/i);
    if (m) principalUrl = resolveUrl(m[1], url);
  } catch (_) {}

  // Step 2: Get calendar-home-set from principal
  const homeXml = `<?xml version="1.0"?><propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><prop><C:calendar-home-set/></prop></propfind>`;
  let homeUrl = principalUrl;
  try {
    const resp = await calDAVPropfind(principalUrl, username, password, homeXml, '0');
    const m = resp.match(/<[^:>]*:?href[^>]*>(\/[^<]*calendars[^<]*)<\/[^:>]*:?href>/i)
           || resp.match(/<[^:>]*:?href[^>]*>(https?:\/\/[^<]*calendars[^<]*)<\/[^:>]*:?href>/i);
    if (m) homeUrl = resolveUrl(m[1], principalUrl);
  } catch (_) {}

  // Step 3: List calendar collections in home
  const listXml = `<?xml version="1.0"?><propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><prop><resourcetype/><displayname/></prop></propfind>`;
  const calUrls = [];
  try {
    const resp = await calDAVPropfind(homeUrl, username, password, listXml, '1');
    const blocks = [...resp.matchAll(/<response[^>]*>([\s\S]*?)<\/response>/gi)];
    for (const block of blocks) {
      const inner = block[1];
      if (!inner.includes('calendar')) continue;
      if (inner.includes('schedule-inbox') || inner.includes('schedule-outbox')) continue;
      const hrefMatch = inner.match(/<href[^>]*>([^<]+)<\/href>/i);
      if (!hrefMatch) continue;
      const href = resolveUrl(hrefMatch[1].trim(), homeUrl);
      const norm = href.replace(/\/$/, '');
      const homeNorm = homeUrl.replace(/\/$/, '');
      if (norm !== homeNorm) calUrls.push(href);
    }
  } catch (_) {}

  return calUrls.length > 0 ? calUrls : [homeUrl];
}

function resolveUrl(href, base) {
  if (href.startsWith('http')) return href;
  const b = new URL(base);
  return `${b.protocol}//${b.host}${href}`;
}

// ─── PROPFIND REQUEST ─────────────────────────────────────────────────────────
function calDAVPropfind(url, username, password, body, depth) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + (parsed.search || ''),
      method: 'PROPFIND',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Depth': depth,
      }
    };
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('PROPFIND timed out')); });
    req.write(body);
    req.end();
  });
}

// ─── BUILD CALDAV REPORT REQUEST BODY ────────────────────────────────────────
function buildCalDAVReport(dtStart, dtEnd) {
  return `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${dtStart}" end="${dtEnd}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;
}

// ─── HTTP REQUEST TO CALDAV SERVER ───────────────────────────────────────────
function calDAVRequest(url, username, password, body) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + (parsed.search || ''),
      method: 'REPORT',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Depth': '1',
        'Prefer': 'return-minimal'
      }
    };

    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(options, (res) => {
      if (res.statusCode === 401) return reject(new Error('Invalid iCloud credentials. Use an App-Specific Password.'));
      if (res.statusCode === 404) return reject(new Error('Calendar URL not found.'));
      if (res.statusCode >= 400) return reject(new Error(`CalDAV server returned ${res.statusCode}`));

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('CalDAV request timed out')); });
    req.write(body);
    req.end();
  });
}

// ─── PARSE ICAL DATA FROM CALDAV XML RESPONSE ────────────────────────────────
function parseICalResponse(xmlResponse) {
  const events = [];
  // Match calendar-data with or without namespace prefix, handle CDATA wrapping
  const calDataMatches = xmlResponse.matchAll(/<[^>]*calendar-data[^>]*>([\s\S]*?)<\/[^>]*calendar-data>/g);
  for (const match of calDataMatches) {
    // Strip CDATA wrapper if present
    let ical = match[1].trim();
    ical = ical.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
    if (!ical.includes('BEGIN:VCALENDAR')) continue;
    const event = parseVEvent(ical);
    if (event) events.push(event);
  }
  events.sort((a, b) => new Date(a.start) - new Date(b.start));
  return events;
}

// ─── PARSE A SINGLE VEVENT BLOCK ─────────────────────────────────────────────
function parseVEvent(icalData) {
  const lines = unfoldICalLines(icalData);
  let inEvent = false;
  const props = {};

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { inEvent = true; continue; }
    if (line === 'END:VEVENT') { inEvent = false; break; }
    if (!inEvent) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.substring(0, colonIdx).split(';')[0].toUpperCase();
    const value = line.substring(colonIdx + 1).trim();
    props[key] = value;
  }

  if (!props['DTSTART'] || !props['SUMMARY']) return null;

  return {
    id: props['UID'] || generateId(),
    title: decodeICalText(props['SUMMARY']),
    start: parseICalDate(props['DTSTART']),
    end: props['DTEND'] ? parseICalDate(props['DTEND']) : null,
    location: props['LOCATION'] ? decodeICalText(props['LOCATION']) : null,
    description: props['DESCRIPTION'] ? decodeICalText(props['DESCRIPTION']) : null,
    allDay: props['DTSTART']?.length === 8 || props['DTSTART']?.includes('VALUE=DATE'),
    status: props['STATUS'] || 'CONFIRMED',
    recurrence: !!props['RRULE']
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function unfoldICalLines(data) {
  return data.replace(/\r\n[ \t]/g, '').replace(/\r\n/g, '\n').split('\n').filter(Boolean);
}

function parseICalDate(dtStr) {
  if (!dtStr) return null;
  const clean = dtStr.includes(':') ? dtStr.split(':').pop() : dtStr;
  if (clean.length === 8) {
    return `${clean.slice(0,4)}-${clean.slice(4,6)}-${clean.slice(6,8)}`;
  }
  const y = clean.slice(0,4), mo = clean.slice(4,6), d = clean.slice(6,8);
  const h = clean.slice(9,11), mi = clean.slice(11,13), s = clean.slice(13,15);
  const utc = clean.endsWith('Z') ? 'Z' : '';
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${utc}`;
}

function toCalDAVDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function decodeICalText(str) {
  return str.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

module.exports = { fetchCalDAVEvents };

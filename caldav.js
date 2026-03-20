const https = require('https');
const http = require('http');

// ─── MAIN: Fetch events from iCloud CalDAV ───────────────────────────────────
async function fetchCalDAVEvents(username, password, calendarUrl, daysAhead = 14) {
  if (!username || !username.includes('@')) {
    throw new Error('Invalid iCloud username (must be an Apple ID email)');
  }

  // Build date range for REPORT query
  const now = new Date();
  const future = new Date(now);
  future.setDate(future.getDate() + daysAhead);

  const dtStart = toCalDAVDate(now);
  const dtEnd = toCalDAVDate(future);

  // iCloud CalDAV base URL — derive from username if no custom URL given
  const baseUrl = calendarUrl || buildiCloudCalDAVUrl(username);

  const body = buildCalDAVReport(dtStart, dtEnd);
  const rawResponse = await calDAVRequest(baseUrl, username, password, body);
  return parseICalResponse(rawResponse);
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
      if (res.statusCode === 401) return reject(new Error('Invalid iCloud credentials. Use an App-Specific Password, not your Apple ID password.'));
      if (res.statusCode === 404) return reject(new Error('Calendar URL not found. Check your iCloud CalDAV URL.'));
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

  // Extract calendar-data blocks from XML
  const calDataMatches = xmlResponse.matchAll(/<[^:]*:calendar-data[^>]*>([\s\S]*?)<\/[^:]*:calendar-data>/g);

  for (const match of calDataMatches) {
    const icalData = match[1].trim();
    const event = parseVEvent(icalData);
    if (event) events.push(event);
  }

  // Sort by start time
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
  // RFC 5545: lines folded with CRLF + whitespace — unfold them
  return data.replace(/\r\n[ \t]/g, '').replace(/\r\n/g, '\n').split('\n').filter(Boolean);
}

function parseICalDate(dtStr) {
  if (!dtStr) return null;
  // Strip VALUE=DATE: prefix if present
  const clean = dtStr.includes(':') ? dtStr.split(':').pop() : dtStr;
  // TZID param in key — handled by unfold, value is just the datetime
  if (clean.length === 8) {
    // All-day: YYYYMMDD
    return `${clean.slice(0,4)}-${clean.slice(4,6)}-${clean.slice(6,8)}`;
  }
  // YYYYMMDDTHHMMSS[Z]
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

function buildiCloudCalDAVUrl(username) {
  // Standard iCloud CalDAV endpoint
  return `https://caldav.icloud.com/`;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

module.exports = { fetchCalDAVEvents };

// Import / export iCalendar (RFC 5545) — compatible Google Agenda, Outlook, Apple Calendrier.

import { parse, pad, toIso, addDays, ymd, fromZoned, isValidTimeZone } from './dates.js'

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const unesc = s => s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')

function fold(line) {
  const out = []
  let cur = ''
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > 74) { out.push(cur); cur = ' ' + ch } else cur += ch
  }
  out.push(cur)
  return out.join('\r\n')
}

const dt = d => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + '00'
const dd = d => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
const utc = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

export function exportIcs(events, calendars) {
  const calName = id => (calendars.find(c => c.id === id) || {}).name || ''
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BMM Systems//ZR Agenda//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:ZR Agenda']
  for (const ev of events) {
    const s = parse(ev.start), e = parse(ev.end)
    lines.push('BEGIN:VEVENT', 'UID:' + ev.id + '@zr-agenda', 'DTSTAMP:' + utc(new Date(ev.updatedAt || ev.createdAt || Date.now())))
    if (ev.allDay) lines.push('DTSTART;VALUE=DATE:' + dd(s), 'DTEND;VALUE=DATE:' + dd(e))
    else lines.push('DTSTART:' + dt(s), 'DTEND:' + dt(e))
    lines.push('SUMMARY:' + esc(ev.title))
    if (ev.location) lines.push('LOCATION:' + esc(ev.location))
    if (ev.description) lines.push('DESCRIPTION:' + esc(ev.description))
    if (calName(ev.calendarId)) lines.push('CATEGORIES:' + esc(calName(ev.calendarId)))
    const r = ev.recurrence
    if (r) {
      let rule = 'FREQ=' + r.freq.toUpperCase()
      if (r.interval > 1) rule += ';INTERVAL=' + r.interval
      if (r.freq === 'weekly' && r.byDay && r.byDay.length) rule += ';BYDAY=' + r.byDay.map(x => BYDAY[x]).join(',')
      if (r.freq === 'monthly' && r.monthlyMode === 'weekday') {
        const n = Math.ceil(s.getDate() / 7)
        rule += ';BYDAY=' + (n > 4 ? -1 : n) + BYDAY[s.getDay()]
      }
      if (r.until) rule += ';UNTIL=' + r.until.replace(/-/g, '') + (ev.allDay ? '' : 'T235959')
      else if (r.count) rule += ';COUNT=' + r.count
      lines.push('RRULE:' + rule)
      for (const x of ev.exdates || []) {
        lines.push(ev.allDay ? 'EXDATE;VALUE=DATE:' + x.replace(/-/g, '') : 'EXDATE:' + x.replace(/-/g, '') + 'T' + pad(s.getHours()) + pad(s.getMinutes()) + '00')
      }
    }
    for (const m of ev.reminders || []) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(ev.title), 'TRIGGER:-PT' + m + 'M', 'END:VALARM')
    }
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}

function parseDateValue(value, params) {
  const v = value.trim()
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    return { date: new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8)), allDay: true }
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v)
  if (!m) return null
  const tz = resolveTzid(params.TZID)
  const d = m[7]
    ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)))
    : tz ? fromZoned(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5], tz)
      : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))
  return { date: d, allDay: false }
}

// Identifiants Windows fréquents (Outlook, Exchange) → fuseaux IANA.
const WINDOWS_TZ = {
  'romance standard time': 'Europe/Paris', 'w. europe standard time': 'Europe/Berlin', 'central europe standard time': 'Europe/Budapest',
  'central european standard time': 'Europe/Warsaw', 'gmt standard time': 'Europe/London', 'greenwich standard time': 'Atlantic/Reykjavik',
  'e. europe standard time': 'Europe/Chisinau', 'fle standard time': 'Europe/Kiev', 'morocco standard time': 'Africa/Casablanca',
  'w. central africa standard time': 'Africa/Lagos', 'south africa standard time': 'Africa/Johannesburg', 'e. africa standard time': 'Africa/Nairobi',
  'eastern standard time': 'America/New_York', 'central standard time': 'America/Chicago', 'mountain standard time': 'America/Denver',
  'pacific standard time': 'America/Los_Angeles', 'canada central standard time': 'America/Regina', 'atlantic standard time': 'America/Halifax',
  'tokyo standard time': 'Asia/Tokyo', 'china standard time': 'Asia/Shanghai', 'india standard time': 'Asia/Kolkata',
  'arabian standard time': 'Asia/Dubai', 'aus eastern standard time': 'Australia/Sydney', 'utc': 'UTC', 'coordinated universal time': 'UTC'
}

// TZID d'un fichier .ics → fuseau IANA reconnu, sinon null (heure locale de l'appareil).
export function resolveTzid(tzid) {
  if (!tzid) return null
  const raw = tzid.trim()
  if (isValidTimeZone(raw)) return raw
  const win = WINDOWS_TZ[raw.toLowerCase()]
  if (win) return win
  const parts = raw.split('/').filter(Boolean)
  for (let i = 0; i < parts.length - 1; i++) {
    const cand = parts.slice(i).join('/')
    if (/^[A-Z][A-Za-z_]+\/[A-Za-z_\/-]+$/.test(cand) && isValidTimeZone(cand)) return cand
  }
  return null
}

export function importIcs(text) {
  const raw = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/)
  const events = []
  let cur = null, inAlarm = false
  for (const line of raw) {
    if (line === 'BEGIN:VEVENT') { cur = { props: {}, alarms: [], exdates: [] }; continue }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue }
    if (!cur) continue
    if (line === 'BEGIN:VALARM') { inAlarm = true; continue }
    if (line === 'END:VALARM') { inAlarm = false; continue }
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const [name, ...paramList] = line.slice(0, idx).split(';')
    const params = Object.fromEntries(paramList.map(p => p.split('=')).map(([k, v]) => [k.toUpperCase(), (v || '').replace(/"/g, '')]))
    const value = line.slice(idx + 1)
    const key = name.toUpperCase()
    if (inAlarm) {
      if (key === 'TRIGGER') {
        const m = /^-?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(value)
        if (m) cur.alarms.push((+m[1] || 0) * 10080 + (+m[2] || 0) * 1440 + (+m[3] || 0) * 60 + (+m[4] || 0))
      }
      continue
    }
    if (key === 'EXDATE') { for (const v of value.split(',')) { const p = parseDateValue(v, params); if (p) cur.exdates.push(ymd(p.date)) } continue }
    cur.props[key] = { value, params }
  }

  const out = []
  for (const c of events) {
    const p = c.props
    if (!p.DTSTART) continue
    const s = parseDateValue(p.DTSTART.value, p.DTSTART.params)
    if (!s) continue
    let e = p.DTEND ? parseDateValue(p.DTEND.value, p.DTEND.params) : null
    let end
    if (e) end = e.date
    else if (p.DURATION) {
      const m = /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(p.DURATION.value)
      end = new Date(s.date.getTime() + (((+m[1] || 0) * 24 + (+m[2] || 0)) * 60 + (+m[3] || 0)) * 60000)
    } else end = s.allDay ? addDays(s.date, 1) : new Date(s.date.getTime() + 3600000)
    let recurrence = null
    if (p.RRULE) {
      const rr = Object.fromEntries(p.RRULE.value.split(';').map(x => x.split('=')))
      const freq = (rr.FREQ || '').toLowerCase()
      if (['daily', 'weekly', 'monthly', 'yearly'].includes(freq)) {
        recurrence = { freq, interval: Number(rr.INTERVAL) || 1 }
        if (rr.BYDAY) {
          if (freq === 'weekly') recurrence.byDay = rr.BYDAY.split(',').map(x => BYDAY.indexOf(x.slice(-2))).filter(x => x >= 0)
          if (freq === 'monthly') recurrence.monthlyMode = 'weekday'
        }
        if (rr.UNTIL) { const u = parseDateValue(rr.UNTIL, {}); if (u) recurrence.until = ymd(u.date) }
        if (rr.COUNT) recurrence.count = Number(rr.COUNT)
      }
    }
    out.push({
      uid: p.UID ? p.UID.value : null,
      title: p.SUMMARY ? unesc(p.SUMMARY.value) : 'Sans titre',
      location: p.LOCATION ? unesc(p.LOCATION.value) : '',
      description: p.DESCRIPTION ? unesc(p.DESCRIPTION.value) : '',
      allDay: s.allDay,
      start: toIso(s.date),
      end: toIso(end > s.date ? end : (s.allDay ? addDays(s.date, 1) : new Date(s.date.getTime() + 3600000))),
      recurrence,
      exdates: c.exdates,
      reminders: [...new Set(c.alarms)].slice(0, 5)
    })
  }
  return out
}

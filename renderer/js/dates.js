// Utilitaires de dates, récurrences et jours fériés.
// Les dates sont stockées en heure locale au format « YYYY-MM-DDTHH:mm ».

export const MINUTE = 60000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
export const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
export const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
export const WEEKDAYS_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']
export const WEEKDAYS_LETTER = ['D', 'L', 'M', 'M', 'J', 'V', 'S']

export const pad = n => String(n).padStart(2, '0')
export const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s

export function ymd(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

export function toIso(d) {
  return ymd(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

export function parse(s) {
  if (s instanceof Date) return new Date(s)
  const [date, time = '00:00'] = s.split('T')
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return new Date(y, m - 1, d, hh || 0, mm || 0)
}

export const hm = d => pad(d.getHours()) + ':' + pad(d.getMinutes())

export function startOfDay(d) { const r = new Date(d); r.setHours(0, 0, 0, 0); return r }
export function endOfDay(d) { return addDays(startOfDay(d), 1) }
export function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r }
export function addMinutes(d, n) { return new Date(d.getTime() + n * MINUTE) }
export function addMonths(d, n) {
  const r = new Date(d)
  const day = r.getDate()
  r.setDate(1)
  r.setMonth(r.getMonth() + n)
  r.setDate(Math.min(day, daysInMonth(r.getFullYear(), r.getMonth())))
  return r
}
export function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1) }
export function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate() }
export function startOfWeek(d, weekStart = 1) {
  const r = startOfDay(d)
  r.setDate(r.getDate() - ((r.getDay() - weekStart + 7) % 7))
  return r
}
export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
export function diffDays(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY)
}
export function minutesOfDay(d) { return d.getHours() * 60 + d.getMinutes() }

export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t - yearStart) / DAY + 1) / 7)
}

// ─── Formats ────────────────────────────────────────────────────────────────

export function fmtTime(d, h12 = false) {
  if (!h12) return hm(d)
  const h = d.getHours() % 12 || 12
  return h + (d.getMinutes() ? ':' + pad(d.getMinutes()) : '') + (d.getHours() < 12 ? ' am' : ' pm')
}

export function fmtDuration(min) {
  if (min < 60) return min + ' min'
  const h = Math.floor(min / 60), m = min % 60
  if (h >= 24 && m === 0 && h % 24 === 0) return (h / 24) + (h === 24 ? ' jour' : ' jours')
  return h + ' h' + (m ? ' ' + pad(m) : '')
}

export function fmtDayLong(d) {
  return WEEKDAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '')
}

export function fmtDayShort(d) {
  return WEEKDAYS_SHORT[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()]
}

export function fmtMonthYear(d) { return cap(MONTHS[d.getMonth()]) + ' ' + d.getFullYear() }

export function fmtRelativeDay(d, now = new Date()) {
  const n = diffDays(now, d)
  if (n === 0) return "Aujourd'hui"
  if (n === 1) return 'Demain'
  if (n === -1) return 'Hier'
  if (n > 1 && n < 7) return cap(WEEKDAYS[d.getDay()])
  return cap(fmtDayShort(d))
}

export function fmtRange(start, end, allDay, h12) {
  if (allDay) {
    const last = addDays(end, -1)
    if (sameDay(start, last) || last < start) return 'Toute la journée'
    return 'Du ' + fmtDayShort(start) + ' au ' + fmtDayShort(last)
  }
  if (sameDay(start, end) || (minutesOfDay(end) === 0 && diffDays(start, end) === 1)) {
    return fmtTime(start, h12) + ' – ' + fmtTime(end, h12)
  }
  return fmtDayShort(start) + ', ' + fmtTime(start, h12) + ' – ' + fmtDayShort(end) + ', ' + fmtTime(end, h12)
}

export function fmtIn(ms) {
  const min = Math.round(ms / MINUTE)
  if (min < 1) return "maintenant"
  if (min < 60) return 'dans ' + min + ' min'
  const h = Math.floor(min / 60), m = min % 60
  if (h < 24) return 'dans ' + h + ' h' + (m ? ' ' + pad(m) : '')
  const d = Math.round(h / 24)
  return 'dans ' + d + (d > 1 ? ' jours' : ' jour')
}

// ─── Jours fériés (France métropolitaine) ───────────────────────────────────

function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(y, month - 1, day)
}

const holidayCache = new Map()
export function holidays(year) {
  if (holidayCache.has(year)) return holidayCache.get(year)
  const e = easter(year)
  const list = [
    [new Date(year, 0, 1), "Jour de l'an"],
    [addDays(e, 1), 'Lundi de Pâques'],
    [new Date(year, 4, 1), 'Fête du Travail'],
    [new Date(year, 4, 8), 'Victoire 1945'],
    [addDays(e, 39), 'Ascension'],
    [addDays(e, 50), 'Lundi de Pentecôte'],
    [new Date(year, 6, 14), 'Fête nationale'],
    [new Date(year, 7, 15), 'Assomption'],
    [new Date(year, 10, 1), 'Toussaint'],
    [new Date(year, 10, 11), 'Armistice 1918'],
    [new Date(year, 11, 25), 'Noël']
  ]
  const map = new Map(list.map(([d, n]) => [ymd(d), n]))
  holidayCache.set(year, map)
  return map
}
export function holidayOf(d) { return holidays(d.getFullYear()).get(ymd(d)) || null }

// ─── Récurrences ────────────────────────────────────────────────────────────
// recurrence = { freq: 'daily'|'weekly'|'monthly'|'yearly', interval, byDay: [0..6],
//                monthlyMode: 'day'|'weekday', until: 'YYYY-MM-DD'|null, count: n|null }

function nthWeekdayOfMonth(d) { return Math.ceil(d.getDate() / 7) }
function isLastWeekdayOfMonth(d) { return d.getDate() + 7 > daysInMonth(d.getFullYear(), d.getMonth()) }

function dateForNthWeekday(y, m, weekday, nth) {
  if (nth === -1) {
    const last = new Date(y, m, daysInMonth(y, m))
    last.setDate(last.getDate() - ((last.getDay() - weekday + 7) % 7))
    return last
  }
  const first = new Date(y, m, 1)
  const day = 1 + ((weekday - first.getDay() + 7) % 7) + (nth - 1) * 7
  return day <= daysInMonth(y, m) ? new Date(y, m, day) : null
}

// Génère les dates de début (heure comprise) d'une série jusqu'à `to`.
function* recurrenceStarts(start, rec, to) {
  const interval = Math.max(1, rec.interval || 1)
  const until = rec.until ? endOfDay(parse(rec.until)) : null
  const limit = until && until < to ? until : to
  let produced = 0
  const max = rec.count || Infinity
  const emit = d => { produced++; return d }
  const tod = [start.getHours(), start.getMinutes()]
  const withTime = d => { const r = new Date(d); r.setHours(tod[0], tod[1], 0, 0); return r }
  let guard = 0

  if (rec.freq === 'daily') {
    for (let d = new Date(start); d < limit && produced < max && guard++ < 20000; d = addDays(d, interval)) yield emit(d)
  } else if (rec.freq === 'weekly') {
    const days = (rec.byDay && rec.byDay.length ? rec.byDay : [start.getDay()]).slice().sort()
    const ws = startOfWeek(start, 1)
    const order = days.map(x => (x + 6) % 7).sort((a, b) => a - b)
    for (let w = ws; w < limit && produced < max && guard++ < 5000; w = addDays(w, 7 * interval)) {
      for (const off of order) {
        const d = withTime(addDays(w, off))
        if (d < start) continue
        if (d >= limit || produced >= max) return
        yield emit(d)
      }
    }
  } else if (rec.freq === 'monthly') {
    const nth = isLastWeekdayOfMonth(start) && nthWeekdayOfMonth(start) === 5 ? -1 : nthWeekdayOfMonth(start)
    for (let i = 0; produced < max && guard++ < 2400; i += interval) {
      const y = start.getFullYear() + Math.floor((start.getMonth() + i) / 12)
      const m = (start.getMonth() + i) % 12
      let d
      if (rec.monthlyMode === 'weekday') d = dateForNthWeekday(y, m, start.getDay(), rec.nth ?? nth)
      else d = start.getDate() <= daysInMonth(y, m) ? new Date(y, m, start.getDate()) : null
      if (!d) { if (new Date(y, m, 1) >= limit) return; continue }
      d = withTime(d)
      if (d >= limit) return
      yield emit(d)
    }
  } else if (rec.freq === 'yearly') {
    for (let i = 0; produced < max && guard++ < 500; i += interval) {
      const y = start.getFullYear() + i
      if (start.getMonth() === 1 && start.getDate() === 29 && daysInMonth(y, 1) < 29) continue
      const d = withTime(new Date(y, start.getMonth(), start.getDate()))
      if (d >= limit) return
      yield emit(d)
    }
  }
}

// Occurrences d'un événement chevauchant [from, to[.
export function occurrences(ev, from, to) {
  const s = parse(ev.start), e = parse(ev.end)
  const dur = Math.max(0, e - s)
  const out = []
  if (!ev.recurrence) {
    if (s < to && (e > from || (dur === 0 && s >= from))) out.push({ ev, start: s, end: e, key: ev.id })
    return out
  }
  const ex = new Set(ev.exdates || [])
  for (const os of recurrenceStarts(s, ev.recurrence, to)) {
    const oe = new Date(os.getTime() + dur)
    if (oe <= from && !(dur === 0 && os >= from)) continue
    const k = ymd(os)
    if (ex.has(k)) continue
    out.push({ ev, start: os, end: oe, key: ev.id + '@' + k, occurrence: k })
  }
  return out
}

export function expandAll(events, from, to, visibleCals) {
  const out = []
  for (const ev of events) {
    if (visibleCals && !visibleCals.has(ev.calendarId)) continue
    for (const o of occurrences(ev, from, to)) out.push(o)
  }
  out.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
  return out
}

const ORD = { 1: '1er', 2: '2e', 3: '3e', 4: '4e', 5: '5e', '-1': 'dernier' }
export function nthLabel(d) {
  const n = isLastWeekdayOfMonth(d) && nthWeekdayOfMonth(d) >= 4 ? -1 : nthWeekdayOfMonth(d)
  return { n, label: (n === -1 ? 'dernier ' : ORD[n] + ' ') + WEEKDAYS[d.getDay()] }
}

export function describeRecurrence(rec, start) {
  if (!rec) return ''
  const i = rec.interval || 1
  let s
  if (rec.freq === 'daily') s = i === 1 ? 'Tous les jours' : 'Tous les ' + i + ' jours'
  else if (rec.freq === 'weekly') {
    const days = rec.byDay && rec.byDay.length ? rec.byDay : [start.getDay()]
    const sorted = days.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    const isWork = sorted.length === 5 && [1, 2, 3, 4, 5].every(x => sorted.includes(x))
    const names = isWork ? 'en semaine' : 'le ' + sorted.map(x => WEEKDAYS[x]).join(', ')
    s = (i === 1 ? 'Toutes les semaines ' : 'Toutes les ' + i + ' semaines ') + names
  } else if (rec.freq === 'monthly') {
    const what = rec.monthlyMode === 'weekday' ? 'le ' + nthLabel(start).label : 'le ' + start.getDate()
    s = (i === 1 ? 'Tous les mois ' : 'Tous les ' + i + ' mois ') + what
  } else if (rec.freq === 'yearly') {
    s = (i === 1 ? 'Tous les ans' : 'Tous les ' + i + ' ans') + ' le ' + start.getDate() + ' ' + MONTHS[start.getMonth()]
  }
  if (rec.until) s += ", jusqu'au " + fmtDayShort(parse(rec.until))
  else if (rec.count) s += ', ' + rec.count + ' fois'
  return s
}

export function monthMatrix(d, weekStart = 1) {
  const first = startOfWeek(startOfMonth(d), weekStart)
  return Array.from({ length: 42 }, (_, i) => addDays(first, i))
}

export function weekdayOrder(weekStart) {
  return Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7)
}

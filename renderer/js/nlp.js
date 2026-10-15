// Saisie rapide en langage naturel (français).
// « Déjeuner avec Paul demain 12h30 @Le Procope #perso »
// « Point équipe chaque lundi 9h pendant 30 min »
// « Envoyer le devis vendredi !1 »

import { addDays, addMinutes, startOfDay, daysInMonth, toIso } from './dates.js'

const DAYS = { dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 }
const MONTHS = {
  janvier: 0, janv: 0, fevrier: 1, fevr: 1, fev: 1, mars: 2, avril: 3, avr: 3, mai: 4, juin: 5,
  juillet: 6, juil: 6, aout: 7, septembre: 8, sept: 8, octobre: 9, oct: 9, novembre: 10, nov: 10, decembre: 11, dec: 11
}
const DAY_RE = '(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)'
const MONTH_RE = '(' + Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|') + ')\\.?'

// Normalise caractère par caractère (minuscules, sans accents) en conservant la longueur.
function normalize(s) {
  let out = ''
  for (const ch of s) {
    const base = ch.normalize('NFD')[0].toLowerCase()
    out += ch.length === 1 && base.length === 1 ? base : ch.length === 1 ? ch : ' '.repeat(ch.length)
  }
  return out.replace(/[’']/g, "'")
}

export function parseQuick(text, now = new Date()) {
  const r = {
    date: null, time: null, endTime: null, duration: null, allDay: false,
    recurrence: null, tag: null, location: null, priority: 0, title: '', matched: []
  }
  if (!text || !text.trim()) return r
  let orig = text
  let s = normalize(text)

  const take = (re, fn) => {
    const m = re.exec(s)
    if (!m) return false
    if (fn(m) === false) return false
    const span = orig.substr(m.index, m[0].length).trim()
    if (span) r.matched.push(span)
    s = s.slice(0, m.index) + ' '.repeat(m[0].length) + s.slice(m.index + m[0].length)
    orig = orig.slice(0, m.index) + ' '.repeat(m[0].length) + orig.slice(m.index + m[0].length)
    return true
  }

  // Lieu : @lieu (jusqu'au prochain # ou ! ou fin)
  take(/(?:^|\s)@\s?([^#!]+?)\s*(?=#|!|$)/, m => { r.location = orig.substr(m.index + m[0].indexOf(m[1]), m[1].length).trim() })
  // Agenda / liste : #nom
  take(/(?:^|\s)#([\w\u00C0-\u024F-]+)/, m => { r.tag = m[1] })
  // Priorité : !1 !2 !3 ou !!! / !! / !
  take(/(?:^|\s)!(1|2|3)\b/, m => { r.priority = 4 - Number(m[1]) })
  take(/(?:^|\s)(!{1,3})(?=\s|$)/, m => { r.priority = m[1].length })
  if (take(/\b(?:urgent|important)\b/, () => {})) r.priority = Math.max(r.priority, 3)

  // Journée entière
  take(/\b(?:toute la journee|journee entiere|jour entier)\b/, () => { r.allDay = true })

  // Récurrences
  take(/\b(?:tous les jours ouvres|chaque jour ouvre|en semaine|du lundi au vendredi)\b/, () => {
    r.recurrence = { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5] }
  })
  take(/\b(?:tous les jours|chaque jour|quotidiennement)\b/, () => { r.recurrence = { freq: 'daily', interval: 1 } })
  take(new RegExp('\\b(?:chaque|tous les)\\s+' + DAY_RE + 's?(?:\\s+(?:et|,)\\s+' + DAY_RE + 's?)?\\b'), m => {
    const days = [DAYS[m[1]]]
    if (m[2]) days.push(DAYS[m[2]])
    r.recurrence = { freq: 'weekly', interval: 1, byDay: days }
    if (!r.date) r.date = nextWeekday(now, days[0], false)
  })
  take(/\b(?:toutes les (\d+) semaines|toutes les deux semaines)\b/, m => { r.recurrence = { freq: 'weekly', interval: Number(m[1]) || 2 } })
  take(/\b(?:chaque semaine|toutes les semaines|hebdomadairement)\b/, () => { r.recurrence = { freq: 'weekly', interval: 1 } })
  take(/\b(?:chaque mois|tous les mois|mensuellement)\b/, () => { r.recurrence = { freq: 'monthly', interval: 1 } })
  take(/\b(?:chaque annee|tous les ans|annuellement)\b/, () => { r.recurrence = { freq: 'yearly', interval: 1 } })

  // Durée explicite
  take(/\b(?:pendant|durant|pour)\s+(\d+(?:[.,]\d+)?)\s*(h|heures?|min|minutes?|mn)(?:\s*(\d{1,2}))?\b/, m => {
    const v = parseFloat(m[1].replace(',', '.'))
    r.duration = /^h/.test(m[2]) ? Math.round(v * 60) + (m[3] ? Number(m[3]) : 0) : Math.round(v)
  })
  take(/\b(\d+)\s*(?:min|minutes|mn)\b/, m => { r.duration = Number(m[1]) })

  // Plage horaire : de 14h à 16h / 14h-16h / 9:00 - 10:30
  const T = '(\\d{1,2})\\s*(?:h|:)\\s*(\\d{2})?'
  take(new RegExp('(?:\\bde\\s+)?\\b' + T + '\\s*(?:-|–|a|jusqu\'a)\\s*' + T + '(?![\\w])'), m => {
    const t1 = { h: +m[1], m: +(m[2] || 0) }, t2 = { h: +m[3], m: +(m[4] || 0) }
    if (!validTime(t1) || !validTime(t2)) return false
    r.time = t1; r.endTime = t2
  })
  // Heure seule
  if (!r.time) {
    take(new RegExp('(?:\\b(?:a|vers|des)\\s+)?\\b' + T + '(?![\\w])'), m => {
      const t = { h: +m[1], m: +(m[2] || 0) }
      if (!validTime(t)) return false
      r.time = t
    })
  }
  if (!r.time) take(/\b(?:a\s+)?midi\b/, () => { r.time = { h: 12, m: 0 } })
  if (!r.time) take(/\b(?:a\s+)?minuit\b/, () => { r.time = { h: 0, m: 0 } })

  // Dates
  const today = startOfDay(now)
  take(/\bapres[- ]demain\b/, () => { r.date = addDays(today, 2) })
  take(/\bdemain\b/, () => { r.date = addDays(today, 1) })
  take(/\b(?:aujourd'hui|aujourdhui|ce jour)\b/, () => { r.date = today })
  take(/\bce soir\b/, () => { r.date = today; if (!r.time) r.time = { h: 19, m: 0 } })
  take(/\bce matin\b/, () => { r.date = today; if (!r.time) r.time = { h: 9, m: 0 } })
  take(/\bcet apres-?midi\b/, () => { r.date = today; if (!r.time) r.time = { h: 14, m: 0 } })
  take(/\bdans\s+(\d+|un|une|deux|trois)\s+(jours?|semaines?|mois)\b/, m => {
    const n = { un: 1, une: 1, deux: 2, trois: 3 }[m[1]] || Number(m[1])
    if (m[2].startsWith('jour')) r.date = addDays(today, n)
    else if (m[2].startsWith('semaine')) r.date = addDays(today, 7 * n)
    else { const d = new Date(today); d.setMonth(d.getMonth() + n); r.date = d }
  })
  take(/\bsemaine prochaine\b/, () => { r.date = nextWeekday(now, 1, true) })
  take(/\bmois prochain\b/, () => { r.date = new Date(today.getFullYear(), today.getMonth() + 1, 1) })
  take(/\bfin de semaine|\bce week-?end\b/, () => { r.date = nextWeekday(now, 6, false) })
  take(new RegExp('\\b(?:le\\s+|ce\\s+)?' + DAY_RE + '(\\s+prochain)?\\b'), m => {
    r.date = nextWeekday(now, DAYS[m[1]], !!m[2])
  })
  take(new RegExp('\\b(?:le\\s+)?(\\d{1,2}|1er)\\s+' + MONTH_RE + '(?:\\s+(\\d{4}))?\\b'), m => {
    const day = m[1] === '1er' ? 1 : Number(m[1])
    const mon = MONTHS[m[2]]
    let y = m[3] ? Number(m[3]) : today.getFullYear()
    if (day > daysInMonth(y, mon)) return false
    let d = new Date(y, mon, day)
    if (!m[3] && d < today) d = new Date(y + 1, mon, day)
    r.date = d
  })
  take(/\b(?:le\s+)?(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\b/, m => {
    const day = Number(m[1]), mon = Number(m[2]) - 1
    if (mon < 0 || mon > 11) return false
    let y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : today.getFullYear()
    if (day < 1 || day > daysInMonth(y, mon)) return false
    let d = new Date(y, mon, day)
    if (!m[3] && d < today) d = new Date(y + 1, mon, day)
    r.date = d
  })
  take(/\ble\s+(\d{1,2}|1er)\b/, m => {
    const day = m[1] === '1er' ? 1 : Number(m[1])
    if (day < 1 || day > 31) return false
    let d = new Date(today.getFullYear(), today.getMonth(), day)
    if (d < today || d.getDate() !== day) d = new Date(today.getFullYear(), today.getMonth() + 1, day)
    r.date = d
  })

  r.title = orig
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:(?:a|à|le|la|de|du|et|pour|,|-|–)\s+)+/i, '')
    .replace(/(?:\s+(?:a|à|le|la|de|du|et|pour|,|-|–))+$/i, '')
    .replace(/\s+([,.])/g, '$1')
    .trim()
  if (r.title) r.title = r.title.charAt(0).toUpperCase() + r.title.slice(1)
  return r
}

function validTime(t) { return t.h >= 0 && t.h <= 23 && t.m >= 0 && t.m <= 59 }

function nextWeekday(now, wd, forceNext) {
  const today = startOfDay(now)
  let diff = (wd - today.getDay() + 7) % 7
  if (forceNext && diff === 0) diff = 7
  if (forceNext && wd === 1 && diff < 7 && diff > 0) { /* « semaine prochaine » = lundi suivant */ }
  return addDays(today, diff)
}

// Convertit le résultat en brouillon d'événement.
export function quickToEvent(p, { defaultDuration = 60, calendars = [], defaultCalendarId, now = new Date() } = {}) {
  let start, end, allDay = p.allDay
  const date = p.date || startOfDay(now)
  if (p.time && !allDay) {
    start = new Date(date); start.setHours(p.time.h, p.time.m, 0, 0)
    if (p.endTime) {
      end = new Date(date); end.setHours(p.endTime.h, p.endTime.m, 0, 0)
      if (end <= start) end = addDays(end, 1)
    } else {
      end = addMinutes(start, p.duration || defaultDuration)
    }
  } else if (p.date || allDay) {
    allDay = true
    start = startOfDay(date)
    end = addDays(start, 1)
  } else {
    start = new Date(now)
    start.setSeconds(0, 0)
    start.setMinutes(Math.ceil((start.getMinutes() + 1) / 30) * 30)
    end = addMinutes(start, p.duration || defaultDuration)
  }
  let calendarId = defaultCalendarId
  if (p.tag) {
    const t = normalize(p.tag)
    const cal = calendars.find(c => normalize(c.name).startsWith(t))
    if (cal) calendarId = cal.id
  }
  return {
    title: p.title || 'Nouvel événement',
    start: toIso(start), end: toIso(end), allDay,
    location: p.location || '',
    calendarId,
    recurrence: p.recurrence ? { ...p.recurrence } : null
  }
}

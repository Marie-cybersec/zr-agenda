// Habitudes et routines : planification, séries, historique.
// habit = { id, name, categoryId, schedule: { type: 'daily' } | { type: 'days', days: [0..6] } | { type: 'weekly', times },
//           target, unit, time: 'HH:mm'|null, reminder, startDate: 'YYYY-MM-DD', archived }
// habitLogs = { [habitId]: { 'YYYY-MM-DD': nombre } }

import { ymd, parse, addDays, startOfDay, startOfWeek, diffDays, WEEKDAYS } from '../dates.js'

const MAX_SCAN_DAYS = 800

export const habitStart = h => startOfDay(parse(h.startDate || (h.createdAt || '').slice(0, 10) || ymd(new Date())))
export const target = h => Math.max(1, h.target || 1)

export function isScheduled(h, day) {
  if (startOfDay(day) < habitStart(h)) return false
  const s = h.schedule || { type: 'daily' }
  if (s.type === 'days') return (s.days || []).includes(day.getDay())
  return true
}

export const countOn = (logs, h, day) => (logs[h.id] && logs[h.id][ymd(day)]) || 0
export const isDoneOn = (logs, h, day) => countOn(logs, h, day) >= target(h)

// Pour les habitudes « n fois par semaine », une journée compte si elle a au moins une réalisation.
function weekCount(logs, h, weekStartDay) {
  let n = 0
  for (let i = 0; i < 7; i++) if (countOn(logs, h, addDays(weekStartDay, i)) > 0) n++
  return n
}

export function weekProgress(logs, h, day, weekStart = 1) {
  const ws = startOfWeek(day, weekStart)
  const s = h.schedule || { type: 'daily' }
  if (s.type === 'weekly') return { done: weekCount(logs, h, ws), target: Math.max(1, s.times || 1) }
  let done = 0, total = 0
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i)
    if (!isScheduled(h, d)) continue
    total++
    if (isDoneOn(logs, h, d)) done++
  }
  return { done, target: total }
}

// Série en cours et meilleure série. Une période en cours non terminée ne casse pas la série.
export function streaks(logs, h, today = new Date(), weekStart = 1) {
  const s = h.schedule || { type: 'daily' }
  const start = habitStart(h)
  today = startOfDay(today)
  if (s.type === 'weekly') {
    const need = Math.max(1, s.times || 1)
    const first = startOfWeek(start, weekStart)
    const cur = startOfWeek(today, weekStart)
    const weeks = []
    for (let w = first, g = 0; w <= cur && g < 200; w = addDays(w, 7), g++) weeks.push(weekCount(logs, h, w) >= need)
    return runLengths(weeks, 'semaine')
  }
  const days = []
  const from = diffDays(start, today) > MAX_SCAN_DAYS ? addDays(today, -MAX_SCAN_DAYS) : start
  for (let d = from; d <= today; d = addDays(d, 1)) if (isScheduled(h, d)) days.push(isDoneOn(logs, h, d))
  return runLengths(days, 'jour')
}

function runLengths(list, unit) {
  let best = 0, run = 0
  for (const ok of list) { run = ok ? run + 1 : 0; best = Math.max(best, run) }
  // La dernière période (aujourd'hui ou cette semaine) peut encore être complétée.
  let current = 0
  let i = list.length - 1
  if (i >= 0 && !list[i]) i--
  for (; i >= 0 && list[i]; i--) current++
  return { current, best, unit }
}

// Historique jour par jour sur [from, to].
export function history(logs, h, from, to) {
  const out = []
  for (let d = startOfDay(from); d <= to; d = addDays(d, 1)) {
    const count = countOn(logs, h, d)
    out.push({ date: ymd(d), day: d, scheduled: isScheduled(h, d), count, done: count >= target(h) })
  }
  return out
}

// Taux de réussite sur [from, to] : jours planifiés réussis, ou semaines réussies.
export function completionRate(logs, h, from, to, weekStart = 1) {
  const s = h.schedule || { type: 'daily' }
  if (s.type === 'weekly') {
    let ok = 0, n = 0
    for (let w = startOfWeek(from, weekStart); w <= to; w = addDays(w, 7)) {
      if (addDays(w, 6) < habitStart(h)) continue
      n++
      if (weekCount(logs, h, w) >= Math.max(1, s.times || 1)) ok++
    }
    return n ? ok / n : null
  }
  const hs = history(logs, h, from, to).filter(x => x.scheduled)
  return hs.length ? hs.filter(x => x.done).length / hs.length : null
}

export function describeSchedule(h) {
  const s = h.schedule || { type: 'daily' }
  if (s.type === 'weekly') return (s.times || 1) + ' fois par semaine'
  if (s.type === 'days') {
    const days = (s.days || []).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    if (days.length === 7) return 'Tous les jours'
    if (days.length === 5 && [1, 2, 3, 4, 5].every(x => days.includes(x))) return 'En semaine'
    return days.map(x => WEEKDAYS[x].slice(0, 3) + '.').join(' ')
  }
  return 'Tous les jours'
}

// Habitude encore attendue aujourd'hui ?
export function pendingToday(logs, h, day = new Date(), weekStart = 1) {
  if (h.archived || !isScheduled(h, day)) return false
  if ((h.schedule || {}).type === 'weekly') {
    const p = weekProgress(logs, h, day, weekStart)
    return p.done < p.target && countOn(logs, h, day) === 0
  }
  return !isDoneOn(logs, h, day)
}

// ─── Routines ───────────────────────────────────────────────────────────────
// routine = { id, name, categoryId, days: [0..6], time: 'HH:mm'|null, steps: [{ id, title, minutes }], reminder, archived }
// routineLogs = { [routineId]: { 'YYYY-MM-DD': [stepId] } }

export const routineScheduled = (r, day) => !r.archived && (r.days || []).includes(day.getDay())
export const routineMinutes = r => (r.steps || []).reduce((s, x) => s + (Number(x.minutes) || 0), 0)
export function routineProgress(logs, r, day) {
  const done = new Set((logs[r.id] && logs[r.id][ymd(day)]) || [])
  const steps = r.steps || []
  const n = steps.filter(s => done.has(s.id)).length
  return { done: n, total: steps.length, complete: steps.length > 0 && n === steps.length, doneIds: done }
}

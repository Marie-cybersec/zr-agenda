// Plan de la journée : réponses aux quatre questions de l'écran d'accueil.

import { expandAll, ymd, parse, addDays, startOfDay, diffDays, hm, fmtRelativeDay, DAY, MINUTE } from '../dates.js'
import { isScheduled, pendingToday, countOn, target, routineScheduled, routineMinutes, routineProgress } from './habits.js'
import { conflictKeys, findConflicts } from './conflicts.js'
import { legsBetween } from './trips.js'
import { reminderTimes } from './reminders.js'
import { progress, activeGoals } from './goals.js'

export const KINDS = {
  event: 'Rendez-vous', task: 'Tâche', habit: 'Habitude', routine: 'Routine', reminder: 'Rappel', leg: 'Déplacement'
}

const atTime = (day, hhmm) => parse(ymd(day) + 'T' + hhmm)
const visibleCals = d => new Set(d.calendars.filter(c => c.visible).map(c => c.id))

// Éléments qui occupent du temps : rendez-vous, déplacements, routines planifiées.
export function busyItems(d, from, to) {
  const items = []
  for (const o of expandAll(d.events, from, to, visibleCals(d))) {
    if (o.ev.allDay || o.end - o.start >= DAY) continue
    items.push({ kind: 'event', key: o.key, title: o.ev.title || 'Sans titre', start: o.start, end: o.end, ref: o })
  }
  for (const l of legsBetween(d.trips, from, to)) {
    items.push({ kind: 'leg', key: 'leg:' + l.leg.id, title: (l.leg.from || '?') + ' → ' + (l.leg.to || '?'), start: l.start, end: l.end, ref: l })
  }
  for (let day = startOfDay(from); day < to; day = addDays(day, 1)) {
    for (const r of d.routines) {
      if (!r.time || !routineScheduled(r, day)) continue
      const s = atTime(day, r.time)
      if (s >= to || s < from && new Date(s.getTime() + routineMinutes(r) * MINUTE) <= from) continue
      items.push({ kind: 'routine', key: 'routine:' + r.id + '@' + ymd(day), title: r.name, start: s, end: new Date(s.getTime() + routineMinutes(r) * MINUTE), ref: r })
    }
  }
  return items
}

export function buildDay(d, day = new Date(), now = new Date()) {
  const from = startOfDay(day), to = addDays(from, 1)
  const isToday = diffDays(now, from) === 0
  const timed = [], untimed = [], allDay = []

  for (const o of expandAll(d.events, from, to, visibleCals(d))) {
    if (o.ev.allDay || o.end - o.start >= DAY) allDay.push({ kind: 'event', key: o.key, title: o.ev.title || 'Sans titre', ref: o })
  }
  const busy = busyItems(d, from, to)
  timed.push(...busy)

  const key = ymd(from)
  for (const t of d.tasks) {
    if (t.done || !t.due) continue
    const overdue = t.due < key
    if (t.due !== key && !(isToday && overdue)) continue
    if (t.dueTime && !overdue) {
      const s = atTime(from, t.dueTime)
      timed.push({ kind: 'task', key: 'task:' + t.id, title: t.title || 'Sans titre', start: s, end: new Date(s.getTime() + (Number(t.estimate) || 0) * MINUTE), ref: t })
    } else untimed.push({ kind: 'task', key: 'task:' + t.id, title: t.title || 'Sans titre', overdue, ref: t })
  }
  for (const h of d.habits) {
    if (h.archived || !isScheduled(h, from)) continue
    const item = {
      kind: 'habit', key: 'habit:' + h.id, title: h.name, ref: h, count: countOn(d.habitLogs, h, from), target: target(h),
      pending: pendingToday(d.habitLogs, h, from, d.settings.weekStart)
    }
    if (h.time) { const s = atTime(from, h.time); timed.push({ ...item, start: s, end: s }) } else untimed.push(item)
  }
  for (const r of d.routines) {
    if (!routineScheduled(r, from)) continue
    const p = routineProgress(d.routineLogs, r, from)
    const existing = timed.find(x => x.key === 'routine:' + r.id + '@' + key)
    if (existing) existing.progress = p
    else untimed.push({ kind: 'routine', key: 'routine:' + r.id, title: r.name, ref: r, progress: p })
  }
  for (const r of d.reminders) {
    for (const at of reminderTimes(r, from, to)) timed.push({ kind: 'reminder', key: 'rem:' + r.id + '@' + at.getTime(), title: r.title || 'Rappel', start: at, end: at, ref: r })
  }
  timed.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
  return { day: from, timed, untimed, allDay, conflicts: conflictKeys(busy) }
}

// Durée totale (minutes) couverte par des intervalles [début, fin] dans [a, b], chevauchements fusionnés.
export function coveredMinutes(intervals, a, b) {
  const list = intervals.map(([s, e]) => [Math.max(+s, +a), Math.min(+e, +b)]).filter(([s, e]) => e > s).sort((x, y) => x[0] - y[0])
  let total = 0, cs = null, ce = null
  for (const [s, e] of list) {
    if (cs === null || s > ce) { if (cs !== null) total += ce - cs; cs = s; ce = e } else ce = Math.max(ce, e)
  }
  if (cs !== null) total += ce - cs
  return Math.round(total / MINUTE)
}

// Bornes de la journée active définies dans les réglages (dayEnd = 24 : minuit).
export function dayBounds(d, day = new Date()) {
  const s = d.settings
  const a = new Date(startOfDay(day)); a.setHours(s.dayStart ?? 7, 0, 0, 0)
  const b = (s.dayEnd ?? 23) >= 24 ? addDays(startOfDay(day), 1) : (() => { const x = new Date(startOfDay(day)); x.setHours(s.dayEnd ?? 23, 0, 0, 0); return x })()
  return [a, b > a ? b : addDays(startOfDay(day), 1)]
}

export function timeLeft(d, now = new Date(), plan = buildDay(d, now, now)) {
  const [ds, de] = dayBounds(d, now)
  const a = new Date(Math.max(now, ds))
  const remaining = Math.max(0, Math.round((de - a) / MINUTE))
  const busy = coveredMinutes(plan.timed.filter(x => ['event', 'leg', 'routine'].includes(x.kind)).map(x => [x.start, x.end]), a, de)
  const free = Math.max(0, remaining - busy)
  const todo = d.tasks.filter(t => !t.done && t.due && t.due <= ymd(now))
  const taskLoad = todo.reduce((s, t) => s + (Number(t.estimate) || 0), 0)
  const unestimated = todo.filter(t => !t.estimate).length
  const span = de - ds
  return {
    dayStart: ds, dayEnd: de, remaining, busy, free, taskLoad, unestimated,
    overbooked: taskLoad > free,
    elapsed: Math.min(1, Math.max(0, (now - ds) / span)),
    busyRatio: span ? Math.min(1, busy * MINUTE / span) : 0
  }
}

export function urgentItems(d, now = new Date()) {
  const out = []
  const today = ymd(now), tomorrow = ymd(addDays(now, 1))
  for (const t of d.tasks) {
    if (t.done || !t.due) continue
    const title = t.title || 'Sans titre'
    if (t.due < today) {
      const n = diffDays(parse(t.due), now)
      out.push({ level: 'critical', kind: 'task', title, detail: 'En retard de ' + n + ' jour' + (n > 1 ? 's' : ''), ref: t, at: parse(t.due) })
    } else if (t.due <= tomorrow && t.priority >= 2) {
      out.push({ level: 'high', kind: 'task', title, detail: (t.due === today ? "Aujourd'hui" : 'Demain') + (t.dueTime ? ' à ' + t.dueTime : '') + ' · priorité ' + (t.priority === 3 ? 'haute' : 'moyenne'), ref: t, at: parse(t.due + 'T' + (t.dueTime || '23:59')) })
    } else if (t.due === today && t.dueTime) {
      const at = parse(t.due + 'T' + t.dueTime)
      if (at - now <= 120 * MINUTE) out.push({ level: at < now ? 'critical' : 'high', kind: 'task', title, detail: (at < now ? 'Échéance dépassée à ' : 'Échéance à ') + t.dueTime, ref: t, at })
    }
  }
  for (const [a, b] of findConflicts(busyItems(d, now, addDays(startOfDay(now), 2)))) {
    if (b.start < now && a.end < now) continue
    out.push({ level: 'high', kind: 'conflict', title: a.title + ' / ' + b.title, detail: 'Conflit · ' + fmtRelativeDay(b.start, now) + ' ' + hm(b.start), ref: [a, b], at: b.start })
  }
  for (const g of activeGoals(d)) {
    if (g.period !== 'deadline' || !g.dueDate) continue
    const p = progress(g, d, now)
    if (p.done || p.daysLeft > 7) continue
    out.push({ level: p.daysLeft <= 2 ? 'critical' : 'high', kind: 'goal', title: g.title,
      detail: (p.daysLeft < 0 ? 'Échéance dépassée' : p.daysLeft === 0 ? "Échéance aujourd'hui" : 'J−' + p.daysLeft) + ' · ' + Math.round(p.ratio * 100) + ' %', ref: g, at: parse(g.dueDate) })
  }
  for (const l of legsBetween(d.trips, now, new Date(now.getTime() + DAY))) {
    out.push({ level: 'high', kind: 'leg', title: (l.leg.from || '?') + ' → ' + (l.leg.to || '?'), detail: 'Départ ' + fmtRelativeDay(l.start, now).toLowerCase() + ' à ' + hm(l.start), ref: l, at: l.start })
  }
  const rank = { critical: 0, high: 1 }
  return out.sort((a, b) => rank[a.level] - rank[b.level] || a.at - b.at)
}

export function goalsOverview(d, now = new Date()) {
  return activeGoals(d).map(g => ({ g, p: progress(g, d, now) }))
}

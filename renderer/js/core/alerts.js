// Calcul des notifications à émettre. Module pur : l'émission réelle se fait dans ../reminders.js.
// Les rappels ne peuvent partir que lorsque l'application tourne (fenêtre ouverte ou zone de notification) :
// à la reprise, les rappels passés pendant l'absence sont regroupés comme « manqués ».

import { expandAll, parse, ymd, addDays, startOfDay, hm, fmtRelativeDay, MINUTE, DAY } from '../dates.js'
import { isScheduled, pendingToday, routineScheduled, routineProgress } from './habits.js'
import { reminderTimes } from './reminders.js'
import { legsBetween } from './trips.js'

const toMin = s => { const [h, m] = (s || '0:0').split(':').map(Number); return h * 60 + (m || 0) }

// Heures calmes : intervalle [début, fin[ pouvant passer minuit.
export function inQuietHours(date, q) {
  if (!q || !q.enabled) return false
  const s = toMin(q.start), e = toMin(q.end), m = date.getHours() * 60 + date.getMinutes()
  if (s === e) return false
  return s < e ? m >= s && m < e : m >= s || m < e
}

// Toutes les alertes dont l'heure tombe dans [from, to[.
export function collectAlerts(d, from, to) {
  const s = d.settings
  const n = { ...(s.notify || {}) }
  const out = []
  const push = a => { if (a.at >= from && a.at < to) out.push(a) }

  if (n.events !== false) {
    const withRem = d.events.filter(e => (e.reminders || []).length)
    const visible = new Set(d.calendars.filter(c => c.visible).map(c => c.id))
    for (const o of expandAll(withRem, from, addDays(to, 8), visible)) {
      for (const m of o.ev.reminders) {
        const when = o.ev.allDay ? fmtRelativeDay(o.start, o.start) : m === 0 ? 'Maintenant' : 'À ' + hm(o.start)
        push({ key: o.key + '|' + o.start.getTime() + '|' + m, at: new Date(o.start.getTime() - m * MINUTE), kind: 'event',
          title: o.ev.title || 'Événement', body: when + (o.ev.location ? ' · ' + o.ev.location : '') })
      }
    }
  }
  if (n.tasks !== false) {
    for (const t of d.tasks) {
      if (t.done || !t.due || !t.dueTime) continue
      const lead = t.reminder ?? s.taskReminder
      if (lead == null || lead < 0) continue
      const due = parse(t.due + 'T' + t.dueTime)
      push({ key: 'task|' + t.id + '|' + due.getTime() + '|' + lead, at: new Date(due.getTime() - lead * MINUTE), kind: 'task',
        title: 'Tâche : ' + (t.title || 'Sans titre'), body: lead ? 'Échéance à ' + t.dueTime : 'Échéance maintenant' })
    }
  }
  for (let day = startOfDay(from); day < to; day = addDays(day, 1)) {
    if (n.habits !== false) {
      for (const h of d.habits) {
        if (!h.time || !h.reminder || !isScheduled(h, day) || !pendingToday(d.habitLogs, h, day, s.weekStart)) continue
        push({ key: 'habit|' + h.id + '|' + ymd(day), at: parse(ymd(day) + 'T' + h.time), kind: 'habit', title: h.name, body: 'Habitude du jour' })
      }
    }
    if (n.routines !== false) {
      for (const r of d.routines) {
        if (!r.time || !r.reminder || !routineScheduled(r, day) || routineProgress(d.routineLogs, r, day).complete) continue
        push({ key: 'routine|' + r.id + '|' + ymd(day), at: parse(ymd(day) + 'T' + r.time), kind: 'routine', title: 'Routine : ' + r.name,
          body: (r.steps || []).length + ' étape' + ((r.steps || []).length > 1 ? 's' : '') })
      }
    }
  }
  if (n.reminders !== false) {
    for (const r of d.reminders) {
      for (const at of reminderTimes(r, from, to)) {
        push({ key: 'rem|' + r.id + '|' + at.getTime(), at, kind: 'reminder', title: r.title || 'Rappel', body: r.alarm ? 'Alarme · ' + hm(at) : hm(at), alarm: !!r.alarm, ref: r.id })
      }
    }
  }
  if (n.trips !== false && s.tripReminder >= 0) {
    const lead = (s.tripReminder || 0) * MINUTE
    for (const l of legsBetween(d.trips, new Date(from.getTime() + lead), new Date(to.getTime() + lead))) {
      push({ key: 'leg|' + l.leg.id + '|' + l.start.getTime(), at: new Date(l.start.getTime() - lead), kind: 'leg',
        title: 'Départ : ' + (l.leg.from || '?') + ' → ' + (l.leg.to || '?'), body: 'À ' + hm(l.start) + (l.leg.ref ? ' · ' + l.leg.ref : '') })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

// Répartit les alertes non encore émises depuis la dernière vérification :
// - live   : à notifier maintenant (heure atteinte depuis moins de `liveWindowMs`, hors heures calmes) ;
// - missed : passées pendant une absence ou pendant les heures calmes, à présenter en résumé.
export function dueAlerts(d, lastCheck, now, fired, { liveWindowMs = 2 * MINUTE, maxMissedMs } = {}) {
  const maxMissed = maxMissedMs ?? (d.settings.missedWindowHours ?? 12) * 60 * MINUTE
  const from = new Date(Math.max(+lastCheck || 0, +now - maxMissed))
  const live = [], missed = []
  if (!d.settings.notifications) return { live, missed }
  for (const a of collectAlerts(d, from, new Date(+now + 1))) {
    if (fired.has(a.key)) continue
    const quiet = !a.alarm && inQuietHours(a.at, d.settings.quietHours)
    if (+now - a.at <= liveWindowMs && !quiet) live.push(a)
    else missed.push({ ...a, quiet })
  }
  return { live, missed }
}

// Prochaine alerte à venir (affichage « prochain rappel »).
export function nextAlert(d, now = new Date()) {
  return collectAlerts(d, now, new Date(+now + 2 * DAY))[0] || null
}

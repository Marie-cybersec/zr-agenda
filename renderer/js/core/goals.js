// Objectifs quotidiens, hebdomadaires, mensuels ou à échéance.
// goal = { id, title, categoryId, period: 'day'|'week'|'month'|'deadline', metric: 'tasks'|'habit'|'focus'|'manual',
//          target, unit, habitId, startDate, dueDate, log: { 'YYYY-MM-DD': valeur }, archived }

import { ymd, parse, addDays, startOfDay, startOfWeek, startOfMonth, diffDays } from '../dates.js'

export const PERIODS = { day: "Aujourd'hui", week: 'Cette semaine', month: 'Ce mois', deadline: 'Échéances' }
export const METRICS = {
  tasks: { label: 'Tâches terminées', unit: 'tâches' },
  habit: { label: "Réalisations d'une habitude", unit: 'fois' },
  focus: { label: 'Temps de concentration', unit: 'min' },
  manual: { label: 'Saisie manuelle', unit: '' }
}

export function periodRange(g, now = new Date(), weekStart = 1) {
  if (g.period === 'day') { const a = startOfDay(now); return [a, addDays(a, 1)] }
  if (g.period === 'week') { const a = startOfWeek(now, weekStart); return [a, addDays(a, 7)] }
  if (g.period === 'month') { const a = startOfMonth(now); return [a, new Date(a.getFullYear(), a.getMonth() + 1, 1)] }
  const a = startOfDay(parse(g.startDate || (g.createdAt || ymd(now)).slice(0, 10)))
  const b = g.dueDate ? addDays(parse(g.dueDate), 1) : addDays(startOfDay(now), 1)
  return [a, b]
}

const inRange = (iso, from, to) => { const t = new Date(iso); return t >= from && t < to }
const dayInRange = (key, from, to) => { const t = parse(key); return t >= from && t < to }

export function measure(g, d, from, to) {
  if (g.metric === 'tasks') {
    return d.tasks.filter(t => t.done && t.doneAt && inRange(t.doneAt, from, to) && (!g.categoryId || t.categoryId === g.categoryId)).length
  }
  if (g.metric === 'habit') {
    const log = (g.habitId && d.habitLogs[g.habitId]) || {}
    return Object.entries(log).reduce((s, [k, v]) => s + (dayInRange(k, from, to) ? Number(v) || 0 : 0), 0)
  }
  if (g.metric === 'focus') {
    return d.focusLog.filter(f => inRange(f.at, from, to) && (!g.categoryId || f.categoryId === g.categoryId))
      .reduce((s, f) => s + (Number(f.minutes) || 0), 0)
  }
  return Object.entries(g.log || {}).reduce((s, [k, v]) => s + (dayInRange(k, from, to) ? Number(v) || 0 : 0), 0)
}

// Avancement et rythme. Pour une échéance, `pace` compare l'avancement au temps écoulé.
export function progress(g, d, now = new Date()) {
  const [from, to] = periodRange(g, now, d.settings.weekStart)
  const value = measure(g, d, from, to)
  const tgt = Math.max(0, Number(g.target) || 0)
  const ratio = tgt ? Math.min(1, value / tgt) : 0
  const done = tgt > 0 && value >= tgt
  let pace = null, daysLeft = null
  if (g.period === 'deadline' && g.dueDate) {
    daysLeft = diffDays(now, parse(g.dueDate))
    const span = to - from
    const elapsed = Math.min(1, Math.max(0, (now - from) / span))
    pace = done ? 'done' : daysLeft < 0 ? 'missed' : ratio + 0.05 >= elapsed ? 'ahead' : 'behind'
  }
  return { value, target: tgt, ratio, done, from, to, pace, daysLeft }
}

export const activeGoals = d => d.goals.filter(g => !g.archived)

export function summary(d, now = new Date()) {
  const out = {}
  for (const k of Object.keys(PERIODS)) {
    const gs = activeGoals(d).filter(g => g.period === k)
    out[k] = { total: gs.length, done: gs.filter(g => progress(g, d, now).done).length }
  }
  return out
}

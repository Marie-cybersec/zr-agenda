// Rappels : notifications système pour les événements et les tâches.

import { db } from './store.js'
import { expandAll, fmtTime, fmtRelativeDay, parse, MINUTE, DAY, addDays } from './dates.js'

const FIRED_KEY = 'zr-fired-reminders'
let fired
try { fired = new Set(JSON.parse(localStorage.getItem(FIRED_KEY) || '[]')) } catch { fired = new Set() }
const remember = k => {
  fired.add(k)
  try { localStorage.setItem(FIRED_KEY, JSON.stringify([...fired].slice(-500))) } catch {}
}

let audio
export function chime() {
  if (!db()?.settings.sound) return
  try {
    audio = audio || new AudioContext()
    const t = audio.currentTime
    ;[[880, 0], [1318.5, 0.12]].forEach(([f, dt]) => {
      const o = audio.createOscillator(), g = audio.createGain()
      o.type = 'sine'; o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t + dt)
      g.gain.exponentialRampToValueAtTime(0.12, t + dt + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.6)
      o.connect(g).connect(audio.destination)
      o.start(t + dt); o.stop(t + dt + 0.65)
    })
  } catch {}
}

export function notify(title, body) {
  if (!db()?.settings.notifications) return
  try {
    const n = new Notification(title, { body, silent: true })
    n.onclick = () => window.zr.focus()
  } catch {}
}

function check() {
  const d = db()
  if (!d || !d.settings.notifications) return
  const now = Date.now()
  const windowStart = now - 2 * MINUTE
  const occ = expandAll(d.events.filter(e => (e.reminders || []).length), new Date(now - DAY), addDays(new Date(now), 8),
    new Set(d.calendars.filter(c => c.visible).map(c => c.id)))
  for (const o of occ) {
    for (const m of o.ev.reminders) {
      const at = o.start.getTime() - m * MINUTE
      const key = o.key + '|' + o.start.getTime() + '|' + m
      if (at <= now && at > windowStart && !fired.has(key)) {
        remember(key)
        const when = o.ev.allDay ? fmtRelativeDay(o.start) : (m === 0 ? 'Maintenant' : fmtRelativeDay(o.start) + ' à ' + fmtTime(o.start, d.settings.h12))
        notify(o.ev.title || 'Événement', when + (o.ev.location ? ' · ' + o.ev.location : ''))
        chime()
      }
    }
  }
  for (const t of d.tasks) {
    if (t.done || !t.due || !t.dueTime) continue
    const at = parse(t.due + 'T' + t.dueTime).getTime()
    const key = 'task|' + t.id + '|' + at
    if (at <= now && at > windowStart && !fired.has(key)) {
      remember(key)
      notify('Tâche à échéance', t.title)
      chime()
    }
  }
}

let timer
export function startReminders() {
  clearInterval(timer)
  check()
  timer = setInterval(check, 15000)
}

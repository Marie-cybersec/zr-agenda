// Émission des rappels : notifications Windows natives via le processus principal.
// Le calcul (quels rappels, heures calmes, rappels manqués) est dans core/alerts.js.

import { db, ui, setUi, updateItem } from './store.js'
import { dueAlerts } from './core/alerts.js'
import { MINUTE } from './dates.js'

const FIRED_KEY = 'zr-fired-reminders'
const LAST_KEY = 'zr-last-reminder-check'

let fired
try { fired = new Set(JSON.parse(localStorage.getItem(FIRED_KEY) || '[]')) } catch { fired = new Set() }
const remember = k => {
  fired.add(k)
  try { localStorage.setItem(FIRED_KEY, JSON.stringify([...fired].slice(-800))) } catch {}
}
const readLast = () => { try { return Number(localStorage.getItem(LAST_KEY)) || 0 } catch { return 0 } }
const writeLast = t => { try { localStorage.setItem(LAST_KEY, String(t)) } catch {} }

let audio
export function chime(times = 1) {
  if (!db()?.settings.sound) return
  try {
    audio = audio || new AudioContext()
    for (let i = 0; i < times; i++) {
      const t = audio.currentTime + i * 0.9
      ;[[880, 0], [1318.5, 0.12]].forEach(([f, dt]) => {
        const o = audio.createOscillator(), g = audio.createGain()
        o.type = 'sine'; o.frequency.value = f
        g.gain.setValueAtTime(0.0001, t + dt)
        g.gain.exponentialRampToValueAtTime(0.12, t + dt + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.6)
        o.connect(g).connect(audio.destination)
        o.start(t + dt); o.stop(t + dt + 0.65)
      })
    }
  } catch {}
}

// Notification système ; repli sur l'API du navigateur si le pont n'est pas disponible.
export function notify(title, body, opts = {}) {
  if (!db()?.settings.notifications) return
  if (window.zr?.notify) { window.zr.notify({ title, body, alarm: !!opts.alarm, tag: opts.tag || null }); return }
  try {
    const n = new Notification(title, { body, silent: true, requireInteraction: !!opts.alarm })
    n.onclick = () => window.zr.focus()
  } catch {}
}

function check() {
  const d = db()
  if (!d) return
  const now = new Date()
  const last = readLast() || now - 2 * MINUTE
  const { live, missed } = dueAlerts(d, new Date(last), now, fired)
  writeLast(+now)
  for (const a of live) {
    remember(a.key)
    notify(a.title, a.body, { alarm: a.alarm, tag: a.kind })
    chime(a.alarm ? 3 : 1)
    // Un rappel unique est considéré comme traité une fois émis
    if (a.kind === 'reminder' && a.ref) {
      const r = d.reminders.find(x => x.id === a.ref)
      if (r && !r.repeat) updateItem('reminders', r.id, { done: true })
    }
  }
  if (missed.length) {
    missed.forEach(a => remember(a.key))
    setUi({ missed: [...ui().missed, ...missed].slice(-50) })
    const loud = missed.filter(a => !a.quiet)
    if (loud.length) notify(loud.length === 1 ? 'Rappel manqué : ' + loud[0].title : loud.length + ' rappels manqués', loud.length === 1 ? loud[0].body : 'Ouvrez ZR Agenda pour les consulter.')
  }
}

let timer
export function startReminders() {
  clearInterval(timer)
  check()
  timer = setInterval(check, 15000)
}

export function checkNow() { check() }

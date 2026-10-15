// Minuteur de concentration (technique Pomodoro).

import { html, useState, useEffect } from './lib.js'
import { Icon } from './icons.js'
import { IconButton, cx } from './ui.js'
import { db, useDb, toast, logFocus } from './store.js'
import { notify, chime } from './reminders.js'

const state = { mode: 'focus', running: false, endsAt: 0, remaining: null, sessions: 0, categoryId: null }
const subs = new Set()
const emit = () => subs.forEach(f => f())
let tick = null

const total = () => (state.mode === 'focus' ? db().settings.focusMinutes : db().settings.breakMinutes) * 60000
export const remaining = () => state.running ? Math.max(0, state.endsAt - Date.now()) : state.remaining ?? total()

function loop() {
  clearInterval(tick)
  tick = setInterval(() => {
    if (!state.running) return
    if (Date.now() >= state.endsAt) {
      const wasFocus = state.mode === 'focus'
      if (wasFocus) { state.sessions++; logFocus(db().settings.focusMinutes, state.categoryId) }
      state.mode = wasFocus ? 'break' : 'focus'
      state.running = false
      state.remaining = null
      const msg = wasFocus ? 'Session terminée. Accordez-vous une pause.' : 'Pause terminée. Prêt pour la suite ?'
      if (db().settings.notify?.focus !== false) { notify('Concentration', msg); chime() }
      toast(msg)
    }
    emit()
  }, 500)
}

export function start() { state.running = true; state.endsAt = Date.now() + remaining(); loop(); emit() }
export function pause() { state.remaining = remaining(); state.running = false; emit() }
export function reset() { state.running = false; state.remaining = null; emit() }
export function switchMode(m) { state.mode = m; reset() }

export function useFocus() {
  const [, force] = useState(0)
  useEffect(() => { const f = () => force(x => x + 1); subs.add(f); return () => subs.delete(f) }, [])
  return state
}

const fmt = ms => { const s = Math.ceil(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') }

export function FocusCard() {
  const f = useFocus()
  const d = useDb()
  const rem = remaining()
  const pct = 1 - rem / total()
  const R = 54, C = 2 * Math.PI * R
  return html`
    <div class="focus-card">
      <div class="focus-modes">
        <button class=${cx('fm', f.mode === 'focus' && 'active')} onClick=${() => switchMode('focus')}>Concentration</button>
        <button class=${cx('fm', f.mode === 'break' && 'active')} onClick=${() => switchMode('break')}>Pause</button>
      </div>
      <div class="focus-ring">
        <svg viewBox="0 0 128 128" width="128" height="128">
          <circle cx="64" cy="64" r=${R} class="ring-track" />
          <circle cx="64" cy="64" r=${R} class=${cx('ring-value', f.mode === 'break' && 'break')} stroke-dasharray=${C} stroke-dashoffset=${C * (1 - pct)} transform="rotate(-90 64 64)" />
        </svg>
        <div class="focus-time">${fmt(rem)}</div>
      </div>
      ${d.categories.length > 0 && html`<select class="input select focus-cat" value=${f.categoryId || ''} aria-label="Catégorie de la session"
        onChange=${e => { state.categoryId = e.target.value || null; emit() }}>
        <option value="">Sans catégorie</option>
        ${d.categories.map(c => html`<option value=${c.id}>${c.name}</option>`)}
      </select>`}
      <div class="focus-controls">
        <${IconButton} icon="reset" label="Réinitialiser" onClick=${reset} />
        <button class="btn btn-primary focus-main" onClick=${() => f.running ? pause() : start()}>
          <${Icon} name=${f.running ? 'pause' : 'play'} size=${14} />${f.running ? 'Pause' : rem < total() ? 'Reprendre' : 'Démarrer'}
        </button>
        <span class="focus-sessions" title="Sessions terminées">${f.sessions} <${Icon} name="target" size=${14} /></span>
      </div>
    </div>`
}

export function FocusMini() {
  const f = useFocus()
  if (!f.running && f.remaining == null) return null
  return html`<button class=${cx('focus-mini', f.mode === 'break' && 'break')} onClick=${() => f.running ? pause() : start()} title=${f.running ? 'Mettre en pause' : 'Reprendre'}>
    <${Icon} name=${f.running ? 'pause' : 'play'} size=${12} />
    <span>${f.mode === 'focus' ? 'Concentration' : 'Pause'}</span>
    <span class="mono">${fmt(remaining())}</span>
  </button>`
}

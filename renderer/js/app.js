import { html, render, useState, useEffect, useRef } from './lib.js'
import { startOfDay, diffDays, parse } from './dates.js'
import { Icon, Logo } from './icons.js'
import { Floating, Menu, DialogHost, Toasts, IconButton, Kbd, cx } from './ui.js'
import {
  useDb, useUi, db, ui, setUi, loadDb, unloadDb, flushSync, mutate, toast, addNote, addTask, ACCENTS, CAL_COLORS
} from './store.js'
import { CalendarSection, CalendarPopovers, MiniCalendar, navigate, createAt, deleteOccurrence, editOccurrence } from './calendar.js'
import { EventEditor } from './editor.js'
import { TasksSection, TaskPopovers } from './tasks.js'
import { NotesSection, NotePopovers } from './notes.js'
import { TodaySection } from './today.js'
import { InsightsSection } from './insights.js'
import { CommandPalette } from './palette.js'
import { SettingsModal, ShortcutsModal } from './settings.js'
import { FocusMini } from './focus.js'
import { startReminders } from './reminders.js'

const api = window.zr

// ─── Thème ──────────────────────────────────────────────────────────────────

const media = window.matchMedia('(prefers-color-scheme: dark)')
function applyTheme(s) {
  const root = document.documentElement
  const theme = s.theme === 'system' ? (media.matches ? 'dark' : 'light') : s.theme
  root.dataset.theme = theme
  root.dataset.density = s.density
  root.style.setProperty('--accent', ACCENTS[s.accent] || ACCENTS.zyrha)
  try { localStorage.setItem('zr-theme', JSON.stringify({ theme, accent: ACCENTS[s.accent] })) } catch {}
}
// Applique le dernier thème connu avant le chargement (évite un flash)
try {
  const t = JSON.parse(localStorage.getItem('zr-theme') || 'null')
  if (t) { document.documentElement.dataset.theme = t.theme; document.documentElement.style.setProperty('--accent', t.accent) }
  else document.documentElement.dataset.theme = media.matches ? 'dark' : 'light'
} catch {}

// ─── Barre de titre ─────────────────────────────────────────────────────────

function Titlebar({ locked }) {
  const [max, setMax] = useState(false)
  useEffect(() => { api.isMaximized().then(setMax); api.onMaximized(setMax) }, [])
  return html`
    <div class="titlebar" onDblClick=${e => { if (e.target.classList.contains('titlebar') || e.target.classList.contains('tb-drag')) api.maximize() }}>
      <div class="tb-brand"><${Logo} size=${18} /><span>ZR Agenda</span></div>
      <div class="tb-drag">
        ${!locked && html`<button class="tb-search" onClick=${() => setUi({ palette: true })}>
          <${Icon} name="search" size=${14} /><span>Rechercher ou lancer une commande</span><${Kbd}>Ctrl K</${Kbd}>
        </button>`}
      </div>
      <div class="tb-controls">
        <button class="tb-btn" aria-label="Réduire" onClick=${() => api.minimize()}>
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" stroke-width="1"/></svg></button>
        <button class="tb-btn" aria-label=${max ? 'Restaurer' : 'Agrandir'} onClick=${() => api.maximize()}>
          ${max ? html`<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1"><rect x=".5" y="2.5" width="7" height="7"/><path d="M2.5 2.5V.5h7v7h-2"/></svg>`
            : html`<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1"><rect x=".5" y=".5" width="9" height="9"/></svg>`}</button>
        <button class="tb-btn close" aria-label="Fermer" onClick=${() => api.close()}>
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1"><path d="M0 0l10 10M10 0L0 10"/></svg></button>
      </div>
    </div>`
}

// ─── Barre latérale ─────────────────────────────────────────────────────────

const SECTIONS = [
  ['today', "Aujourd'hui", 'sun'],
  ['calendar', 'Calendrier', 'calendar'],
  ['tasks', 'Tâches', 'tasks'],
  ['notes', 'Notes', 'note'],
  ['insights', 'Analyse', 'chart']
]

function Sidebar({ onLock }) {
  const d = useDb()
  const u = useUi()
  const now = new Date()
  const dueCount = d.tasks.filter(t => !t.done && t.due && diffDays(now, parse(t.due)) <= 0).length
  const create = e => setUi({ popover: { kind: 'create-menu', rect: e.currentTarget.getBoundingClientRect() } })
  if (u.sidebarCollapsed) return html`
    <nav class="sidebar collapsed">
      <button class="create-btn icon-only" onClick=${create} title="Créer"><${Icon} name="plus" size=${18} /></button>
      ${SECTIONS.map(([k, label, icon], i) => html`<button class=${cx('nav-item', u.section === k && 'active')} title=${label + ' (Alt+' + (i + 1) + ')'}
        onClick=${() => setUi({ section: k })}><${Icon} name=${icon} size=${17} /></button>`)}
      <div class="grow"></div>
      <${IconButton} icon="sidebar" label="Déplier la barre latérale" kbd="Ctrl+B" onClick=${() => setUi({ sidebarCollapsed: false })} />
    </nav>`
  return html`
    <nav class="sidebar">
      <button class="create-btn" onClick=${create}><${Icon} name="plus" size=${16} />Créer<${Icon} name="chevronDown" size=${14} class="create-caret" /></button>
      <div class="nav">
        ${SECTIONS.map(([k, label, icon], i) => html`<button class=${cx('nav-item', u.section === k && 'active')} onClick=${() => setUi({ section: k })}>
          <${Icon} name=${icon} size=${16} /><span>${label}</span>
          ${k === 'tasks' && dueCount > 0 && html`<span class="nav-count">${dueCount}</span>`}
          <span class="nav-kbd">Alt ${i + 1}</span>
        </button>`)}
      </div>

      <${MiniCalendar} />

      <div class="side-group">
        <div class="side-title">
          <span>Mes agendas</span>
          <${IconButton} icon="plus" size=${14} label="Ajouter un agenda" onClick=${() => {
            mutate(x => { x.calendars = [...x.calendars, { id: crypto.randomUUID(), name: 'Nouvel agenda', color: CAL_COLORS[x.calendars.length % CAL_COLORS.length], visible: true }] })
            setUi({ settings: 'calendar' })
          }} />
        </div>
        ${d.calendars.map(c => html`
          <div class="cal-item" key=${c.id} onContextMenu=${e => { e.preventDefault(); setUi({ popover: { kind: 'calendar-menu', rect: { x: e.clientX, y: e.clientY }, payload: c } }) }}>
            <button class=${cx('cal-check', c.visible && 'on')} style=${{ '--c': c.color }} aria-label=${(c.visible ? 'Masquer ' : 'Afficher ') + c.name}
              onClick=${() => mutate(x => { x.calendars = x.calendars.map(k => k.id === c.id ? { ...k, visible: !k.visible } : k) })}>
              ${c.visible && html`<${Icon} name="check" size=${11} stroke=${3} />`}
            </button>
            <span class="cal-name">${c.name}</span>
            <button class="cal-more" aria-label="Options" onClick=${e => setUi({ popover: { kind: 'calendar-menu', rect: e.currentTarget.getBoundingClientRect(), payload: c } })}>
              <${Icon} name="more" size=${14} /></button>
          </div>`)}
      </div>

      <div class="grow"></div>
      <${FocusMini} />
      <div class="side-foot">
        <${IconButton} icon="settings" label="Paramètres" kbd="Ctrl+," onClick=${() => setUi({ settings: 'general' })} />
        <${IconButton} icon="keyboard" label="Raccourcis clavier" kbd="?" onClick=${() => setUi({ shortcuts: true })} />
        <${IconButton} icon="lock" label="Verrouiller" kbd="Ctrl+L" onClick=${onLock} />
        <span class="grow"></span>
        <${IconButton} icon="sidebar" label="Replier la barre latérale" kbd="Ctrl+B" onClick=${() => setUi({ sidebarCollapsed: true })} />
      </div>
    </nav>`
}

function SidebarPopovers() {
  const u = useUi()
  const p = u.popover
  if (!p) return null
  const close = () => setUi({ popover: null })
  if (p.kind === 'create-menu') {
    const items = [
      { label: 'Événement', icon: 'calendarPlus', hint: 'C', onClick: () => { const x = new Date(); x.setMinutes(0, 0, 0); x.setHours(x.getHours() + 1); createAt(x) } },
      { label: 'Tâche', icon: 'tasks', hint: 'Ctrl+Maj+T', onClick: () => { const t = addTask({ title: '' }); setUi({ section: 'tasks', selectedTask: t.id }) } },
      { label: 'Note', icon: 'note', hint: 'Ctrl+N', onClick: () => { const n = addNote({}); setUi({ section: 'notes', selectedNote: n.id }) } },
      '-',
      { label: 'Ajout rapide…', icon: 'command', hint: '/', onClick: () => { setUi({ section: 'calendar' }); setTimeout(() => window.dispatchEvent(new Event('zr:quick-add')), 50) } }
    ]
    return html`<${Floating} anchor=${p.rect} onClose=${close} width=${232}><${Menu} items=${items} onClose=${close} /><//>`
  }
  if (p.kind === 'calendar-menu') {
    const c = p.payload
    const items = [
      { label: 'Afficher uniquement celui-ci', icon: 'calendar', onClick: () => mutate(x => { x.calendars = x.calendars.map(k => ({ ...k, visible: k.id === c.id })) }) },
      { label: 'Tout afficher', icon: 'check', onClick: () => mutate(x => { x.calendars = x.calendars.map(k => ({ ...k, visible: true })) }) },
      { label: 'Gérer les agendas…', icon: 'settings', onClick: () => setUi({ settings: 'calendar' }) },
      '-',
      ...CAL_COLORS.map(col => ({ label: '', color: col, checked: col === c.color, onClick: () => mutate(x => { x.calendars = x.calendars.map(k => k.id === c.id ? { ...k, color: col } : k) }) }))
    ]
    return html`<${Floating} anchor=${p.rect} onClose=${close} width=${232}><div class="cal-menu"><${Menu} items=${items.slice(0, 5)} onClose=${close} />
      <div class="swatches menu-swatches">${CAL_COLORS.map(col => html`<button class=${cx('swatch', col === c.color && 'active')} style=${{ background: col }} aria-label="Couleur"
        onClick=${() => { mutate(x => { x.calendars = x.calendars.map(k => k.id === c.id ? { ...k, color: col } : k) }); close() }}></button>`)}</div></div><//>`
  }
  return null
}

// ─── Verrouillage ───────────────────────────────────────────────────────────

function LockScreen({ onUnlock }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef()
  useEffect(() => { ref.current.focus() }, [])
  const submit = async e => {
    e.preventDefault()
    if (!pw || busy) return
    setBusy(true)
    const ok = await api.unlock(pw)
    setBusy(false)
    if (ok) onUnlock()
    else { setErr(true); setPw(''); setTimeout(() => setErr(false), 600); ref.current.focus() }
  }
  return html`
    <div class="lock">
      <form class=${cx('lock-card', err && 'shake')} onSubmit=${submit}>
        <${Logo} size=${44} />
        <h1>ZR Agenda est verrouillé</h1>
        <p>Saisissez votre mot de passe pour déchiffrer vos données.</p>
        <div class="lock-field">
          <${Icon} name="lock" size=${16} />
          <input ref=${ref} type="password" placeholder="Mot de passe" value=${pw} onInput=${e => setPw(e.target.value)} />
          <button class="btn btn-primary" disabled=${busy || !pw}>${busy ? 'Déchiffrement…' : 'Déverrouiller'}</button>
        </div>
        ${err && html`<div class="lock-error">Mot de passe incorrect</div>`}
      </form>
    </div>`
}

// ─── Raccourcis globaux ─────────────────────────────────────────────────────

function isTyping(e) {
  const t = e.target
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
}

function useShortcuts(onLock) {
  useEffect(() => {
    const onKey = e => {
      const u = ui()
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (mod && k === 'k' && !(e.target.isContentEditable)) { e.preventDefault(); setUi({ palette: !u.palette, popover: null }); return }
      if (mod && e.key === ',') { e.preventDefault(); setUi({ settings: 'general' }); return }
      if (mod && k === 'l') { e.preventDefault(); onLock(); return }
      if (mod && !e.shiftKey && k === 'n') { e.preventDefault(); const n = addNote({}); setUi({ section: 'notes', selectedNote: n.id, palette: false }); return }
      if (mod && e.shiftKey && k === 't') { e.preventDefault(); const t = addTask({ title: '' }); setUi({ section: 'tasks', selectedTask: t.id }); return }
      if (mod && k === 'b' && !isTyping(e)) { e.preventDefault(); setUi({ sidebarCollapsed: !u.sidebarCollapsed }); return }
      if (e.altKey && /^[1-5]$/.test(e.key)) { e.preventDefault(); setUi({ section: SECTIONS[Number(e.key) - 1][0], popover: null }); return }
      if (mod || e.altKey || isTyping(e)) return
      if (u.editor || u.palette || u.settings || u.dialog || u.shortcuts) return
      if (u.popover) {
        if ((e.key === 'Delete' || e.key === 'Backspace') && u.popover.kind === 'event') { e.preventDefault(); deleteOccurrence(u.popover.payload) }
        if (e.key === 'Enter' && u.popover.kind === 'event') { e.preventDefault(); editOccurrence(u.popover.payload) }
        return
      }
      if (e.key === '?') { setUi({ shortcuts: true }); return }
      if (e.key === 'Escape' && u.section === 'tasks' && u.selectedTask) { setUi({ selectedTask: null }); return }
      const views = { j: 'day', d: 'day', s: 'week', w: 'week', m: 'month', a: 'year', y: 'year', l: 'list' }
      if (k === 'c') { e.preventDefault(); const x = new Date(); x.setMinutes(0, 0, 0); x.setHours(x.getHours() + 1); createAt(u.section === 'calendar' && !sameDayAsToday(u.date) ? withHour(u.date, 9) : x) }
      else if (k === '/') { e.preventDefault(); setUi({ section: 'calendar' }); setTimeout(() => window.dispatchEvent(new Event('zr:quick-add')), 30) }
      else if (u.section === 'calendar') {
        if (k === 't') navigate(0)
        else if (e.key === 'ArrowLeft') navigate(-1)
        else if (e.key === 'ArrowRight') navigate(1)
        else if (views[k]) setUi({ view: views[k] })
      } else if (k === 't') setUi({ section: 'calendar', date: startOfDay(new Date()) })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

const sameDayAsToday = d => startOfDay(d).getTime() === startOfDay(new Date()).getTime()
const withHour = (d, h) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x }

// ─── Application ────────────────────────────────────────────────────────────

function Shell({ onLock }) {
  const d = useDb()
  const u = useUi()
  useShortcuts(onLock)
  useEffect(() => { applyTheme(d.settings) }, [d.settings.theme, d.settings.accent, d.settings.density])
  useEffect(() => {
    const f = () => applyTheme(db().settings)
    media.addEventListener('change', f)
    return () => media.removeEventListener('change', f)
  }, [])

  // Verrouillage automatique après inactivité
  useEffect(() => {
    let last = Date.now()
    const bump = () => { last = Date.now() }
    const evs = ['mousemove', 'keydown', 'mousedown', 'wheel']
    evs.forEach(e => window.addEventListener(e, bump, { passive: true }))
    const t = setInterval(() => {
      const m = db()?.settings.autoLockMin
      if (m && Date.now() - last > m * 60000) onLock(true)
    }, 15000)
    return () => { evs.forEach(e => window.removeEventListener(e, bump)); clearInterval(t) }
  }, [])

  return html`
    <div class="shell">
      <${Sidebar} onLock=${() => onLock()} />
      <main class="main">
        ${u.section === 'today' && html`<${TodaySection} />`}
        ${u.section === 'calendar' && html`<${CalendarSection} />`}
        ${u.section === 'tasks' && html`<${TasksSection} />`}
        ${u.section === 'notes' && html`<${NotesSection} />`}
        ${u.section === 'insights' && html`<${InsightsSection} />`}
      </main>
    </div>
    <${EventEditor} />
    <${CalendarPopovers} />
    <${TaskPopovers} />
    <${NotePopovers} />
    <${SidebarPopovers} />
    <${CommandPalette} />
    <${SettingsModal} />
    <${ShortcutsModal} />`
}

function App() {
  const [phase, setPhase] = useState('loading')
  const [error, setError] = useState(null)

  const boot = async () => {
    const st = await api.vaultStatus()
    if (st.locked) return setPhase('locked')
    const r = await loadDb()
    if (r.error) { setError(r); return setPhase(r.error === 'locked' ? 'locked' : 'error') }
    const s = db().settings
    applyTheme(s)
    setUi({ section: s.startSection || 'today', view: s.defaultView, date: startOfDay(new Date()) })
    startReminders()
    setPhase('ready')
  }

  useEffect(() => { boot() }, [])
  useEffect(() => {
    const f = () => lock()
    window.addEventListener('zr:lock', f)
    window.addEventListener('beforeunload', flushSync)
    return () => { window.removeEventListener('zr:lock', f); window.removeEventListener('beforeunload', flushSync) }
  }, [])

  const lock = async auto => {
    const st = await api.vaultStatus()
    if (st.mode !== 'password') {
      if (!auto) toast('Définissez un mot de passe pour pouvoir verrouiller', { action: 'Configurer', onAction: () => setUi({ settings: 'security' }) })
      return
    }
    unloadDb()
    await api.lock()
    setUi({ editor: null, popover: null, palette: false, settings: null, dialog: null })
    setPhase('locked')
  }

  return html`
    <div class="app">
      <${Titlebar} locked=${phase !== 'ready'} />
      ${phase === 'loading' && html`<div class="boot"><${Logo} size=${36} /></div>`}
      ${phase === 'locked' && html`<${LockScreen} onUnlock=${boot} />`}
      ${phase === 'error' && html`<div class="boot error"><${Logo} size=${36} />
        <h2>Impossible de lire vos données</h2>
        <p>Le fichier chiffré est illisible avec la clé actuelle. Vos sauvegardes quotidiennes se trouvent dans le dossier des données.</p>
        <button class="btn btn-secondary" onClick=${() => api.openDataDir()}>Ouvrir le dossier</button></div>`}
      ${phase === 'ready' && html`<${Shell} onLock=${lock} />`}
      <${DialogHost} />
      <${Toasts} />
    </div>`
}

render(html`<${App} />`, document.getElementById('root'))

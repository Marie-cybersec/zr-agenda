// État global : données persistées (db) et état d'interface (ui).

import { useState, useEffect } from './lib.js'
import { parse, toIso, addDays, ymd, startOfDay } from './dates.js'

const api = window.zr

export const CAL_COLORS = ['#5E6AD2', '#2F80ED', '#0E9F6E', '#D97706', '#E5484D', '#8E4EC6', '#0894B3', '#E8590C', '#64748B']
export const ACCENTS = {
  zyrha: '#E5531D', indigo: '#5E6AD2', blue: '#2F6FED', teal: '#0E8A7E', green: '#2E8B57',
  amber: '#C27803', red: '#D93F3F', pink: '#C8467A', graphite: '#52525B'
}

export const DEFAULT_SETTINGS = {
  userName: '',
  theme: 'system',
  accent: 'zyrha',
  density: 'comfortable',
  weekStart: 1,
  h12: false,
  defaultView: 'week',
  defaultDuration: 60,
  defaultCalendarId: null,
  workStart: 8,
  workEnd: 19,
  hideWeekends: false,
  showWeekNumbers: true,
  showHolidays: true,
  showTasksInCalendar: true,
  hourHeight: 56,
  defaultReminder: 10,
  notifications: true,
  sound: true,
  autoLockMin: 0,
  focusMinutes: 25,
  breakMinutes: 5
}

export const uid = () => crypto.randomUUID()
const nowIso = () => new Date().toISOString()

function freshDb() {
  return {
    version: 2,
    calendars: [
      { id: uid(), name: 'Personnel', color: CAL_COLORS[0], visible: true },
      { id: uid(), name: 'Travail', color: CAL_COLORS[3], visible: true },
      { id: uid(), name: 'Famille', color: CAL_COLORS[2], visible: true }
    ],
    events: [], tasks: [], notes: [], notebooks: [],
    settings: { ...DEFAULT_SETTINGS }
  }
}

// Migration depuis la première version (events {date, start, end, category}).
function migrate(d) {
  if (!d) return freshDb()
  if (d.version === 2) {
    d.settings = { ...DEFAULT_SETTINGS, ...d.settings }
    // Passage au thème ZYRHA : l'ancien accent par défaut devient l'orange de la marque
    if (!d.settings.zyrhaTheme) { if (d.settings.accent === 'indigo') d.settings.accent = 'zyrha'; d.settings.zyrhaTheme = true }
    for (const k of ['calendars', 'events', 'tasks', 'notes', 'notebooks']) d[k] = d[k] || []
    if (!d.calendars.length) d.calendars = freshDb().calendars
    return d
  }
  const out = freshDb()
  const legacy = { work: ['Travail', 1], personal: ['Personnel', 0], meeting: ['Réunions', 5], health: ['Santé', 4], other: ['Autre', 8] }
  const calByCat = {}
  out.calendars = []
  for (const [k, [name, ci]] of Object.entries(legacy)) {
    const c = { id: uid(), name, color: CAL_COLORS[ci], visible: true }
    calByCat[k] = c
    if (['work', 'personal'].includes(k) || (d.events || []).some(e => e.category === k)) out.calendars.push(c)
  }
  for (const e of d.events || []) {
    const date = e.date || ymd(new Date())
    const allDay = !e.start
    const s = parse(date + 'T' + (e.start || '00:00'))
    let en = allDay ? addDays(s, 1) : e.end ? parse(date + 'T' + e.end) : new Date(s.getTime() + 3600000)
    if (en <= s) en = new Date(s.getTime() + 3600000)
    out.events.push({
      id: e.id || uid(), title: e.title || 'Sans titre', calendarId: (calByCat[e.category] || calByCat.other).id,
      allDay, start: toIso(s), end: toIso(en), location: '', description: e.description || '',
      recurrence: null, exdates: [], reminders: [], createdAt: e.createdAt || nowIso(), updatedAt: nowIso()
    })
    if (!out.calendars.includes(calByCat[e.category] || calByCat.other)) out.calendars.push(calByCat[e.category] || calByCat.other)
  }
  out.notebooks = (d.notebooks || []).map(n => ({ id: n.id, name: n.name, color: n.color || CAL_COLORS[0] }))
  out.notes = (d.notes || []).map(n => ({
    id: n.id, title: n.title || '', content: n.content || '', notebookId: n.notebookId || null,
    pinned: false, createdAt: n.createdAt || nowIso(), updatedAt: n.updatedAt || nowIso()
  }))
  return out
}

// ─── Store générique ────────────────────────────────────────────────────────

function createStore(initial) {
  let state = initial
  const subs = new Set()
  return {
    get: () => state,
    set(patch) {
      state = typeof patch === 'function' ? patch(state) : { ...state, ...patch }
      subs.forEach(f => f(state))
    },
    subscribe(f) { subs.add(f); return () => subs.delete(f) }
  }
}

function useStore(store) {
  const [, force] = useState(0)
  useEffect(() => store.subscribe(() => force(x => x + 1)), [])
  return store.get()
}

// ─── Données ────────────────────────────────────────────────────────────────

export const dbStore = createStore(null)
export const useDb = () => useStore(dbStore)
export const db = () => dbStore.get()

let saveTimer = null
let pending = false

function scheduleSave() {
  pending = true
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flush, 350)
}

export async function flush() {
  if (!pending || !dbStore.get()) return
  pending = false
  clearTimeout(saveTimer)
  await api.save(dbStore.get())
}

export function flushSync() {
  if (!pending || !dbStore.get()) return
  pending = false
  api.saveSync(dbStore.get())
}

export async function loadDb() {
  const r = await api.load()
  if (r.error) return r
  const d = migrate(r.data)
  dbStore.set(() => d)
  if (!r.data || r.data.version !== 2) { pending = true; await flush() }
  return { ok: true }
}

export function unloadDb() { flushSync(); dbStore.set(() => null) }

export function mutate(fn) {
  const next = { ...dbStore.get() }
  fn(next)
  dbStore.set(() => next)
  scheduleSave()
}

export function snapshot() { return structuredClone(dbStore.get()) }
export function restore(snap) { dbStore.set(() => snap); scheduleSave() }

export function setSettings(patch) {
  mutate(d => { d.settings = { ...d.settings, ...patch } })
}

// Événements
export function addEvent(data) {
  const ev = {
    id: uid(), title: '', calendarId: db().settings.defaultCalendarId || db().calendars[0]?.id,
    allDay: false, location: '', description: '', recurrence: null, exdates: [], reminders: [],
    ...data, createdAt: nowIso(), updatedAt: nowIso()
  }
  mutate(d => { d.events = [...d.events, ev] })
  return ev
}

export function updateEvent(id, patch) {
  mutate(d => { d.events = d.events.map(e => e.id === id ? { ...e, ...patch, updatedAt: nowIso() } : e) })
}

export function removeEvent(id) {
  mutate(d => { d.events = d.events.filter(e => e.id !== id) })
}

export function excludeOccurrence(id, day) {
  const ev = db().events.find(e => e.id === id)
  if (ev) updateEvent(id, { exdates: [...(ev.exdates || []), day] })
}

export function endSeriesBefore(id, day) {
  const ev = db().events.find(e => e.id === id)
  if (!ev) return
  const until = ymd(addDays(parse(day), -1))
  if (until < ev.start.slice(0, 10)) return removeEvent(id)
  updateEvent(id, { recurrence: { ...ev.recurrence, until, count: null } })
}

// Détache une occurrence d'une série en événement indépendant.
export function detachOccurrence(id, day, patch) {
  const ev = db().events.find(e => e.id === id)
  if (!ev) return null
  excludeOccurrence(id, day)
  const { id: _, createdAt, updatedAt, exdates, ...rest } = ev
  return addEvent({ ...rest, ...patch, recurrence: null, seriesId: id })
}

// Tâches
export function addTask(data) {
  const t = {
    id: uid(), title: '', notes: '', due: null, dueTime: null, priority: 0, done: false, doneAt: null,
    subtasks: [], repeat: null, ...data, createdAt: nowIso()
  }
  mutate(d => { d.tasks = [t, ...d.tasks] })
  return t
}

export function updateTask(id, patch) {
  mutate(d => { d.tasks = d.tasks.map(t => t.id === id ? { ...t, ...patch } : t) })
}

export function removeTask(id) {
  mutate(d => { d.tasks = d.tasks.filter(t => t.id !== id) })
}

export function toggleTask(id) {
  const t = db().tasks.find(x => x.id === id)
  if (!t) return
  const done = !t.done
  updateTask(id, { done, doneAt: done ? nowIso() : null })
  if (done && t.repeat && t.due) {
    let next = parse(t.due)
    do {
      if (t.repeat === 'daily') next = addDays(next, 1)
      else if (t.repeat === 'weekdays') { next = addDays(next, 1); while ([0, 6].includes(next.getDay())) next = addDays(next, 1) }
      else if (t.repeat === 'weekly') next = addDays(next, 7)
      else if (t.repeat === 'monthly') { const n = new Date(next); n.setMonth(n.getMonth() + 1); next = n }
      else break
    } while (next < startOfDay(new Date()))
    addTask({ title: t.title, notes: t.notes, priority: t.priority, repeat: t.repeat, due: ymd(next), dueTime: t.dueTime,
      subtasks: t.subtasks.map(s => ({ ...s, id: uid(), done: false })) })
  }
}

// Notes
export function addNote(data) {
  const n = { id: uid(), title: '', content: '', notebookId: null, pinned: false, ...data, createdAt: nowIso(), updatedAt: nowIso() }
  mutate(d => { d.notes = [n, ...d.notes] })
  return n
}

export function updateNote(id, patch, touch = true) {
  mutate(d => { d.notes = d.notes.map(n => n.id === id ? { ...n, ...patch, ...(touch ? { updatedAt: nowIso() } : {}) } : n) })
}

export function removeNote(id) {
  mutate(d => { d.notes = d.notes.filter(n => n.id !== id) })
}

// ─── Interface ──────────────────────────────────────────────────────────────

export const uiStore = createStore({
  section: 'calendar',
  view: 'week',
  date: startOfDay(new Date()),
  editor: null,        // { draft, occurrence }
  popover: null,       // { kind, rect, payload }
  palette: false,
  settings: null,      // onglet ouvert
  shortcuts: false,
  selectedTask: null,
  selectedNote: null,
  notebookFilter: 'all',
  sidebarCollapsed: false,
  dialog: null,
  toasts: []
})
export const useUi = () => useStore(uiStore)
export const ui = () => uiStore.get()
export const setUi = patch => uiStore.set(patch)

let toastId = 0
export function toast(message, opts = {}) {
  const id = ++toastId
  const t = { id, message, action: opts.action, onAction: opts.onAction, tone: opts.tone }
  uiStore.set(s => ({ ...s, toasts: [...s.toasts.slice(-2), t] }))
  setTimeout(() => dismissToast(id), opts.duration || (opts.action ? 6000 : 3200))
}
export function dismissToast(id) {
  uiStore.set(s => ({ ...s, toasts: s.toasts.filter(t => t.id !== id) }))
}

// Suppression avec annulation
export function withUndo(label, fn) {
  const snap = snapshot()
  fn()
  toast(label, { action: 'Annuler', onAction: () => { restore(snap); toast('Action annulée') } })
}

// Boîte de dialogue promise : ask({ title, message, actions: [{ label, value, tone }] })
export function ask(opts) {
  return new Promise(resolve => {
    setUi({ dialog: { ...opts, resolve: v => { setUi({ dialog: null }); resolve(v) } } })
  })
}

export function openEditor(draft, occurrence = null) {
  setUi({ editor: { draft: structuredClone(draft), occurrence }, popover: null })
}

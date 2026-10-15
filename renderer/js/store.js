// État global : données persistées (db) et état d'interface (ui).

import { useState, useEffect } from './lib.js'
import { parse, addDays, ymd, startOfDay } from './dates.js'
import { migrate, uid, DB_VERSION } from './core/model.js'

const api = window.zr

export { CAL_COLORS, ACCENTS, DEFAULT_SETTINGS, uid } from './core/model.js'

const nowIso = () => new Date().toISOString()

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
  const before = r.data ? r.data.version : null
  const d = migrate(r.data)
  dbStore.set(() => d)
  if (before !== DB_VERSION) { pending = true; await flush() }
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
    id: uid(), title: '', notes: '', due: null, dueTime: null, priority: 0, done: false, doneAt: null, status: 'todo',
    categoryId: null, estimate: null, reminder: null, subtasks: [], repeat: null, ...data, createdAt: nowIso()
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
  updateTask(id, { done, doneAt: done ? nowIso() : null, status: done ? 'done' : 'todo' })
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
      categoryId: t.categoryId, estimate: t.estimate, reminder: t.reminder,
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

// Statut d'une tâche : à faire, en cours, en attente, terminée
export function setTaskStatus(id, status) {
  const t = db().tasks.find(x => x.id === id)
  if (!t) return
  if ((status === 'done') !== t.done) toggleTask(id)
  updateTask(id, { status })
}

// Collections génériques (habitudes, routines, journal, objectifs, voyages, rappels, catégories, périodes)
export function addItem(coll, data, prepend = false) {
  const item = { id: uid(), ...data, createdAt: nowIso(), updatedAt: nowIso() }
  mutate(d => { d[coll] = prepend ? [item, ...d[coll]] : [...d[coll], item] })
  return item
}
export function updateItem(coll, id, patch) {
  mutate(d => { d[coll] = d[coll].map(x => x.id === id ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch), updatedAt: nowIso() } : x) })
}
export function removeItem(coll, id) {
  mutate(d => { d[coll] = d[coll].filter(x => x.id !== id) })
}

// Pointage d'une habitude pour un jour (valeur absolue, 0 efface)
export function setHabitCount(habitId, day, count) {
  const k = ymd(day)
  mutate(d => {
    const log = { ...(d.habitLogs[habitId] || {}) }
    if (count > 0) log[k] = count; else delete log[k]
    d.habitLogs = { ...d.habitLogs, [habitId]: log }
  })
}

export function toggleRoutineStep(routineId, day, stepId) {
  const k = ymd(day)
  mutate(d => {
    const log = { ...(d.routineLogs[routineId] || {}) }
    const set = new Set(log[k] || [])
    set.has(stepId) ? set.delete(stepId) : set.add(stepId)
    if (set.size) log[k] = [...set]; else delete log[k]
    d.routineLogs = { ...d.routineLogs, [routineId]: log }
  })
}

export function logFocus(minutes, categoryId = null) {
  mutate(d => { d.focusLog = [...d.focusLog, { at: nowIso(), minutes, categoryId }].slice(-5000) })
}

export function setCache(key, value) {
  mutate(d => { d.cache = { ...d.cache, [key]: value } })
}

export const categoryOf = id => db().categories.find(c => c.id === id) || null

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
  missed: [],          // rappels manqués depuis la dernière ouverture
  online: navigator.onLine,
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

// Modèle de données : valeurs par défaut, création et migration de la base.
// Module pur (sans DOM) : utilisable par l'interface et par les tests.

import { parse, toIso, addDays, ymd } from '../dates.js'

export const DB_VERSION = 3

export const CAL_COLORS = ['#5E6AD2', '#2F80ED', '#0E9F6E', '#D97706', '#E5484D', '#8E4EC6', '#0894B3', '#E8590C', '#64748B']
export const ACCENTS = {
  zyrha: '#E5531D', indigo: '#5E6AD2', blue: '#2F6FED', teal: '#0E8A7E', green: '#2E8B57',
  amber: '#C27803', red: '#D93F3F', pink: '#C8467A', graphite: '#52525B'
}

export const DEFAULT_NOTIFY = { events: true, tasks: true, habits: true, routines: true, reminders: true, trips: true, focus: true }

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
  // Journée active : bornes utilisées pour « Combien de temps me reste-t-il ? »
  dayStart: 7,
  dayEnd: 23,
  hideWeekends: false,
  showWeekNumbers: true,
  showHolidays: true,
  showTasksInCalendar: true,
  hourHeight: 56,
  defaultReminder: 10,
  taskReminder: 0,
  tripReminder: 60,
  notifications: true,
  notify: { ...DEFAULT_NOTIFY },
  quietHours: { enabled: false, start: '22:00', end: '07:00' },
  missedWindowHours: 12,
  runInBackground: true,
  launchAtLogin: false,
  sound: true,
  autoLockMin: 0,
  focusMinutes: 25,
  breakMinutes: 5,
  weatherEnabled: false,
  homeLocation: null
}

// Catégories proposées au premier lancement ; entièrement modifiables.
export const DEFAULT_CATEGORIES = [
  ['Université', '#2F80ED'], ['Certifications', '#8E4EC6'], ['Projets personnels', '#0E9F6E'],
  ['Personnel', '#D97706'], ['Santé', '#E5484D']
]

export const uid = () => crypto.randomUUID()
const nowIso = () => new Date().toISOString()

const COLLECTIONS = ['calendars', 'events', 'tasks', 'notes', 'notebooks', 'categories', 'habits', 'routines', 'journal', 'goals', 'trips', 'reminders', 'periods', 'focusLog']
const MAPS = ['habitLogs', 'routineLogs']

export function freshDb() {
  return {
    version: DB_VERSION,
    calendars: [
      { id: uid(), name: 'Personnel', color: CAL_COLORS[0], visible: true },
      { id: uid(), name: 'Travail', color: CAL_COLORS[3], visible: true },
      { id: uid(), name: 'Famille', color: CAL_COLORS[2], visible: true }
    ],
    events: [], tasks: [], notes: [], notebooks: [],
    categories: DEFAULT_CATEGORIES.map(([name, color]) => ({ id: uid(), name, color })),
    habits: [], habitLogs: {}, routines: [], routineLogs: {},
    journal: [], goals: [], trips: [], reminders: [], periods: [], focusLog: [],
    cache: { weather: {} },
    settings: structuredClone(DEFAULT_SETTINGS)
  }
}

// Première version : events { date, start, end, category }.
function fromV1(d) {
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
    const cal = calByCat[e.category] || calByCat.other
    out.events.push({
      id: e.id || uid(), title: e.title || 'Sans titre', calendarId: cal.id,
      allDay, start: toIso(s), end: toIso(en), location: '', description: e.description || '',
      recurrence: null, exdates: [], reminders: [], createdAt: e.createdAt || nowIso(), updatedAt: nowIso()
    })
    if (!out.calendars.includes(cal)) out.calendars.push(cal)
  }
  out.notebooks = (d.notebooks || []).map(n => ({ id: n.id, name: n.name, color: n.color || CAL_COLORS[0] }))
  out.notes = (d.notes || []).map(n => ({
    id: n.id, title: n.title || '', content: n.content || '', notebookId: n.notebookId || null,
    pinned: false, createdAt: n.createdAt || nowIso(), updatedAt: n.updatedAt || nowIso()
  }))
  out.settings.zyrhaTheme = true
  return out
}

// Amène n'importe quelle version connue au format courant, sans perte.
export function migrate(input) {
  if (!input) return freshDb()
  const d = input.version === 2 || input.version === 3 ? input : fromV1(input)
  const firstV3 = d.version !== DB_VERSION
  d.settings = { ...DEFAULT_SETTINGS, ...d.settings }
  d.settings.notify = { ...DEFAULT_NOTIFY, ...(d.settings.notify || {}) }
  d.settings.quietHours = { ...DEFAULT_SETTINGS.quietHours, ...(d.settings.quietHours || {}) }
  // Passage au thème ZYRHA : l'ancien accent par défaut devient l'orange de la marque
  if (!d.settings.zyrhaTheme) { if (d.settings.accent === 'indigo') d.settings.accent = 'zyrha'; d.settings.zyrhaTheme = true }
  for (const k of COLLECTIONS) if (!Array.isArray(d[k])) d[k] = []
  for (const k of MAPS) if (!d[k] || typeof d[k] !== 'object') d[k] = {}
  d.cache = { weather: {}, ...(d.cache || {}) }
  if (!d.calendars.length) d.calendars = freshDb().calendars
  if (firstV3 && !d.categories.length) d.categories = freshDb().categories
  d.tasks = d.tasks.map(t => ({
    categoryId: null, estimate: null, reminder: null, subtasks: [], notes: '', priority: 0, ...t,
    status: t.status || (t.done ? 'done' : 'todo')
  }))
  d.version = DB_VERSION
  return d
}

// Contrôle minimal d'un fichier de sauvegarde avant restauration.
export function isBackup(data) {
  return !!data && (data.version === 2 || data.version === 3) && Array.isArray(data.events)
}

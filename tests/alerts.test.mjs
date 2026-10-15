// Notifications : calcul des rappels, heures calmes, rappels manqués, météo et ICS.

import test from 'node:test'
import assert from 'node:assert/strict'
import { parse, ymd, MINUTE } from '../renderer/js/dates.js'
import { freshDb, migrate, DB_VERSION } from '../renderer/js/core/model.js'
import { collectAlerts, dueAlerts, inQuietHours } from '../renderer/js/core/alerts.js'
import { reminderTimes } from '../renderer/js/core/reminders.js'
import { weatherState, parseForecast, forecastFor, describe, FRESH_MS } from '../renderer/js/core/weather.js'
import { importIcs, exportIcs, resolveTzid } from '../renderer/js/ics.js'

const TZ = process.env.TZ || 'local'

function db() {
  const d = freshDb()
  d.calendars = [{ id: 'cal', name: 'Perso', color: '#000', visible: true }, { id: 'off', name: 'Masqué', color: '#000', visible: false }]
  d.events = [
    { id: 'e1', calendarId: 'cal', title: 'Partiel', start: '2026-10-15T14:00', end: '2026-10-15T16:00', reminders: [10, 1440], location: 'Amphi A' },
    { id: 'e2', calendarId: 'off', title: 'Caché', start: '2026-10-15T14:00', end: '2026-10-15T15:00', reminders: [10] },
    { id: 'e3', calendarId: 'cal', title: 'Cours', start: '2026-10-01T08:00', end: '2026-10-01T09:00', reminders: [15], recurrence: { freq: 'weekly', interval: 1 } }
  ]
  d.tasks = [{ id: 't', title: 'Dossier', done: false, due: '2026-10-15', dueTime: '18:00', reminder: 30 }]
  d.habits = [{ id: 'h', name: 'Méditer', schedule: { type: 'daily' }, startDate: '2026-10-01', time: '07:30', reminder: true }]
  d.routines = [{ id: 'r', name: 'Soir', days: [4], time: '22:00', reminder: true, steps: [{ id: 's', title: 'Préparer le sac', minutes: 5 }] }]
  d.reminders = [{ id: 'm', title: 'Médicament', at: '2026-10-01T08:00', repeat: 'daily', alarm: true }]
  return d
}

const keysOf = list => list.map(a => a.kind + '@' + a.at.toTimeString().slice(0, 5))

test(`[${TZ}] collecte : tous les types, agendas masqués exclus`, () => {
  const a = collectAlerts(db(), parse('2026-10-15T00:00'), parse('2026-10-16T00:00'))
  assert.deepEqual(keysOf(a), ['habit@07:30', 'event@07:45', 'reminder@08:00', 'event@13:50', 'task@17:30', 'routine@22:00'])
  assert.equal(a.find(x => x.kind === 'event' && x.title === 'Partiel').body, 'À 14:00 · Amphi A')
  assert.ok(a.find(x => x.kind === 'reminder').alarm)
})

test(`[${TZ}] rappel la veille (24 h) d'un événement`, () => {
  const a = collectAlerts(db(), parse('2026-10-14T00:00'), parse('2026-10-15T00:00'))
  assert.ok(a.some(x => x.title === 'Partiel' && x.at.getTime() === parse('2026-10-14T14:00').getTime()))
})

test(`[${TZ}] habitude déjà faite ou routine terminée : pas de rappel`, () => {
  const d = db()
  d.habitLogs = { h: { '2026-10-15': 1 } }
  d.routineLogs = { r: { '2026-10-15': ['s'] } }
  const a = collectAlerts(d, parse('2026-10-15T00:00'), parse('2026-10-16T00:00'))
  assert.ok(!a.some(x => x.kind === 'habit' || x.kind === 'routine'))
})

test(`[${TZ}] réglages : type désactivé et rappel de tâche par défaut`, () => {
  const d = db()
  d.settings.notify.events = false
  d.tasks[0].reminder = null
  d.settings.taskReminder = 0
  const a = collectAlerts(d, parse('2026-10-15T00:00'), parse('2026-10-16T00:00'))
  assert.ok(!a.some(x => x.kind === 'event'))
  assert.equal(a.find(x => x.kind === 'task').at.getTime(), parse('2026-10-15T18:00').getTime())
  d.settings.taskReminder = -1
  assert.ok(!collectAlerts(d, parse('2026-10-15T00:00'), parse('2026-10-16T00:00')).some(x => x.kind === 'task'))
})

test(`[${TZ}] heures calmes : plage passant minuit`, () => {
  const q = { enabled: true, start: '22:00', end: '07:00' }
  assert.ok(inQuietHours(parse('2026-10-15T23:30'), q))
  assert.ok(inQuietHours(parse('2026-10-15T06:59'), q))
  assert.ok(!inQuietHours(parse('2026-10-15T07:00'), q))
  assert.ok(!inQuietHours(parse('2026-10-15T21:59'), q))
  assert.ok(!inQuietHours(parse('2026-10-15T23:30'), { ...q, enabled: false }))
  assert.ok(inQuietHours(parse('2026-10-15T13:00'), { enabled: true, start: '12:00', end: '14:00' }))
})

test(`[${TZ}] émission : immédiate, manquée, déjà émise`, () => {
  const d = db()
  const fired = new Set()
  const now = parse('2026-10-15T13:51')
  const r1 = dueAlerts(d, parse('2026-10-15T13:49'), now, fired)
  assert.deepEqual(r1.live.map(a => a.title), ['Partiel'])
  assert.equal(r1.missed.length, 0)
  for (const a of r1.live) fired.add(a.key)
  assert.equal(dueAlerts(d, parse('2026-10-15T13:49'), now, fired).live.length, 0)

  // Application fermée de 7 h à 13 h 51 : les rappels du matin sont « manqués »
  const r2 = dueAlerts(d, parse('2026-10-15T07:00'), now, fired)
  assert.deepEqual(keysOf(r2.missed), ['habit@07:30', 'event@07:45', 'reminder@08:00'])
  assert.equal(r2.live.length, 0)
})

test(`[${TZ}] émission : fenêtre maximale des rappels manqués`, () => {
  const d = db()
  d.settings.missedWindowHours = 2
  const r = dueAlerts(d, parse('2026-10-14T00:00'), parse('2026-10-15T09:40'), new Set())
  assert.deepEqual(keysOf(r.missed), ['event@07:45', 'reminder@08:00'])
})

test(`[${TZ}] émission : heures calmes reportent, sauf les alarmes`, () => {
  const d = db()
  d.settings.quietHours = { enabled: true, start: '22:00', end: '08:30' }
  const r = dueAlerts(d, parse('2026-10-15T07:40'), parse('2026-10-15T08:00'), new Set())
  assert.deepEqual(r.live.map(a => a.kind), ['reminder'])
  assert.deepEqual(r.missed.map(a => a.kind + (a.quiet ? ':calme' : '')), ['event:calme'])
})

test(`[${TZ}] notifications globales désactivées`, () => {
  const d = db()
  d.settings.notifications = false
  const r = dueAlerts(d, parse('2026-10-15T07:00'), parse('2026-10-15T14:00'), new Set())
  assert.equal(r.live.length + r.missed.length, 0)
})

test(`[${TZ}] rappels autonomes : répétitions, unique terminé, exceptions`, () => {
  const from = parse('2026-10-12'), to = parse('2026-10-19')
  assert.equal(reminderTimes({ at: '2026-10-01T08:00', repeat: 'weekdays' }, from, to).length, 5)
  assert.equal(reminderTimes({ at: '2026-10-13T08:00', repeat: null, done: true }, from, to).length, 0)
  assert.equal(reminderTimes({ at: '2026-10-01T08:00', repeat: 'daily', skips: ['2026-10-13'] }, from, to).length, 6)
  assert.deepEqual(reminderTimes({ at: '2026-01-31T09:00', repeat: 'monthly' }, parse('2026-02-01'), parse('2026-04-01')).map(d => d.getDate()), [31])
})

// ─── Persistance du modèle ──────────────────────────────────────────────────

test(`[${TZ}] migration v2 → v3 sans perte`, () => {
  const v2 = {
    version: 2, calendars: [{ id: 'c', name: 'A', color: '#000', visible: true }],
    events: [{ id: 'e', title: 'X', start: '2026-10-15T09:00', end: '2026-10-15T10:00' }],
    tasks: [{ id: 't', title: 'T', done: true, doneAt: '2026-10-15T09:00:00.000Z', subtasks: [], priority: 2, createdAt: '2026-10-01T00:00:00.000Z' }],
    notes: [{ id: 'n', title: 'N', content: '<p>x</p>' }], notebooks: [],
    settings: { userName: 'Bella', accent: 'teal', weekStart: 0 }
  }
  const d = migrate(structuredClone(v2))
  assert.equal(d.version, DB_VERSION)
  assert.equal(d.events[0].title, 'X')
  assert.equal(d.tasks[0].status, 'done')
  assert.equal(d.tasks[0].priority, 2)
  assert.equal(d.notes[0].content, '<p>x</p>')
  assert.equal(d.settings.userName, 'Bella')
  assert.equal(d.settings.weekStart, 0)
  assert.equal(d.settings.dayEnd, 23)
  assert.equal(d.settings.notify.habits, true)
  assert.ok(d.categories.length > 0)
  for (const k of ['habits', 'routines', 'journal', 'goals', 'trips', 'reminders', 'periods', 'focusLog']) assert.deepEqual(d[k], [])
  // Idempotente
  assert.deepEqual(migrate(structuredClone(d)), d)
})

test(`[${TZ}] migration v1 (première version)`, () => {
  const d = migrate({ events: [{ id: 'x', date: '2026-10-15', start: '09:00', end: '08:00', title: 'Inversé', category: 'health' }] })
  assert.equal(d.version, DB_VERSION)
  assert.equal(d.events[0].end, '2026-10-15T10:00')
  assert.ok(d.calendars.some(c => c.name === 'Santé'))
})

test(`[${TZ}] catégories supprimées volontairement : non recréées`, () => {
  const d = migrate(null)
  d.categories = []
  assert.deepEqual(migrate(d).categories, [])
})

// ─── Météo : état de disponibilité ──────────────────────────────────────────

const sample = { timezone: 'Europe/Paris', current: { temperature_2m: 14.2, weather_code: 3, wind_speed_10m: 12 },
  daily: { time: ['2026-10-15', '2026-10-16'], weather_code: [3, 61], temperature_2m_max: [16, 13], temperature_2m_min: [9, 8], precipitation_probability_max: [10, 80] } }

test(`[${TZ}] météo : états à jour, ancien, hors ligne, erreur`, () => {
  const now = Date.parse('2026-10-15T12:00:00Z')
  const data = parseForecast(sample)
  assert.equal(weatherState(null, now, {}).state, 'off')
  assert.equal(weatherState(null, now, { online: false }).state, 'offline')
  assert.equal(weatherState(null, now, { loading: true }).state, 'loading')
  assert.equal(weatherState({ data, fetchedAt: now - 10 * MINUTE }, now, { online: true }).state, 'ok')
  assert.equal(weatherState({ data, fetchedAt: now - FRESH_MS - 1 }, now, { online: true }).state, 'stale')
  const off = weatherState({ data, fetchedAt: now - 10 * MINUTE, error: 'offline', errorAt: now }, now, { online: false })
  assert.equal(off.state, 'stale')
  assert.match(off.label, /Hors ligne/)
  assert.equal(weatherState({ error: 'http 500', errorAt: now }, now, { online: true }).state, 'error')
  assert.equal(forecastFor({ data }, '2026-10-16').rain, 80)
  assert.equal(forecastFor({ data }, '2026-11-30'), null)
  assert.equal(describe(61).label, 'Pluie')
  assert.throws(() => parseForecast({}))
})

// ─── Import / export de calendriers ─────────────────────────────────────────

test(`[${TZ}] ICS : TZID IANA, Windows, UTC et journée entière`, () => {
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:1', 'DTSTART;TZID=America/New_York:20260701T090000', 'DTEND;TZID=America/New_York:20260701T100000', 'SUMMARY:NY', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:2', 'DTSTART;TZID="Romance Standard Time":20260115T090000', 'DURATION:PT1H30M', 'SUMMARY:Outlook', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:3', 'DTSTART:20260701T120000Z', 'DTEND:20260701T130000Z', 'SUMMARY:UTC', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:4', 'DTSTART;VALUE=DATE:20261225', 'DTEND;VALUE=DATE:20261226', 'SUMMARY:Noël', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:5', 'DTSTART;TZID=Europe/Paris:20260907T083000', 'DTEND;TZID=Europe/Paris:20260907T100000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261218T225959Z', 'EXDATE;TZID=Europe/Paris:20260909T083000',
    'SUMMARY:Cours\\, amphi B', 'BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'END:VALARM', 'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')
  const list = importIcs(ics)
  const by = t => list.find(e => e.title === t)
  assert.equal(parse(by('NY').start).toISOString(), '2026-07-01T13:00:00.000Z')
  assert.equal(parse(by('Outlook').start).toISOString(), '2026-01-15T08:00:00.000Z')
  assert.equal((parse(by('Outlook').end) - parse(by('Outlook').start)) / MINUTE, 90)
  assert.equal(parse(by('UTC').start).toISOString(), '2026-07-01T12:00:00.000Z')
  assert.equal(by('Noël').allDay, true)
  assert.equal(by('Noël').start, '2026-12-25T00:00')
  const c = by('Cours, amphi B')
  assert.deepEqual(c.recurrence.byDay, [1, 3])
  // UNTIL est en UTC : la date locale dépend du fuseau de l'appareil
  assert.equal(c.recurrence.until, ymd(new Date(Date.UTC(2026, 11, 18, 22, 59, 59))))
  assert.deepEqual(c.reminders, [15])
  assert.equal(c.exdates.length, 1)
})

test(`[${TZ}] ICS : aller-retour export → import`, () => {
  const events = [
    { id: 'a', title: 'Séance; test, ok', calendarId: 'c', allDay: false, start: '2026-10-15T09:00', end: '2026-10-15T10:30', description: 'Ligne 1\nLigne 2',
      recurrence: { freq: 'weekly', interval: 2, byDay: [1, 4], until: '2026-12-31' }, exdates: ['2026-10-19'], reminders: [10] },
    { id: 'b', title: 'Vacances', calendarId: 'c', allDay: true, start: '2026-12-21T00:00', end: '2027-01-04T00:00', recurrence: null, exdates: [], reminders: [] }
  ]
  const back = importIcs(exportIcs(events, [{ id: 'c', name: 'Perso' }]))
  assert.equal(back.length, 2)
  assert.equal(back[0].title, 'Séance; test, ok')
  assert.equal(back[0].description, 'Ligne 1\nLigne 2')
  assert.equal(back[0].start, '2026-10-15T09:00')
  assert.equal(back[0].recurrence.interval, 2)
  assert.deepEqual(back[0].recurrence.byDay, [1, 4])
  assert.deepEqual(back[0].exdates, ['2026-10-19'])
  assert.equal(back[1].end, '2027-01-04T00:00')
  assert.equal(resolveTzid('/mozilla.org/20070129_1/Europe/Paris'), 'Europe/Paris')
  assert.equal(resolveTzid('Fuseau inconnu'), null)
})

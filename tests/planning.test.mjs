// Habitudes, séries, objectifs, conflits, plan du jour, recherche et exports.

import test from 'node:test'
import assert from 'node:assert/strict'
import { parse, ymd, addDays } from '../renderer/js/dates.js'
import { freshDb } from '../renderer/js/core/model.js'
import { streaks, weekProgress, completionRate, pendingToday, isScheduled, history, describeSchedule, routineProgress } from '../renderer/js/core/habits.js'
import { progress, periodRange } from '../renderer/js/core/goals.js'
import { findConflicts, conflictKeys, draftConflicts } from '../renderer/js/core/conflicts.js'
import { buildDay, timeLeft, urgentItems, coveredMinutes, dayBounds } from '../renderer/js/core/plan.js'
import { legInstants, legsBetween } from '../renderer/js/core/trips.js'
import { searchJournal, searchTasks, snippet, terms } from '../renderer/js/core/search.js'
import { tasksCsv, journalMarkdown, toCsv } from '../renderer/js/core/exporters.js'

const TZ = process.env.TZ || 'local'
const logOf = (...days) => Object.fromEntries(days.map(d => [d, 1]))

// ─── Habitudes ──────────────────────────────────────────────────────────────

test(`[${TZ}] série quotidienne : aujourd'hui non fait ne casse pas la série`, () => {
  const h = { id: 'h', schedule: { type: 'daily' }, startDate: '2026-10-01' }
  const logs = { h: logOf('2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14') }
  assert.deepEqual(streaks(logs, h, parse('2026-10-15')), { current: 5, best: 5, unit: 'jour' })
  logs.h['2026-10-15'] = 1
  assert.equal(streaks(logs, h, parse('2026-10-15')).current, 6)
  delete logs.h['2026-10-14']
  assert.deepEqual(streaks(logs, h, parse('2026-10-15')), { current: 1, best: 4, unit: 'jour' })
})

test(`[${TZ}] série sur jours choisis : les jours non prévus sont ignorés`, () => {
  const h = { id: 'h', schedule: { type: 'days', days: [1, 3, 5] }, startDate: '2026-09-28' }
  // Lun 5, Mer 7, Ven 9, Lun 12, Mer 14 octobre ; jeudi 15 non prévu
  const logs = { h: logOf('2026-10-05', '2026-10-07', '2026-10-09', '2026-10-12', '2026-10-14') }
  assert.equal(streaks(logs, h, parse('2026-10-15')).current, 5)
  assert.ok(!isScheduled(h, parse('2026-10-15')))
  assert.equal(describeSchedule(h), 'lun. mer. ven.')
})

test(`[${TZ}] série à cheval sur un changement de mois et d'année`, () => {
  const h = { id: 'h', schedule: { type: 'daily' }, startDate: '2026-12-29' }
  const logs = { h: logOf('2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02') }
  assert.equal(streaks(logs, h, parse('2027-01-02')).current, 5)
})

test(`[${TZ}] objectif chiffré : la cible journalière doit être atteinte`, () => {
  const h = { id: 'w', schedule: { type: 'daily' }, target: 8, startDate: '2026-10-14' }
  const logs = { w: { '2026-10-14': 8, '2026-10-15': 5 } }
  assert.ok(pendingToday(logs, h, parse('2026-10-15')))
  assert.equal(streaks(logs, h, parse('2026-10-15')).current, 1)
})

test(`[${TZ}] habitude hebdomadaire « 3 fois par semaine »`, () => {
  const h = { id: 'r', schedule: { type: 'weekly', times: 3 }, startDate: '2026-09-28' }
  const logs = { r: logOf('2026-09-28', '2026-09-30', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-08', '2026-10-13') }
  assert.deepEqual(weekProgress(logs, h, parse('2026-10-15')), { done: 1, target: 3 })
  assert.deepEqual(streaks(logs, h, parse('2026-10-15')), { current: 2, best: 2, unit: 'semaine' })
  assert.ok(!pendingToday({ r: { ...logs.r, '2026-10-15': 1 } }, h, parse('2026-10-15')))
})

test(`[${TZ}] historique et taux de réussite`, () => {
  const h = { id: 'h', schedule: { type: 'daily' }, startDate: '2026-10-01' }
  const logs = { h: logOf('2026-10-01', '2026-10-02', '2026-10-04') }
  const hs = history(logs, h, parse('2026-09-30'), parse('2026-10-04'))
  assert.equal(hs.length, 5)
  assert.equal(hs[0].scheduled, false)
  assert.equal(completionRate(logs, h, parse('2026-10-01'), parse('2026-10-04')), 0.75)
})

test(`[${TZ}] progression d'une routine`, () => {
  const r = { id: 'm', days: [4], steps: [{ id: 'a', minutes: 5 }, { id: 'b', minutes: 10 }] }
  assert.deepEqual(routineProgress({ m: { '2026-10-15': ['a'] } }, r, parse('2026-10-15')).done, 1)
  assert.ok(routineProgress({ m: { '2026-10-15': ['a', 'b'] } }, r, parse('2026-10-15')).complete)
})

// ─── Objectifs ──────────────────────────────────────────────────────────────

function db() {
  const d = freshDb()
  d.calendars = [{ id: 'cal', name: 'Perso', color: '#000', visible: true }]
  return d
}

test(`[${TZ}] objectif hebdomadaire de tâches par catégorie`, () => {
  const d = db()
  const cat = d.categories[0].id
  d.tasks = [
    { id: '1', done: true, doneAt: parse('2026-10-12T10:00').toISOString(), categoryId: cat },
    { id: '2', done: true, doneAt: parse('2026-10-15T08:00').toISOString(), categoryId: cat },
    { id: '3', done: true, doneAt: parse('2026-10-15T08:00').toISOString(), categoryId: 'autre' },
    { id: '4', done: true, doneAt: parse('2026-10-11T23:59').toISOString(), categoryId: cat }
  ]
  const g = { id: 'g', period: 'week', metric: 'tasks', target: 3, categoryId: cat }
  const p = progress(g, d, parse('2026-10-15T12:00'))
  assert.equal(p.value, 2)
  assert.equal(p.done, false)
  assert.equal(ymd(p.from), '2026-10-12')
})

test(`[${TZ}] objectif mensuel : bornes du mois, y compris février`, () => {
  const [a, b] = periodRange({ period: 'month' }, parse('2028-02-15'))
  assert.equal(ymd(a), '2028-02-01')
  assert.equal(ymd(b), '2028-03-01')
})

test(`[${TZ}] objectif à échéance (certification) : rythme et jours restants`, () => {
  const d = db()
  const g = { id: 'c', period: 'deadline', metric: 'manual', target: 40, unit: 'h', startDate: '2026-10-01', dueDate: '2026-10-31',
    log: { '2026-10-02': 5, '2026-10-09': 6, '2026-10-14': 4 } }
  const p = progress(g, d, parse('2026-10-15T12:00'))
  assert.equal(p.value, 15)
  assert.equal(p.daysLeft, 16)
  assert.equal(p.pace, 'behind')
  const q = progress({ ...g, log: { ...g.log, '2026-10-15': 10 } }, d, parse('2026-10-15T12:00'))
  assert.equal(q.pace, 'ahead')
})

test(`[${TZ}] objectif de concentration et d'habitude`, () => {
  const d = db()
  d.focusLog = [{ at: parse('2026-10-15T09:00').toISOString(), minutes: 25 }, { at: parse('2026-10-15T10:00').toISOString(), minutes: 25 }, { at: parse('2026-10-14T10:00').toISOString(), minutes: 25 }]
  assert.equal(progress({ period: 'day', metric: 'focus', target: 60 }, d, parse('2026-10-15T12:00')).value, 50)
  d.habitLogs = { h: { '2026-10-13': 2, '2026-10-15': 1, '2026-10-05': 1 } }
  assert.equal(progress({ period: 'week', metric: 'habit', habitId: 'h', target: 5 }, d, parse('2026-10-15T12:00')).value, 3)
})

// ─── Conflits ───────────────────────────────────────────────────────────────

const it = (key, s, e, extra = {}) => ({ key, start: parse(s), end: parse(e), title: key, ...extra })

test(`[${TZ}] conflits : chevauchement strict, contiguïté autorisée`, () => {
  const pairs = findConflicts([
    it('a', '2026-10-15T09:00', '2026-10-15T10:00'),
    it('b', '2026-10-15T10:00', '2026-10-15T11:00'),
    it('c', '2026-10-15T10:30', '2026-10-15T12:00'),
    it('d', '2026-10-15T08:00', '2026-10-15T13:00'),
    it('z', '2026-10-15T11:00', '2026-10-15T11:00')
  ])
  const names = pairs.map(([x, y]) => [x.key, y.key].sort().join('-')).sort()
  assert.deepEqual(names, ['a-d', 'b-c', 'b-d', 'c-d'])
  assert.deepEqual([...conflictKeys(pairs.flat())].sort(), ['a', 'b', 'c', 'd'])
})

test(`[${TZ}] conflits : journées entières ignorées, passage de minuit pris en compte`, () => {
  assert.equal(findConflicts([it('j', '2026-10-15T00:00', '2026-10-16T00:00', { allDay: true }), it('a', '2026-10-15T09:00', '2026-10-15T10:00')]).length, 0)
  assert.equal(findConflicts([it('n', '2026-10-15T23:00', '2026-10-16T01:00'), it('m', '2026-10-16T00:30', '2026-10-16T02:00')]).length, 1)
})

test(`[${TZ}] conflits d'un brouillon récurrent avec un événement futur`, () => {
  const events = [{ id: 'exam', calendarId: 'cal', start: '2026-11-04T09:30', end: '2026-11-04T11:00', recurrence: null }]
  const draft = { title: 'Cours', calendarId: 'cal', start: '2026-10-14T09:00', end: '2026-10-14T10:00', recurrence: { freq: 'weekly', interval: 1, until: '2026-12-18' } }
  const c = draftConflicts(draft, events, new Set(['cal']))
  assert.equal(c.length, 1)
  assert.equal(ymd(c[0].mine.start), '2026-11-04')
  assert.equal(draftConflicts({ ...draft, start: '2026-10-14T11:00', end: '2026-10-14T12:00' }, events, new Set(['cal'])).length, 0)
})

// ─── Plan du jour ───────────────────────────────────────────────────────────

function sampleDb() {
  const d = db()
  d.settings.dayStart = 7; d.settings.dayEnd = 23
  d.events = [
    { id: 'cours', calendarId: 'cal', title: 'Cours de réseaux', start: '2026-10-15T08:00', end: '2026-10-15T10:00', recurrence: { freq: 'weekly', interval: 1 }, exdates: [] },
    { id: 'rdv', calendarId: 'cal', title: 'Rendez-vous', start: '2026-10-15T14:00', end: '2026-10-15T15:00', recurrence: null },
    { id: 'tp', calendarId: 'cal', title: 'TP', start: '2026-10-15T14:30', end: '2026-10-15T16:00', recurrence: null }
  ]
  d.tasks = [
    { id: 't1', title: 'Rendre le rapport', done: false, due: '2026-10-13', priority: 1, estimate: 60, subtasks: [] },
    { id: 't2', title: 'Réviser chapitre 3', done: false, due: '2026-10-15', dueTime: '18:00', priority: 3, estimate: 90, subtasks: [] },
    { id: 't3', title: 'Acheter du pain', done: false, due: '2026-10-15', priority: 0, subtasks: [] },
    { id: 't4', title: 'Plus tard', done: false, due: '2026-10-30', priority: 3, subtasks: [] }
  ]
  d.habits = [{ id: 'h', name: 'Lire', schedule: { type: 'daily' }, startDate: '2026-10-01', time: '21:00' }]
  d.routines = [{ id: 'r', name: 'Routine du matin', days: [4], time: '07:00', steps: [{ id: 's', title: 'Sport', minutes: 30 }] }]
  d.reminders = [{ id: 'rm', title: 'Appeler maman', at: '2026-10-15T19:00', repeat: null }]
  return d
}

test(`[${TZ}] plan du jour : types distincts, tri chronologique, conflits`, () => {
  const p = buildDay(sampleDb(), parse('2026-10-15'), parse('2026-10-15T12:00'))
  assert.deepEqual(p.timed.map(x => x.kind), ['routine', 'event', 'event', 'event', 'task', 'reminder', 'habit'])
  assert.deepEqual(p.untimed.map(x => x.ref.id).sort(), ['t1', 't3'])
  assert.ok(p.untimed.find(x => x.ref.id === 't1').overdue)
  assert.ok(p.conflicts.has('rdv') && p.conflicts.has('tp') && !p.conflicts.has('cours@2026-10-15'))
})

test(`[${TZ}] temps restant : intervalles fusionnés, charge des tâches`, () => {
  const d = sampleDb()
  const t = timeLeft(d, parse('2026-10-15T12:00'))
  assert.equal(t.remaining, 11 * 60)
  assert.equal(t.busy, 120)
  assert.equal(t.free, 540)
  assert.equal(t.taskLoad, 150)
  assert.equal(t.unestimated, 1)
  assert.equal(t.overbooked, false)
  assert.equal(timeLeft(d, parse('2026-10-15T23:30')).remaining, 0)
  assert.equal(coveredMinutes([[parse('2026-10-15T09:00'), parse('2026-10-15T11:00')], [parse('2026-10-15T10:00'), parse('2026-10-15T12:00')]], parse('2026-10-15T00:00'), parse('2026-10-16T00:00')), 180)
})

test(`[${TZ}] fin de journée à minuit`, () => {
  const d = sampleDb(); d.settings.dayEnd = 24
  const [, b] = dayBounds(d, parse('2026-10-31T10:00'))
  assert.equal(ymd(b), '2026-11-01')
})

test(`[${TZ}] urgences : retard, priorité, conflit, échéance proche`, () => {
  const d = sampleDb()
  d.goals = [{ id: 'g', title: 'Certification AZ-900', period: 'deadline', metric: 'manual', target: 10, dueDate: '2026-10-17', startDate: '2026-10-01', log: {} }]
  const u = urgentItems(d, parse('2026-10-15T12:00'))
  const kinds = u.map(x => x.kind + ':' + x.level)
  assert.equal(kinds[0].split(':')[1], 'critical')
  assert.ok(kinds.includes('task:critical'))
  assert.ok(kinds.includes('goal:critical'))
  assert.ok(kinds.includes('conflict:high'))
  assert.ok(u.some(x => x.ref && x.ref.id === 't2'))
  assert.ok(!u.some(x => x.ref && x.ref.id === 't4'))
})

// ─── Déplacements ───────────────────────────────────────────────────────────

test(`[${TZ}] étape de voyage : instants absolus et chevauchement de jour`, () => {
  const leg = { id: 'l', depart: '2026-11-20T10:30', departTz: 'Europe/Paris', arrive: '2026-11-20T13:05', arriveTz: 'America/Montreal' }
  const i = legInstants(leg)
  assert.equal(i.minutes, 515)
  assert.ok(i.valid)
  const trips = [{ id: 't', legs: [leg] }]
  assert.equal(legsBetween(trips, new Date('2026-11-20T00:00:00Z'), new Date('2026-11-21T00:00:00Z')).length, 1)
  assert.equal(legInstants({ ...leg, arrive: '2026-11-20T03:00' }).valid, false)
})

// ─── Recherche et exports ───────────────────────────────────────────────────

test(`[${TZ}] recherche : accents, casse, plusieurs termes`, () => {
  const journal = [
    { id: '1', date: '2026-10-14', title: 'Réunion projet', content: 'Préparé la présentation du mémoire', tags: ['université'] },
    { id: '2', date: '2026-10-15', title: 'Sport', content: 'Course à pied 5 km', tags: [] }
  ]
  assert.deepEqual(searchJournal(journal, 'memoire').map(e => e.id), ['1'])
  assert.deepEqual(searchJournal(journal, 'UNIVERSITE reunion').map(e => e.id), ['1'])
  assert.deepEqual(searchJournal(journal, '').map(e => e.id), ['2', '1'])
  assert.deepEqual(searchTasks([{ title: 'Réviser', notes: '', subtasks: [{ title: 'Chapitre Été' }] }], 'ete').length, 1)
  assert.ok(snippet('a'.repeat(100) + ' mémoire ' + 'b'.repeat(100), terms('memoire'), 10).includes('mémoire'))
})

test(`[${TZ}] exports CSV et Markdown`, () => {
  const csv = toCsv([['a;b', 'c"d', 'e\nf']])
  assert.equal(csv, '﻿"a;b";"c""d";"e\nf"\r\n')
  const d = sampleDb()
  const t = tasksCsv(d)
  assert.ok(t.startsWith('﻿Titre;Statut'))
  assert.equal(t.trim().split('\r\n').length, 5)
  d.journal = [{ date: '2026-10-15', title: 'Bilan', content: 'Bonne journée', mood: 4, tags: ['perso'] }]
  assert.match(journalMarkdown(d), /## 2026-10-15 — Bilan\n\*Humeur : Bien · Étiquettes : perso\*/)
})

test(`[${TZ}] plan : semaine suivante après changement de mois`, () => {
  const d = sampleDb()
  const p = buildDay(d, parse('2026-11-05'), parse('2026-11-05T06:00'))
  assert.ok(p.timed.some(x => x.key === 'cours@2026-11-05'))
  assert.equal(ymd(addDays(parse('2026-10-29'), 7)), '2026-11-05')
})

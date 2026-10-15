// Dates, changements de mois, récurrences et fuseaux horaires.
// Lancés sous plusieurs fuseaux par scripts/run-tests.mjs (TZ=Europe/Paris, America/New_York, Pacific/Auckland, UTC).

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parse, toIso, ymd, addDays, addMonths, startOfWeek, daysInMonth, diffDays, isoWeek, occurrences, expandAll,
  monthMatrix, holidays, fromZoned, wallTimeIn, tzOffsetMinutes, isValidTimeZone, fmtOffset
} from '../renderer/js/dates.js'

const TZ = process.env.TZ || 'local'
const keys = list => list.map(o => toIso(o.start))

test(`[${TZ}] parse/toIso aller-retour en heure murale`, () => {
  for (const s of ['2026-01-01T00:00', '2026-03-29T03:30', '2026-10-25T02:30', '2026-12-31T23:59', '2028-02-29T12:00']) {
    assert.equal(toIso(parse(s)), s)
  }
})

test(`[${TZ}] addMonths borne les fins de mois`, () => {
  assert.equal(ymd(addMonths(parse('2026-01-31'), 1)), '2026-02-28')
  assert.equal(ymd(addMonths(parse('2028-01-31'), 1)), '2028-02-29')
  assert.equal(ymd(addMonths(parse('2026-03-31'), -1)), '2026-02-28')
  assert.equal(ymd(addMonths(parse('2026-12-15'), 1)), '2027-01-15')
  assert.equal(ymd(addMonths(parse('2026-01-15'), -1)), '2025-12-15')
})

test(`[${TZ}] addDays traverse fins de mois, d'année et changements d'heure`, () => {
  assert.equal(ymd(addDays(parse('2026-01-31'), 1)), '2026-02-01')
  assert.equal(ymd(addDays(parse('2026-12-31'), 1)), '2027-01-01')
  assert.equal(ymd(addDays(parse('2028-02-28'), 1)), '2028-02-29')
  assert.equal(toIso(addDays(parse('2026-03-28T09:00'), 1)), '2026-03-29T09:00')
  assert.equal(toIso(addDays(parse('2026-10-24T09:00'), 1)), '2026-10-25T09:00')
  assert.equal(toIso(addDays(parse('2026-11-01T09:00'), 1)), '2026-11-02T09:00')
})

test(`[${TZ}] diffDays exact malgré les journées de 23 h / 25 h`, () => {
  assert.equal(diffDays(parse('2026-03-28'), parse('2026-03-30')), 2)
  assert.equal(diffDays(parse('2026-10-24'), parse('2026-10-26')), 2)
  assert.equal(diffDays(parse('2026-12-31'), parse('2027-01-01')), 1)
})

test(`[${TZ}] début de semaine, jours par mois, numéros ISO`, () => {
  assert.equal(ymd(startOfWeek(parse('2026-10-15'), 1)), '2026-10-12')
  assert.equal(ymd(startOfWeek(parse('2026-10-15'), 0)), '2026-10-11')
  assert.equal(ymd(startOfWeek(parse('2026-11-01'), 1)), '2026-10-26')
  assert.equal(daysInMonth(2026, 1), 28)
  assert.equal(daysInMonth(2028, 1), 29)
  assert.equal(daysInMonth(2100, 1), 28)
  assert.equal(isoWeek(parse('2026-01-01')), 1)
  assert.equal(isoWeek(parse('2027-01-01')), 53)
  assert.equal(isoWeek(parse('2026-12-28')), 53)
})

test(`[${TZ}] grille mensuelle : 42 jours, commence au bon jour`, () => {
  const m = monthMatrix(parse('2026-02-10'), 1)
  assert.equal(m.length, 42)
  assert.equal(ymd(m[0]), '2026-01-26')
  assert.equal(m[0].getDay(), 1)
  assert.ok(m.some(d => ymd(d) === '2026-02-28'))
  assert.equal(new Set(m.map(ymd)).size, 42)
})

test(`[${TZ}] jours fériés : Pâques et dates mobiles`, () => {
  const h = holidays(2026)
  assert.equal(h.get('2026-04-06'), 'Lundi de Pâques')
  assert.equal(h.get('2026-05-14'), 'Ascension')
  assert.equal(h.get('2026-05-25'), 'Lundi de Pentecôte')
  assert.equal(holidays(2027).get('2027-03-29'), 'Lundi de Pâques')
})

// ─── Récurrences ────────────────────────────────────────────────────────────

const ev = (start, end, recurrence, extra = {}) => ({ id: 'e', start, end, recurrence, exdates: [], calendarId: 'c', ...extra })

test(`[${TZ}] quotidien : heure murale conservée au changement d'heure`, () => {
  const o = occurrences(ev('2026-03-27T09:00', '2026-03-27T10:00', { freq: 'daily', interval: 1 }), parse('2026-03-27'), parse('2026-04-01'))
  assert.deepEqual(keys(o), ['2026-03-27T09:00', '2026-03-28T09:00', '2026-03-29T09:00', '2026-03-30T09:00', '2026-03-31T09:00'])
  for (const x of o) assert.equal(toIso(x.end).slice(11), '10:00')
})

test(`[${TZ}] hebdomadaire multi-jours, intervalle 2, fin par date`, () => {
  const e = ev('2026-09-07T08:30', '2026-09-07T10:00', { freq: 'weekly', interval: 2, byDay: [1, 3], until: '2026-10-07' })
  assert.deepEqual(keys(occurrences(e, parse('2026-09-01'), parse('2026-12-01'))),
    ['2026-09-07T08:30', '2026-09-09T08:30', '2026-09-21T08:30', '2026-09-23T08:30', '2026-10-05T08:30', '2026-10-07T08:30'])
})

test(`[${TZ}] mensuel le 31 : mois courts ignorés (RFC 5545)`, () => {
  const e = ev('2026-01-31T12:00', '2026-01-31T13:00', { freq: 'monthly', interval: 1 })
  assert.deepEqual(keys(occurrences(e, parse('2026-01-01'), parse('2026-08-01'))),
    ['2026-01-31T12:00', '2026-03-31T12:00', '2026-05-31T12:00', '2026-07-31T12:00'])
})

test(`[${TZ}] mensuel « dernier vendredi » et « 2e mardi »`, () => {
  const last = ev('2026-01-30T18:00', '2026-01-30T19:00', { freq: 'monthly', interval: 1, monthlyMode: 'weekday', nth: -1 })
  assert.deepEqual(keys(occurrences(last, parse('2026-01-01'), parse('2026-05-01'))).map(s => s.slice(0, 10)),
    ['2026-01-30', '2026-02-27', '2026-03-27', '2026-04-24'])
  const second = ev('2026-01-13T09:00', '2026-01-13T10:00', { freq: 'monthly', interval: 1, monthlyMode: 'weekday' })
  assert.deepEqual(keys(occurrences(second, parse('2026-01-01'), parse('2026-04-01'))).map(s => s.slice(0, 10)),
    ['2026-01-13', '2026-02-10', '2026-03-10'])
})

test(`[${TZ}] annuel 29 février : seulement les années bissextiles`, () => {
  const e = ev('2024-02-29T00:00', '2024-03-01T00:00', { freq: 'yearly', interval: 1 }, { allDay: true })
  assert.deepEqual(keys(occurrences(e, parse('2024-01-01'), parse('2033-01-01'))).map(s => s.slice(0, 10)),
    ['2024-02-29', '2028-02-29', '2032-02-29'])
})

test(`[${TZ}] nombre d'occurrences, exceptions, chevauchement de période`, () => {
  const e = ev('2026-10-01T23:00', '2026-10-02T01:00', { freq: 'daily', interval: 1, count: 5 }, { exdates: ['2026-10-03'] })
  const all = occurrences(e, parse('2026-09-01'), parse('2026-12-01'))
  assert.deepEqual(keys(all).map(s => s.slice(0, 10)), ['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-05'])
  // Une occurrence commencée la veille apparaît sur la journée suivante
  const day = occurrences(e, parse('2026-10-02'), parse('2026-10-03'))
  assert.deepEqual(keys(day), ['2026-10-01T23:00', '2026-10-02T23:00'])
})

test(`[${TZ}] expandAll : filtre des agendas et tri`, () => {
  const list = expandAll([
    ev('2026-10-15T14:00', '2026-10-15T15:00', null, { id: 'b', calendarId: 'x' }),
    ev('2026-10-15T09:00', '2026-10-15T10:00', null, { id: 'a', calendarId: 'x' }),
    ev('2026-10-15T08:00', '2026-10-15T09:00', null, { id: 'h', calendarId: 'hidden' })
  ], parse('2026-10-15'), parse('2026-10-16'), new Set(['x']))
  assert.deepEqual(list.map(o => o.ev.id), ['a', 'b'])
})

// ─── Fuseaux horaires ───────────────────────────────────────────────────────

test(`[${TZ}] fromZoned / wallTimeIn : indépendants du fuseau de la machine`, () => {
  const t = fromZoned('2026-07-01T09:00', 'America/New_York')
  assert.equal(t.toISOString(), '2026-07-01T13:00:00.000Z')
  assert.equal(wallTimeIn(t, 'Europe/Paris'), '2026-07-01T15:00')
  assert.equal(wallTimeIn(t, 'Asia/Kolkata'), '2026-07-01T18:30')
  assert.equal(fromZoned('2026-01-15T09:00', 'Europe/Paris').toISOString(), '2026-01-15T08:00:00.000Z')
  assert.equal(fromZoned('2026-01-15T09:00', 'Africa/Douala').toISOString(), '2026-01-15T08:00:00.000Z')
})

test(`[${TZ}] fromZoned : heure inexistante et heure ambiguë (Paris)`, () => {
  // 29 mars 2026 : 02:00 → 03:00. 02:30 n'existe pas → 03:30 CEST.
  assert.equal(wallTimeIn(fromZoned('2026-03-29T02:30', 'Europe/Paris'), 'Europe/Paris'), '2026-03-29T03:30')
  // 25 octobre 2026 : 02:30 existe deux fois → première occurrence (CEST, UTC+2).
  assert.equal(fromZoned('2026-10-25T02:30', 'Europe/Paris').toISOString(), '2026-10-25T00:30:00.000Z')
})

test(`[${TZ}] décalages et validation des fuseaux`, () => {
  assert.equal(tzOffsetMinutes(new Date('2026-07-01T12:00:00Z'), 'Europe/Paris'), 120)
  assert.equal(tzOffsetMinutes(new Date('2026-01-01T12:00:00Z'), 'Europe/Paris'), 60)
  assert.equal(tzOffsetMinutes(new Date('2026-01-01T12:00:00Z'), 'America/St_Johns'), -210)
  assert.equal(fmtOffset(330), 'UTC+5:30')
  assert.equal(fmtOffset(-300), 'UTC−5')
  assert.ok(isValidTimeZone('Pacific/Auckland'))
  assert.ok(!isValidTimeZone('Mars/Olympus'))
  assert.equal(toIso(fromZoned('2026-07-01T09:00', null)), '2026-07-01T09:00')
})

test(`[${TZ}] vol long-courrier : durée réelle entre deux fuseaux`, () => {
  const dep = fromZoned('2026-11-20T10:30', 'Europe/Paris')
  const arr = fromZoned('2026-11-20T13:05', 'America/Montreal')
  assert.equal((arr - dep) / 60000, 515)
})

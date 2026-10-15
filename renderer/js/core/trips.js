// Déplacements : étapes horodatées dans le fuseau de départ et d'arrivée.
// trip = { id, title, destination: { name, lat, lon, timezone, country }|null, start, end, legs: [leg], checklist, notes }
// leg  = { id, mode, from, to, depart: 'YYYY-MM-DDTHH:mm', departTz, arrive, arriveTz, ref }

import { fromZoned, MINUTE, parse, addDays } from '../dates.js'

export const MODES = { train: 'Train', plane: 'Avion', bus: 'Bus', car: 'Voiture', boat: 'Bateau', other: 'Autre' }

export function legInstants(leg) {
  if (!leg.depart) return null
  const start = fromZoned(leg.depart, leg.departTz)
  let end = leg.arrive ? fromZoned(leg.arrive, leg.arriveTz || leg.departTz) : null
  const valid = !end || end > start
  if (!end || !valid) end = start
  return { start, end, valid, minutes: Math.round((end - start) / MINUTE) }
}

// Étapes de tous les voyages chevauchant [from, to[, en heure de l'appareil.
export function legsBetween(trips, from, to) {
  const out = []
  for (const t of trips) {
    for (const leg of t.legs || []) {
      const i = legInstants(leg)
      if (!i) continue
      if (i.start < to && (i.end > from || (i.end - i.start === 0 && i.start >= from))) out.push({ trip: t, leg, ...i })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

export function tripStatus(t, now = new Date()) {
  if (!t.start) return 'draft'
  const s = parse(t.start), e = addDays(parse(t.end || t.start), 1)
  if (now >= e) return 'past'
  if (now >= s) return 'ongoing'
  return 'upcoming'
}

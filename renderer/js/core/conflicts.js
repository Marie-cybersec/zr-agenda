// Détection des conflits d'horaires entre éléments datés (rendez-vous, déplacements, routines).

import { expandAll, DAY, addDays, parse } from '../dates.js'

const timed = o => !o.allDay && o.end > o.start && o.end - o.start < DAY

// items : [{ key, start: Date, end: Date, allDay?, title, kind }]. Retourne les paires qui se chevauchent.
export function findConflicts(items) {
  const list = items.filter(timed).slice().sort((a, b) => a.start - b.start || a.end - b.end)
  const pairs = []
  const active = []
  for (const it of list) {
    for (let i = active.length - 1; i >= 0; i--) if (active[i].end <= it.start) active.splice(i, 1)
    for (const a of active) pairs.push([a, it])
    active.push(it)
  }
  return pairs
}

// Clés en conflit, pour marquer les éléments dans l'interface.
export function conflictKeys(items) {
  const keys = new Set()
  for (const [a, b] of findConflicts(items)) { keys.add(a.key); keys.add(b.key) }
  return keys
}

// Conflits d'un brouillon d'événement (récurrent ou non) avec les autres événements visibles.
export function draftConflicts(draft, events, visibleCals, horizonDays = 180) {
  if (draft.allDay) return []
  const from = parse(draft.start)
  const mine = expandAll([{ ...draft, id: draft.id || '__draft' }], from, addDays(from, draft.recurrence ? horizonDays : 2), null)
  if (!mine.length) return []
  const last = mine[mine.length - 1].end
  const others = expandAll(events.filter(e => e.id !== draft.id), mine[0].start, last, visibleCals)
  const out = []
  for (const m of mine) {
    if (!timed({ ...m, allDay: false })) continue
    for (const o of others) {
      if (o.ev.allDay || o.end - o.start >= DAY) continue
      if (o.start < m.end && o.end > m.start) out.push({ mine: m, other: o })
    }
  }
  return out
}

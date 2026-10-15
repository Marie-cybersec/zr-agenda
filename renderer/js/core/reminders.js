// Rappels autonomes : { id, title, at: 'YYYY-MM-DDTHH:mm', repeat: null|'daily'|'weekdays'|'weekly'|'monthly', alarm, done, skips: [ymd] }

import { occurrences } from '../dates.js'

export const REPEATS = { daily: 'Tous les jours', weekdays: 'En semaine', weekly: 'Toutes les semaines', monthly: 'Tous les mois' }

function recurrenceOf(r) {
  if (r.repeat === 'daily') return { freq: 'daily', interval: 1 }
  if (r.repeat === 'weekdays') return { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5] }
  if (r.repeat === 'weekly') return { freq: 'weekly', interval: 1 }
  if (r.repeat === 'monthly') return { freq: 'monthly', interval: 1 }
  return null
}

// Occurrences d'un rappel dans [from, to[ ; un rappel unique terminé n'en a plus.
export function reminderTimes(r, from, to) {
  if (!r.at || (r.done && !r.repeat)) return []
  const pseudo = { id: r.id, start: r.at, end: r.at, recurrence: recurrenceOf(r), exdates: r.skips || [] }
  return occurrences(pseudo, from, to).map(o => o.start)
}

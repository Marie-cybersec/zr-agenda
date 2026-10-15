// Exports lisibles : CSV (séparateur « ; » pour Excel en français) et Markdown.

import { addDays, startOfDay, ymd } from '../dates.js'
import { history } from './habits.js'

const BOM = '﻿'
const cell = v => {
  const s = v == null ? '' : String(v)
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
export const toCsv = rows => BOM + rows.map(r => r.map(cell).join(';')).join('\r\n') + '\r\n'

const STATUS = { todo: 'À faire', doing: 'En cours', waiting: 'En attente', done: 'Terminée' }
const PRIO = ['Aucune', 'Basse', 'Moyenne', 'Haute']

export function tasksCsv(d) {
  const cat = id => (d.categories.find(c => c.id === id) || {}).name || ''
  return toCsv([
    ['Titre', 'Statut', 'Priorité', 'Catégorie', 'Échéance', 'Heure', 'Estimation (min)', 'Créée le', 'Terminée le', 'Notes'],
    ...d.tasks.map(t => [t.title, STATUS[t.status] || (t.done ? 'Terminée' : 'À faire'), PRIO[t.priority] || '', cat(t.categoryId), t.due || '', t.dueTime || '',
      t.estimate || '', (t.createdAt || '').slice(0, 10), (t.doneAt || '').slice(0, 10), t.notes || ''])
  ])
}

export function habitsCsv(d, days = 90, now = new Date()) {
  const to = startOfDay(now), from = addDays(to, -(days - 1))
  const habits = d.habits.filter(h => !h.archived)
  const hist = habits.map(h => history(d.habitLogs, h, from, to))
  const rows = [['Date', ...habits.map(h => h.name)]]
  for (let i = 0; i < days; i++) rows.push([ymd(addDays(from, i)), ...hist.map(hs => hs[i].scheduled ? hs[i].count : '')])
  return toCsv(rows)
}

const MOODS = ['', 'Difficile', 'Bof', 'Correct', 'Bien', 'Excellent']

export function journalMarkdown(d) {
  const out = ['# Journal — ZR Agenda', '']
  const list = d.journal.slice().sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || ''))
  for (const e of list) {
    out.push('## ' + e.date + (e.title ? ' — ' + e.title : ''))
    const meta = [e.mood ? 'Humeur : ' + MOODS[e.mood] : '', (e.tags || []).length ? 'Étiquettes : ' + e.tags.join(', ') : ''].filter(Boolean)
    if (meta.length) out.push('*' + meta.join(' · ') + '*')
    out.push('', e.content || '', '')
  }
  return out.join('\n')
}

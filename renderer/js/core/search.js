// Recherche plein texte insensible aux accents et à la casse, multi-termes.

export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export const terms = q => norm(q).split(/\s+/).filter(Boolean)

export function matches(fields, ts) {
  if (!ts.length) return true
  const hay = norm(fields.filter(Boolean).join(' \n '))
  return ts.every(t => hay.includes(t))
}

// Extrait centré sur la première occurrence d'un terme.
export function snippet(text, ts, radius = 50) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  if (!ts.length) return s.slice(0, radius * 2)
  const n = norm(s)
  let i = -1
  for (const t of ts) { const k = n.indexOf(t); if (k >= 0 && (i < 0 || k < i)) i = k }
  if (i < 0) return s.slice(0, radius * 2)
  const a = Math.max(0, i - radius), b = Math.min(s.length, i + radius)
  return (a > 0 ? '…' : '') + s.slice(a, b) + (b < s.length ? '…' : '')
}

export function searchJournal(entries, q) {
  const ts = terms(q)
  return entries.filter(e => matches([e.title, e.content, (e.tags || []).join(' ')], ts))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt || '').localeCompare(a.updatedAt || ''))
}

export function searchTasks(tasks, q) {
  const ts = terms(q)
  return tasks.filter(t => matches([t.title, t.notes, ...(t.subtasks || []).map(s => s.title)], ts))
}

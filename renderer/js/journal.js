// Journal personnel : une ou plusieurs entrées par jour, humeur, étiquettes, recherche.

import { html, useState, useMemo } from './lib.js'
import { ymd, parse, fmtDayLong, cap, MONTHS } from './dates.js'
import { Icon } from './icons.js'
import { IconButton, AutoTextarea, Empty, cx } from './ui.js'
import { useDb, useUi, db, setUi, addItem, updateItem, removeItem, withUndo } from './store.js'
import { searchJournal, snippet, terms } from './core/search.js'

export const MOODS = [
  { value: 1, label: 'Difficile', color: '#E5484D' },
  { value: 2, label: 'Bof', color: '#E8590C' },
  { value: 3, label: 'Correct', color: '#D97706' },
  { value: 4, label: 'Bien', color: '#0E9F6E' },
  { value: 5, label: 'Excellent', color: '#2F80ED' }
]

export function writeToday() {
  const key = ymd(new Date())
  const existing = db().journal.find(e => e.date === key)
  const e = existing || addItem('journal', { date: key, title: '', content: '', mood: null, tags: [] }, true)
  setUi({ section: 'journal', selectedEntry: e.id })
}

export function JournalSection() {
  const d = useDb()
  const u = useUi()
  const [q, setQ] = useState('')
  const [mood, setMood] = useState(0)
  const list = useMemo(() => searchJournal(d.journal, q).filter(e => !mood || e.mood === mood), [d.journal, q, mood])
  const ts = terms(q)
  const sel = d.journal.find(e => e.id === u.selectedEntry)

  const groups = []
  for (const e of list) {
    const k = e.date.slice(0, 7)
    let g = groups.find(x => x.k === k)
    if (!g) { const p = parse(e.date); g = { k, label: cap(MONTHS[p.getMonth()]) + ' ' + p.getFullYear(), items: [] }; groups.push(g) }
    g.items.push(e)
  }
  const todayKey = ymd(new Date())
  const hasToday = d.journal.some(e => e.date === todayKey)

  return html`<section class="section journal-section">
    <header class="toolbar">
      <div class="toolbar-left"><h1 class="toolbar-title">Journal</h1><span class="chip">${d.journal.length} entrée${d.journal.length > 1 ? 's' : ''}</span></div>
      <div class="toolbar-right">
        <div class="search-field"><${Icon} name="search" size=${14} /><input placeholder="Rechercher dans le journal" value=${q} onInput=${e => setQ(e.target.value)} /></div>
        <select class="input select sm-select" value=${mood} onChange=${e => setMood(Number(e.target.value))} aria-label="Humeur">
          <option value="0">Toutes humeurs</option>${MOODS.map(m => html`<option value=${m.value}>${m.label}</option>`)}
        </select>
        <button class="btn btn-primary sm" onClick=${writeToday}><${Icon} name="edit" size=${14} />${hasToday ? "Entrée du jour" : "Écrire aujourd'hui"}</button>
      </div>
    </header>
    <div class="split">
      <div class="split-main journal-list">
        ${list.length === 0 && html`<${Empty} icon="book" title=${q || mood ? 'Aucun résultat' : 'Journal vide'}
          text=${q || mood ? 'Essayez un autre terme ou retirez le filtre.' : 'Notez ce qui s\'est passé, ce que vous avez appris, comment vous vous sentez.'} />`}
        ${groups.map(g => html`<div class="j-group" key=${g.k}>
          <div class="group-label">${g.label}<span class="count">${g.items.length}</span></div>
          ${g.items.map(e => {
            const m = MOODS.find(x => x.value === e.mood)
            return html`<button class=${cx('j-item', u.selectedEntry === e.id && 'selected')} key=${e.id} onClick=${() => setUi({ selectedEntry: e.id })}>
              <span class="j-date"><b>${parse(e.date).getDate()}</b><small>${cap(fmtDayLong(parse(e.date)).split(' ')[0]).slice(0, 3)}.</small></span>
              <span class="j-body">
                <span class="j-title">${e.title || (e.content ? e.content.split('\n')[0].slice(0, 60) : 'Sans titre')}</span>
                <span class="j-snip">${snippet(e.content, ts, 70) || 'Entrée vide'}</span>
                ${(e.tags || []).length > 0 && html`<span class="j-tags">${e.tags.map(t => html`<span class="tag">#${t}</span>`)}</span>`}
              </span>
              ${m && html`<span class="mood-dot" style=${{ '--c': m.color }} title=${m.label}></span>`}
            </button>`
          })}
        </div>`)}
      </div>
      ${sel ? html`<${EntryEditor} key=${sel.id} e=${sel} />` : html`<aside class="split-side placeholder"><${Empty} icon="book" title="Aucune entrée ouverte" text="Choisissez une entrée ou écrivez celle du jour." /></aside>`}
    </div>
  </section>`
}

function EntryEditor({ e }) {
  const set = patch => updateItem('journal', e.id, patch)
  const [tags, setTags] = useState((e.tags || []).join(', '))
  const words = (e.content || '').trim().split(/\s+/).filter(Boolean).length
  return html`<aside class="split-side journal-editor">
    <div class="td-head">
      <input type="date" class="input" value=${e.date} onChange=${ev => ev.target.value && set({ date: ev.target.value })} />
      <span class="grow"></span>
      <${IconButton} icon="trash" label="Supprimer l'entrée" onClick=${() => { setUi({ selectedEntry: null }); withUndo('Entrée supprimée', () => removeItem('journal', e.id)) }} />
      <${IconButton} icon="x" label="Fermer" onClick=${() => setUi({ selectedEntry: null })} />
    </div>
    <div class="j-day">${cap(fmtDayLong(parse(e.date)))}</div>
    <input class="td-title" placeholder="Titre (facultatif)" value=${e.title || ''} onInput=${ev => set({ title: ev.target.value })} />
    <div class="mood-picker" role="radiogroup" aria-label="Humeur">
      ${MOODS.map(m => html`<button role="radio" aria-checked=${e.mood === m.value} class=${cx('mood-opt', e.mood === m.value && 'on')} style=${{ '--c': m.color }}
        onClick=${() => set({ mood: e.mood === m.value ? null : m.value })}><span class="mood-dot"></span>${m.label}</button>`)}
    </div>
    <${AutoTextarea} class="input textarea journal-text" minRows=${14} placeholder="Qu'avez-vous fait, appris, ressenti aujourd'hui ?" value=${e.content || ''} onInput=${v => set({ content: v })} />
    <div class="inline">
      <${Icon} name="hash" size=${14} />
      <input class="input grow" placeholder="Étiquettes séparées par des virgules" value=${tags}
        onInput=${ev => setTags(ev.target.value)} onBlur=${() => set({ tags: [...new Set(tags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean))] })} />
    </div>
    <div class="td-created">${words} mot${words > 1 ? 's' : ''} · enregistré automatiquement, chiffré sur ce poste</div>
  </aside>`
}

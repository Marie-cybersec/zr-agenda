// Tableau de bord des objectifs : jour, semaine, mois et échéances (examens, certifications, projets).

import { html, useState, useMemo } from './lib.js'
import { ymd, parse, addDays, startOfDay, startOfWeek, fmtDayShort, cap } from './dates.js'
import { Icon } from './icons.js'
import { Modal, IconButton, Empty, cx } from './ui.js'
import { useDb, setUi, addItem, updateItem, removeItem, withUndo } from './store.js'
import { PERIODS, METRICS, progress, activeGoals } from './core/goals.js'
import { completionRate } from './core/habits.js'
import { CategorySelect, CatTag, Bar, Field, Stepper } from './widgets.js'

const PACE = { ahead: ['Dans les temps', 'ok'], behind: ['En retard sur le rythme', 'warn'], missed: ['Échéance dépassée', 'bad'], done: ['Atteint', 'ok'] }

export function GoalsSection() {
  const d = useDb()
  const [edit, setEdit] = useState(null)
  const now = new Date()
  const items = useMemo(() => activeGoals(d).map(g => ({ g, p: progress(g, d, now) })), [d])
  const archived = d.goals.filter(g => g.archived)

  const kpi = useMemo(() => {
    const ws = startOfWeek(now, d.settings.weekStart)
    const focusWeek = d.focusLog.filter(f => new Date(f.at) >= ws).reduce((s, f) => s + f.minutes, 0)
    const tasksWeek = d.tasks.filter(t => t.done && t.doneAt && new Date(t.doneAt) >= ws).length
    const rates = d.habits.filter(h => !h.archived).map(h => completionRate(d.habitLogs, h, addDays(startOfDay(now), -6), now, d.settings.weekStart)).filter(x => x != null)
    const habitRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null
    return { focusWeek, tasksWeek, habitRate }
  }, [d])
  const count = k => { const l = items.filter(x => x.g.period === k); return [l.filter(x => x.p.done).length, l.length] }

  return html`<section class="section goals-section">
    <header class="toolbar">
      <div class="toolbar-left"><h1 class="toolbar-title">Objectifs</h1></div>
      <div class="toolbar-right"><button class="btn btn-primary sm" onClick=${() => setEdit({})}><${Icon} name="plus" size=${14} />Nouvel objectif</button></div>
    </header>
    <div class="insights-scroll">
      <div class="kpis">
        <div class="kpi"><span class="kpi-label">Objectifs du jour</span><span class="kpi-value">${count('day')[0]}/${count('day')[1]}</span><span class="kpi-foot">atteints aujourd'hui</span></div>
        <div class="kpi"><span class="kpi-label">Objectifs de la semaine</span><span class="kpi-value">${count('week')[0]}/${count('week')[1]}</span><span class="kpi-foot">${kpi.tasksWeek} tâche${kpi.tasksWeek > 1 ? 's' : ''} terminée${kpi.tasksWeek > 1 ? 's' : ''} cette semaine</span></div>
        <div class="kpi"><span class="kpi-label">Habitudes · 7 derniers jours</span><span class="kpi-value">${kpi.habitRate == null ? '—' : Math.round(kpi.habitRate * 100) + ' %'}</span><span class="kpi-foot">taux de réussite moyen</span></div>
        <div class="kpi"><span class="kpi-label">Concentration cette semaine</span><span class="kpi-value">${kpi.focusWeek >= 60 ? (Math.round(kpi.focusWeek / 6) / 10).toLocaleString('fr-FR') + ' h' : kpi.focusWeek + ' min'}</span><span class="kpi-foot">sessions terminées</span></div>
      </div>
      ${items.length === 0 && html`<${Empty} icon="target" title="Aucun objectif"
        text="Fixez des objectifs mesurables : 3 tâches de révision par jour, 5 h de concentration par semaine, une certification à une date donnée…"
        action=${html`<button class="btn btn-secondary" onClick=${() => setEdit({})}>Créer un objectif</button>`} />`}
      ${Object.entries(PERIODS).map(([k, label]) => {
        const list = items.filter(x => x.g.period === k).sort((a, b) => a.p.done - b.p.done || (a.g.dueDate || '').localeCompare(b.g.dueDate || ''))
        if (!list.length) return null
        return html`<div class="goal-group" key=${k}>
          <div class="group-label">${label}<span class="count">${list.filter(x => x.p.done).length}/${list.length}</span></div>
          <div class="goal-grid">${list.map(x => html`<${GoalCard} key=${x.g.id} g=${x.g} p=${x.p} onEdit=${() => setEdit(x.g)} />`)}</div>
        </div>`
      })}
      ${archived.length > 0 && html`<details class="archived"><summary>${archived.length} objectif${archived.length > 1 ? 's' : ''} archivé${archived.length > 1 ? 's' : ''}</summary>
        ${archived.map(g => html`<div class="archived-row"><span>${g.title}</span><button class="btn btn-ghost sm" onClick=${() => updateItem('goals', g.id, { archived: false })}>Restaurer</button></div>`)}
      </details>`}
    </div>
    ${edit && html`<${GoalForm} initial=${edit} onClose=${() => setEdit(null)} />`}
  </section>`
}

function GoalCard({ g, p, onEdit }) {
  const d = useDb()
  const today = ymd(new Date())
  const unit = g.unit || METRICS[g.metric].unit
  const pace = p.pace && PACE[p.pace]
  const logToday = (g.log || {})[today] || 0
  const habit = g.metric === 'habit' && d.habits.find(h => h.id === g.habitId)
  return html`<div class=${cx('card goal-card', p.done && 'done')}>
    <div class="card-head">
      <div class="gc-title"><h2>${g.title || 'Sans titre'}</h2>
        <div class="card-sub">${METRICS[g.metric].label}${habit ? ' · ' + habit.name : ''}${g.period === 'deadline' && g.dueDate ? ' · avant le ' + fmtDayShort(parse(g.dueDate)) : ''}</div></div>
      <${IconButton} icon="edit" label="Modifier" onClick=${onEdit} />
    </div>
    <div class="gc-value"><b>${Math.round(p.value * 10) / 10}</b> / ${p.target} ${unit}<span class="gc-pct">${Math.round(p.ratio * 100)} %</span></div>
    <${Bar} ratio=${p.ratio} tone=${p.done ? 'ok' : p.pace === 'behind' || p.pace === 'missed' ? 'warn' : null} label=${g.title} />
    <div class="gc-foot">
      <${CatTag} id=${g.categoryId} />
      ${pace && html`<span class=${'pace pace-' + pace[1]}>${pace[0]}${p.daysLeft != null && p.daysLeft >= 0 && !p.done ? ' · J−' + p.daysLeft : ''}</span>`}
      ${p.done && !pace && html`<span class="pace pace-ok"><${Icon} name="check" size=${12} />Atteint</span>`}
    </div>
    ${g.metric === 'manual' && html`<div class="gc-log">
      <span>Aujourd'hui</span>
      <${Stepper} value=${logToday} min=${0} max=${100000} onChange=${v => updateItem('goals', g.id, x => { const log = { ...(x.log || {}) }; if (v > 0) log[today] = v; else delete log[today]; return { log } })} />
      <span class="muted">${unit}</span>
    </div>`}
  </div>`
}

function GoalForm({ initial, onClose }) {
  const d = useDb()
  const [g, setG] = useState(() => ({ title: '', period: 'week', metric: 'tasks', target: 5, unit: '', categoryId: null, habitId: null, startDate: ymd(new Date()), dueDate: null, log: {}, archived: false, ...initial }))
  const set = patch => setG(x => ({ ...x, ...patch }))
  const isNew = !initial.id
  const save = () => {
    const data = { ...g, title: g.title.trim() || 'Objectif', target: Math.max(1, Number(g.target) || 1) }
    if (isNew) addItem('goals', data); else updateItem('goals', initial.id, data)
    onClose()
  }
  return html`<${Modal} onClose=${onClose} width=${520}>
    <div class="modal-head"><h2>${isNew ? 'Nouvel objectif' : "Modifier l'objectif"}</h2><${IconButton} icon="x" label="Fermer" onClick=${onClose} /></div>
    <div class="modal-scroll form-grid">
      <${Field} label="Intitulé"><input class="input" autoFocus value=${g.title} placeholder="Ex. Réviser la certification AZ-900" onInput=${e => set({ title: e.target.value })} /><//>
      <${Field} label="Période">
        <select class="input select" value=${g.period} onChange=${e => set({ period: e.target.value })}>
          <option value="day">Chaque jour</option><option value="week">Chaque semaine</option><option value="month">Chaque mois</option><option value="deadline">Avant une date</option>
        </select>
      <//>
      ${g.period === 'deadline' && html`<div class="inline">
        <${Field} label="Début"><input type="date" class="input" value=${g.startDate || ''} onChange=${e => set({ startDate: e.target.value || null })} /><//>
        <${Field} label="Échéance"><input type="date" class="input" value=${g.dueDate || ''} onChange=${e => set({ dueDate: e.target.value || null })} /><//>
      </div>`}
      <${Field} label="Mesure">
        <select class="input select" value=${g.metric} onChange=${e => set({ metric: e.target.value })}>
          ${Object.entries(METRICS).map(([k, m]) => html`<option value=${k}>${m.label}</option>`)}
        </select>
      <//>
      ${g.metric === 'habit' && html`<${Field} label="Habitude">
        <select class="input select" value=${g.habitId || ''} onChange=${e => set({ habitId: e.target.value || null })}>
          <option value="">Choisir…</option>${d.habits.filter(h => !h.archived).map(h => html`<option value=${h.id}>${h.name}</option>`)}
        </select><//>`}
      ${(g.metric === 'tasks' || g.metric === 'focus' || g.metric === 'manual') && html`<${Field} label=${g.metric === 'manual' ? 'Catégorie' : 'Compter uniquement la catégorie'}>
        <${CategorySelect} value=${g.categoryId} onChange=${v => set({ categoryId: v })} none=${g.metric === 'manual' ? 'Sans catégorie' : 'Toutes'} /><//>`}
      <div class="inline">
        <${Field} label="Cible"><input class="input num" type="number" min="1" value=${g.target} onInput=${e => set({ target: e.target.value })} /><//>
        ${g.metric === 'manual' ? html`<${Field} label="Unité"><input class="input" placeholder="h, pages, km…" value=${g.unit} onInput=${e => set({ unit: e.target.value })} /><//>`
          : html`<span class="muted unit-hint">${METRICS[g.metric].unit}</span>`}
      </div>
    </div>
    <div class="dialog-actions">
      ${!isNew && html`<button class="btn btn-ghost danger" onClick=${() => { onClose(); withUndo('Objectif supprimé', () => removeItem('goals', initial.id)) }}>Supprimer</button>`}
      ${!isNew && html`<button class="btn btn-secondary" onClick=${() => { updateItem('goals', initial.id, { archived: true }); onClose() }}>Archiver</button>`}
      <span class="grow"></span>
      <button class="btn btn-secondary" onClick=${onClose}>Annuler</button>
      <button class="btn btn-primary" disabled=${g.metric === 'habit' && !g.habitId || g.period === 'deadline' && !g.dueDate} onClick=${save}>Enregistrer</button>
    </div>
  <//>`
}

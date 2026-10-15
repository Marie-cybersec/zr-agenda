import { html, useState, useMemo, useRef, useEffect } from './lib.js'
import { parse, ymd, addDays, startOfDay, diffDays, fmtRelativeDay, fmtDayShort, cap, fmtDayLong, toIso } from './dates.js'
import { Icon } from './icons.js'
import { Checkbox, Segmented, IconButton, AutoTextarea, Empty, Floating, Menu, cx } from './ui.js'
import { useDb, useUi, db, setUi, addTask, updateTask, removeTask, toggleTask, withUndo, toast, openEditor, uid } from './store.js'
import { parseQuick } from './nlp.js'

export const PRIORITIES = [
  { value: 0, label: 'Aucune', color: 'var(--text-4)' },
  { value: 1, label: 'Basse', color: '#2F80ED' },
  { value: 2, label: 'Moyenne', color: '#D97706' },
  { value: 3, label: 'Haute', color: '#E5484D' }
]
const REPEATS = [
  { value: null, label: 'Ne se répète pas' },
  { value: 'daily', label: 'Tous les jours' },
  { value: 'weekdays', label: 'Jours de semaine' },
  { value: 'weekly', label: 'Toutes les semaines' },
  { value: 'monthly', label: 'Tous les mois' }
]

export function dueInfo(t, now = new Date()) {
  if (!t.due) return null
  const d = parse(t.due)
  const n = diffDays(now, d)
  return { label: fmtRelativeDay(d, now) + (t.dueTime ? ', ' + t.dueTime : ''), overdue: !t.done && n < 0, today: n === 0 }
}

function bucket(t, now) {
  if (!t.due) return 'nodate'
  const n = diffDays(now, parse(t.due))
  if (n < 0) return 'overdue'
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n < 7) return 'week'
  return 'later'
}
const BUCKETS = [
  ['overdue', 'En retard'], ['today', "Aujourd'hui"], ['tomorrow', 'Demain'],
  ['week', 'Cette semaine'], ['later', 'Plus tard'], ['nodate', 'Sans échéance']
]

function sortTasks(a, b) {
  return (a.due || '9999').localeCompare(b.due || '9999') || (a.dueTime || '99').localeCompare(b.dueTime || '99') || b.priority - a.priority || a.createdAt.localeCompare(b.createdAt)
}

export function TaskQuickAdd({ placeholder = 'Ajouter une tâche — « Relancer le client vendredi !1 »', defaultDue = null, autoFocus }) {
  const [text, setText] = useState('')
  const p = useMemo(() => text.trim() ? parseQuick(text) : null, [text])
  const submit = () => {
    if (!p || !p.title) return
    const due = p.date ? ymd(p.date) : defaultDue
    const repeat = p.recurrence ? (p.recurrence.freq === 'weekly' && p.recurrence.byDay?.length === 5 ? 'weekdays' : p.recurrence.freq === 'yearly' ? 'monthly' : p.recurrence.freq) : null
    addTask({
      title: p.title, priority: p.priority, due,
      dueTime: p.time ? String(p.time.h).padStart(2, '0') + ':' + String(p.time.m).padStart(2, '0') : null,
      repeat
    })
    setText('')
  }
  const due = p && (p.date ? ymd(p.date) : defaultDue)
  return html`
    <div class="task-add">
      <${Icon} name="plus" size=${16} />
      <input value=${text} placeholder=${placeholder} autoFocus=${autoFocus}
        onInput=${e => setText(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setText('') }} />
      ${p && (due || p.priority > 0) && html`<div class="task-add-tags">
        ${due && html`<span class="tag"><${Icon} name="calendar" size=${12} />${fmtRelativeDay(parse(due))}${p.time ? ', ' + p.time.h + 'h' + (p.time.m ? String(p.time.m).padStart(2, '0') : '') : ''}</span>`}
        ${p.priority > 0 && html`<span class="tag" style=${{ color: PRIORITIES[p.priority].color }}><${Icon} name="flag" size=${12} />${PRIORITIES[p.priority].label}</span>`}
      </div>`}
    </div>`
}

export function TaskRow({ t, compact, onOpen, selected }) {
  const info = dueInfo(t)
  const doneSubs = t.subtasks.filter(s => s.done).length
  return html`
    <div class=${cx('task-row', t.done && 'done', selected && 'selected', compact && 'compact')}
      onClick=${() => onOpen ? onOpen(t) : setUi({ section: 'tasks', selectedTask: t.id })}
      onContextMenu=${e => { e.preventDefault(); setUi({ popover: { kind: 'task-menu', rect: { x: e.clientX, y: e.clientY }, payload: t } }) }}>
      <${Checkbox} checked=${t.done} round color=${t.priority ? PRIORITIES[t.priority].color : undefined} size=${18}
        onChange=${() => { toggleTask(t.id); if (!t.done && t.repeat) toast('Prochaine occurrence créée') }} label="Terminer la tâche" />
      <div class="task-main">
        <div class="task-title">${t.title || 'Sans titre'}</div>
        ${!compact && (info || t.subtasks.length > 0 || t.notes || t.repeat) && html`<div class="task-meta">
          ${info && html`<span class=${cx('due', info.overdue && 'overdue', info.today && 'today')}><${Icon} name="calendar" size=${12} />${info.label}</span>`}
          ${t.repeat && html`<span><${Icon} name="repeat" size=${12} /></span>`}
          ${t.subtasks.length > 0 && html`<span><${Icon} name="listCheck" size=${12} />${doneSubs}/${t.subtasks.length}</span>`}
          ${t.notes && html`<span><${Icon} name="text" size=${12} /></span>`}
        </div>`}
        ${compact && info && html`<span class=${cx('due-inline', info.overdue && 'overdue')}>${info.label}</span>`}
      </div>
      ${t.priority > 0 && html`<span class="prio" title=${'Priorité ' + PRIORITIES[t.priority].label.toLowerCase()} style=${{ color: PRIORITIES[t.priority].color }}><${Icon} name="flag" size=${14} /></span>`}
    </div>`
}

export function TasksSection() {
  const d = useDb()
  const u = useUi()
  const [filter, setFilter] = useState('open')
  const [query, setQuery] = useState('')
  const now = new Date()
  const q = query.trim().toLowerCase()
  const list = d.tasks.filter(t => (filter === 'all' || (filter === 'open' ? !t.done : t.done)) &&
    (!q || t.title.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q)))
  const selected = d.tasks.find(t => t.id === u.selectedTask)
  const open = d.tasks.filter(t => !t.done)
  const overdue = open.filter(t => t.due && diffDays(now, parse(t.due)) < 0).length
  const todayCount = open.filter(t => t.due && diffDays(now, parse(t.due)) === 0).length

  let groups
  if (filter === 'done') {
    groups = [['done', 'Terminées', list.slice().sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''))]]
  } else {
    groups = BUCKETS.map(([k, label]) => [k, label, list.filter(t => !t.done && bucket(t, now) === k).sort(sortTasks)])
    if (filter === 'all') groups.push(['done', 'Terminées', list.filter(t => t.done)])
  }
  groups = groups.filter(g => g[2].length)

  return html`
    <section class="section tasks-section">
      <header class="toolbar">
        <div class="toolbar-left">
          <h1 class="toolbar-title">Tâches</h1>
          <span class="chip">${open.length} à faire</span>
          ${overdue > 0 && html`<span class="chip danger">${overdue} en retard</span>`}
          ${todayCount > 0 && html`<span class="chip accent">${todayCount} aujourd'hui</span>`}
        </div>
        <div class="toolbar-right">
          <div class="search-field"><${Icon} name="search" size=${14} /><input placeholder="Filtrer" value=${query} onInput=${e => setQuery(e.target.value)} /></div>
          <${Segmented} value=${filter} onChange=${setFilter} options=${[{ value: 'open', label: 'À faire' }, { value: 'done', label: 'Terminées' }, { value: 'all', label: 'Toutes' }]} />
        </div>
      </header>
      <div class="tasks-layout">
        <div class="tasks-list">
          ${filter !== 'done' && html`<${TaskQuickAdd} />`}
          ${groups.length === 0 && html`<${Empty} icon="checkCircle"
            title=${filter === 'done' ? 'Aucune tâche terminée' : q ? 'Aucun résultat' : 'Tout est fait'}
            text=${filter === 'done' ? 'Les tâches cochées apparaîtront ici.' : q ? 'Essayez un autre terme.' : 'Profitez-en, ou ajoutez la prochaine priorité ci-dessus.'} />`}
          ${groups.map(([k, label, items]) => html`
            <div class="task-group" key=${k}>
              <div class=${cx('group-label', k === 'overdue' && 'danger')}>${label}<span class="count">${items.length}</span></div>
              ${items.map(t => html`<${TaskRow} key=${t.id} t=${t} selected=${t.id === u.selectedTask} />`)}
            </div>`)}
        </div>
        ${selected ? html`<${TaskDetail} key=${selected.id} t=${selected} />` : html`<div class="task-detail placeholder">
          <${Empty} icon="tasks" title="Aucune tâche sélectionnée" text="Sélectionnez une tâche pour ajouter des notes, des sous-tâches ou la planifier dans votre agenda." />
        </div>`}
      </div>
    </section>`
}

function TaskDetail({ t }) {
  const [sub, setSub] = useState('')
  const d = db()
  const scheduleIt = () => {
    const start = t.due ? parse(t.due + 'T' + (t.dueTime || String(Math.max(9, d.settings.workStart)).padStart(2, '0') + ':00')) : (() => { const x = new Date(); x.setMinutes(0, 0, 0); x.setHours(x.getHours() + 1); return x })()
    openEditor({
      title: t.title, calendarId: d.settings.defaultCalendarId || d.calendars[0]?.id, allDay: false,
      start: toIso(start), end: toIso(new Date(start.getTime() + d.settings.defaultDuration * 60000)),
      location: '', description: t.notes || '', recurrence: null, exdates: [], reminders: [d.settings.defaultReminder].filter(x => x >= 0)
    })
  }
  const del = () => {
    setUi({ selectedTask: null })
    withUndo('Tâche supprimée', () => removeTask(t.id))
  }
  return html`
    <aside class="task-detail">
      <div class="td-head">
        <${Checkbox} checked=${t.done} round size=${20} color=${t.priority ? PRIORITIES[t.priority].color : undefined}
          onChange=${() => toggleTask(t.id)} label="Terminer" />
        <input class="td-title" value=${t.title} placeholder="Titre de la tâche" onInput=${e => updateTask(t.id, { title: e.target.value })} />
        <${IconButton} icon="x" label="Fermer" onClick=${() => setUi({ selectedTask: null })} />
      </div>

      <div class="td-props">
        <div class="td-prop">
          <span class="td-label"><${Icon} name="calendar" size=${14} />Échéance</span>
          <div class="td-value">
            <input type="date" class="input" value=${t.due || ''} onChange=${e => updateTask(t.id, { due: e.target.value || null })} />
            <input type="time" class="input" value=${t.dueTime || ''} disabled=${!t.due} onChange=${e => updateTask(t.id, { dueTime: e.target.value || null })} />
          </div>
        </div>
        <div class="td-quick-dates">
          ${[["Aujourd'hui", 0], ['Demain', 1], ['Dans 1 semaine', 7]].map(([l, n]) => html`
            <button class="chip-btn" onClick=${() => updateTask(t.id, { due: ymd(addDays(startOfDay(new Date()), n)) })}>${l}</button>`)}
          ${t.due && html`<button class="chip-btn" onClick=${() => updateTask(t.id, { due: null, dueTime: null })}>Retirer</button>`}
        </div>
        <div class="td-prop">
          <span class="td-label"><${Icon} name="flag" size=${14} />Priorité</span>
          <div class="prio-picker">
            ${PRIORITIES.map(p => html`<button class=${cx('prio-opt', t.priority === p.value && 'active')} style=${{ '--c': p.color }}
              onClick=${() => updateTask(t.id, { priority: p.value })}>${p.value > 0 && html`<${Icon} name="flag" size=${12} />`}${p.label}</button>`)}
          </div>
        </div>
        <div class="td-prop">
          <span class="td-label"><${Icon} name="repeat" size=${14} />Répétition</span>
          <select class="input select" value=${t.repeat || ''} onChange=${e => updateTask(t.id, { repeat: e.target.value || null })}>
            ${REPEATS.map(r => html`<option value=${r.value || ''}>${r.label}</option>`)}
          </select>
        </div>
      </div>

      <div class="td-section">
        <div class="td-section-title">Sous-tâches ${t.subtasks.length > 0 && html`<span class="count">${t.subtasks.filter(s => s.done).length}/${t.subtasks.length}</span>`}</div>
        ${t.subtasks.length > 0 && html`<div class="progress"><span style=${{ width: (t.subtasks.filter(s => s.done).length / t.subtasks.length * 100) + '%' }}></span></div>`}
        ${t.subtasks.map(s => html`
          <div class=${cx('subtask', s.done && 'done')} key=${s.id}>
            <${Checkbox} checked=${s.done} size=${15} onChange=${v => updateTask(t.id, { subtasks: t.subtasks.map(x => x.id === s.id ? { ...x, done: v } : x) })} label="Terminer" />
            <input value=${s.title} onInput=${e => updateTask(t.id, { subtasks: t.subtasks.map(x => x.id === s.id ? { ...x, title: e.target.value } : x) })} />
            <button class="icon-btn sm" aria-label="Supprimer" onClick=${() => updateTask(t.id, { subtasks: t.subtasks.filter(x => x.id !== s.id) })}><${Icon} name="x" size=${13} /></button>
          </div>`)}
        <div class="subtask add">
          <${Icon} name="plus" size=${14} />
          <input placeholder="Ajouter une sous-tâche" value=${sub} onInput=${e => setSub(e.target.value)}
            onKeyDown=${e => { if (e.key === 'Enter' && sub.trim()) { updateTask(t.id, { subtasks: [...t.subtasks, { id: uid(), title: sub.trim(), done: false }] }); setSub('') } }} />
        </div>
      </div>

      <div class="td-section grow">
        <div class="td-section-title">Notes</div>
        <${AutoTextarea} class="input textarea" placeholder="Contexte, liens, détails…" minRows=${4} value=${t.notes || ''} onInput=${v => updateTask(t.id, { notes: v })} />
      </div>

      <div class="td-foot">
        <button class="btn btn-secondary" onClick=${scheduleIt}><${Icon} name="calendarPlus" size=${15} />Bloquer du temps</button>
        <button class="btn btn-ghost danger" onClick=${del}><${Icon} name="trash" size=${15} />Supprimer</button>
      </div>
      <div class="td-created">Créée le ${fmtDayLong(new Date(t.createdAt))}${t.doneAt ? ' · terminée le ' + fmtDayLong(new Date(t.doneAt)) : ''}</div>
    </aside>`
}

export function TaskPopovers() {
  const u = useUi()
  const p = u.popover
  if (!p || p.kind !== 'task-menu') return null
  const t = p.payload
  const close = () => setUi({ popover: null })
  const today = startOfDay(new Date())
  const items = [
    { label: t.done ? 'Marquer à faire' : 'Marquer terminée', icon: 'check', onClick: () => toggleTask(t.id) },
    '-',
    { label: "Pour aujourd'hui", icon: 'today', onClick: () => updateTask(t.id, { due: ymd(today) }) },
    { label: 'Pour demain', icon: 'calendar', onClick: () => updateTask(t.id, { due: ymd(addDays(today, 1)) }) },
    { label: 'Semaine prochaine', icon: 'arrowRight', onClick: () => updateTask(t.id, { due: ymd(addDays(today, 7 - ((today.getDay() + 6) % 7))) }) },
    '-',
    ...PRIORITIES.slice(1).reverse().map(pr => ({ label: 'Priorité ' + pr.label.toLowerCase(), color: pr.color, checked: t.priority === pr.value, onClick: () => updateTask(t.id, { priority: t.priority === pr.value ? 0 : pr.value }) })),
    '-',
    { label: 'Supprimer', icon: 'trash', danger: true, onClick: () => withUndo('Tâche supprimée', () => removeTask(t.id)) }
  ]
  return html`<${Floating} anchor=${p.rect} onClose=${close} width=${220}><${Menu} items=${items} onClose=${close} /><//>`
}

// Section « Habitudes » : habitudes (séries, historique), routines et rappels autonomes.

import { html, useState, useMemo } from './lib.js'
import { ymd, parse, addDays, startOfDay, startOfWeek, sameDay, toIso, fmtDayShort, fmtRelativeDay, cap, hm, WEEKDAYS, WEEKDAYS_LETTER, weekdayOrder, MONTHS_SHORT } from './dates.js'
import { Icon } from './icons.js'
import { Segmented, Switch, IconButton, Empty, Checkbox, cx } from './ui.js'
import { useDb, useUi, setUi, addItem, updateItem, removeItem, setHabitCount, toggleRoutineStep, withUndo, uid } from './store.js'
import { streaks, history, completionRate, describeSchedule, isScheduled, countOn, target, weekProgress, routineMinutes, routineProgress, routineScheduled } from './core/habits.js'
import { REPEATS } from './core/reminders.js'
import { CategorySelect, CatTag, Field, Stepper } from './widgets.js'

export function HabitsSection() {
  const u = useUi()
  const tab = u.habitsTab || 'habits'
  return html`<section class="section habits-section">
    <header class="toolbar">
      <div class="toolbar-left"><h1 class="toolbar-title">Habitudes</h1></div>
      <div class="toolbar-right">
        <${Segmented} value=${tab} onChange=${v => setUi({ habitsTab: v })}
          options=${[{ value: 'habits', label: 'Habitudes' }, { value: 'routines', label: 'Routines' }, { value: 'reminders', label: 'Rappels et alarmes' }]} />
      </div>
    </header>
    ${tab === 'habits' && html`<${Habits} />`}
    ${tab === 'routines' && html`<${Routines} />`}
    ${tab === 'reminders' && html`<${Reminders} />`}
  </section>`
}

// ─── Habitudes ───────────────────────────────────────────────────────────────

function newHabit() {
  const h = addItem('habits', { name: 'Nouvelle habitude', categoryId: null, schedule: { type: 'daily' }, target: 1, unit: '', time: null, reminder: false, startDate: ymd(new Date()), archived: false })
  setUi({ selectedHabit: h.id })
}

function Habits() {
  const d = useDb()
  const u = useUi()
  const [showArchived, setShowArchived] = useState(false)
  const now = new Date()
  const list = d.habits.filter(h => !!h.archived === showArchived)
  const sel = d.habits.find(h => h.id === u.selectedHabit)
  const days = Array.from({ length: 7 }, (_, i) => addDays(startOfDay(now), i - 6))
  return html`<div class="split">
    <div class="split-main">
      <div class="list-head">
        <button class="btn btn-primary sm" onClick=${newHabit}><${Icon} name="plus" size=${14} />Nouvelle habitude</button>
        <span class="grow"></span>
        <button class=${cx('chip-btn', showArchived && 'active')} onClick=${() => setShowArchived(!showArchived)}><${Icon} name="archive" size=${12} /> Archivées</button>
      </div>
      ${list.length === 0 ? html`<${Empty} icon="repeat" title=${showArchived ? 'Aucune habitude archivée' : 'Aucune habitude'}
        text="Suivez ce que vous voulez faire régulièrement : lecture, sport, révisions… avec séries et historique." />` : html`
      <div class="habit-table">
        <div class="ht-head"><span></span><span></span>${days.map(x => html`<span class=${cx('ht-day', sameDay(x, now) && 'today')}>${WEEKDAYS_LETTER[x.getDay()]}<small>${x.getDate()}</small></span>`)}<span>Série</span></div>
        ${list.map(h => {
          const st = streaks(d.habitLogs, h, now, d.settings.weekStart)
          return html`<div class=${cx('ht-row', u.selectedHabit === h.id && 'selected')} key=${h.id} onClick=${() => setUi({ selectedHabit: h.id })}>
            <span class="ht-dot" style=${{ '--c': (d.categories.find(c => c.id === h.categoryId) || {}).color || 'var(--accent)' }}></span>
            <span class="ht-name"><b>${h.name}</b><small>${describeSchedule(h)}${target(h) > 1 ? ' · ' + target(h) + (h.unit ? ' ' + h.unit : '') + '/jour' : ''}${h.time ? ' · ' + h.time : ''}</small></span>
            ${days.map(x => html`<${HabitCell} h=${h} day=${x} d=${d} />`)}
            <span class=${cx('streak', st.current === 0 && 'zero')} title=${'Meilleure série : ' + st.best}><${Icon} name="flame" size=${13} />${st.current}</span>
          </div>`
        })}
      </div>`}
    </div>
    ${sel ? html`<${HabitDetail} key=${sel.id} h=${sel} />` : html`<aside class="split-side placeholder"><${Empty} icon="repeat" title="Aucune habitude sélectionnée" text="Sélectionnez une habitude pour la modifier et voir son historique." /></aside>`}
  </div>`
}

function HabitCell({ h, day, d }) {
  if (!isScheduled(h, day)) return html`<span class="ht-cell off" title="Non prévu"></span>`
  const n = countOn(d.habitLogs, h, day)
  const t = target(h)
  const done = n >= t
  const future = day > new Date()
  return html`<button class=${cx('ht-cell', done && 'done', n > 0 && !done && 'partial')} disabled=${future}
    title=${cap(fmtDayShort(day)) + ' · ' + (t > 1 ? n + '/' + t : done ? 'fait' : 'non fait')}
    onClick=${e => { e.stopPropagation(); setHabitCount(h.id, day, t > 1 ? (n >= t ? 0 : n + 1) : done ? 0 : 1) }}>
    ${t > 1 && n > 0 && !done ? n : done ? html`<${Icon} name="check" size=${12} stroke=${2.5} />` : ''}
  </button>`
}

function HabitDetail({ h }) {
  const d = useDb()
  const s = d.settings
  const now = new Date()
  const set = patch => updateItem('habits', h.id, patch)
  const sched = h.schedule || { type: 'daily' }
  const st = streaks(d.habitLogs, h, now, s.weekStart)
  const rate30 = completionRate(d.habitLogs, h, addDays(startOfDay(now), -29), now, s.weekStart)
  const total = Object.values(d.habitLogs[h.id] || {}).reduce((a, b) => a + b, 0)
  const order = weekdayOrder(s.weekStart)
  return html`<aside class="split-side">
    <div class="td-head">
      <input class="td-title" value=${h.name} placeholder="Nom de l'habitude" onInput=${e => set({ name: e.target.value })} />
      <${IconButton} icon="x" label="Fermer" onClick=${() => setUi({ selectedHabit: null })} />
    </div>
    <div class="mini-stats">
      <div><b>${st.current}</b><span>Série actuelle (${st.unit}s)</span></div>
      <div><b>${st.best}</b><span>Meilleure série</span></div>
      <div><b>${rate30 == null ? '—' : Math.round(rate30 * 100) + ' %'}</b><span>Réussite sur 30 jours</span></div>
      <div><b>${total}</b><span>Réalisations</span></div>
    </div>
    <div class="side-title-sm">Historique (16 semaines)</div>
    <${HabitHistory} h=${h} d=${d} />

    <div class="form-grid">
      <${Field} label="Catégorie"><${CategorySelect} value=${h.categoryId} onChange=${v => set({ categoryId: v })} /><//>
      <${Field} label="Fréquence">
        <select class="input select" value=${sched.type} onChange=${e => set({ schedule: e.target.value === 'days' ? { type: 'days', days: [1, 2, 3, 4, 5] } : e.target.value === 'weekly' ? { type: 'weekly', times: 3 } : { type: 'daily' } })}>
          <option value="daily">Tous les jours</option><option value="days">Certains jours</option><option value="weekly">N fois par semaine</option>
        </select>
      <//>
      ${sched.type === 'days' && html`<${Field} label="Jours"><div class="day-chips">
        ${order.map(x => html`<button class=${cx('day-chip', (sched.days || []).includes(x) && 'on')} title=${WEEKDAYS[x]}
          onClick=${() => { const ds = new Set(sched.days || []); ds.has(x) ? ds.delete(x) : ds.add(x); set({ schedule: { type: 'days', days: [...ds] } }) }}>${WEEKDAYS_LETTER[x]}</button>`)}
      </div><//>`}
      ${sched.type === 'weekly' && html`<${Field} label="Fois par semaine"><${Stepper} value=${sched.times || 1} min=${1} max=${7} onChange=${v => set({ schedule: { type: 'weekly', times: v } })} /><//>`}
      <${Field} label="Objectif par jour" hint="Ex. 8 verres d'eau, 30 pages."><div class="inline">
        <${Stepper} value=${target(h)} min=${1} max=${999} onChange=${v => set({ target: v })} />
        <input class="input unit" placeholder="unité" value=${h.unit || ''} onInput=${e => set({ unit: e.target.value })} />
      </div><//>
      <${Field} label="Heure (facultatif)"><div class="inline">
        <input type="time" class="input" value=${h.time || ''} onChange=${e => set({ time: e.target.value || null })} />
        <label class="inline-check"><${Switch} checked=${!!h.reminder} onChange=${v => set({ reminder: v })} label="Rappel" /> Rappel</label>
      </div><//>
      <${Field} label="Suivie depuis"><input type="date" class="input" value=${h.startDate || ''} onChange=${e => set({ startDate: e.target.value || ymd(now) })} /><//>
    </div>
    ${sched.type === 'weekly' && html`<div class="field-hint">Cette semaine : ${weekProgress(d.habitLogs, h, now, s.weekStart).done}/${sched.times || 1}</div>`}
    <div class="td-foot">
      <button class="btn btn-secondary" onClick=${() => set({ archived: !h.archived })}><${Icon} name="archive" size=${15} />${h.archived ? 'Désarchiver' : 'Archiver'}</button>
      <button class="btn btn-ghost danger" onClick=${() => { setUi({ selectedHabit: null }); withUndo('Habitude supprimée', () => removeItem('habits', h.id)) }}><${Icon} name="trash" size=${15} />Supprimer</button>
    </div>
  </aside>`
}

// Grille semaines × jours ; cliquer une case bascule la réalisation de ce jour.
function HabitHistory({ h, d }) {
  const now = new Date()
  const ws = d.settings.weekStart
  const first = addDays(startOfWeek(now, ws), -15 * 7)
  const hs = useMemo(() => history(d.habitLogs, h, first, now), [d.habitLogs, h, ws])
  const weeks = []
  for (let i = 0; i < hs.length; i += 7) weeks.push(hs.slice(i, i + 7))
  return html`<div class="hh">
    <div class="hh-days">${weekdayOrder(ws).map(x => html`<span>${WEEKDAYS_LETTER[x]}</span>`)}</div>
    ${weeks.map((w, wi) => html`<div class="hh-week">
      <span class="hh-month">${w[0].day.getDate() <= 7 || (wi === 0 && w[0].day.getDate() <= 21) ? MONTHS_SHORT[w[0].day.getMonth()] : ''}</span>
      ${w.map(x => html`<button class=${cx('hh-cell', !x.scheduled && 'off', x.done && 'done', x.count > 0 && !x.done && 'partial')}
        disabled=${!x.scheduled} title=${cap(fmtDayShort(x.day)) + (x.scheduled ? ' · ' + (x.done ? 'fait' : x.count ? x.count + '/' + target(h) : 'non fait') : ' · non prévu')}
        onClick=${() => setHabitCount(h.id, x.day, x.done ? 0 : target(h))}></button>`)}
    </div>`)}
  </div>`
}

// ─── Routines ────────────────────────────────────────────────────────────────

function Routines() {
  const d = useDb()
  const [editing, setEditing] = useState(null)
  const now = new Date()
  const add = () => {
    const r = addItem('routines', { name: 'Nouvelle routine', categoryId: null, days: [1, 2, 3, 4, 5], time: null, reminder: false, steps: [], archived: false })
    setEditing(r.id)
  }
  const list = d.routines.filter(r => !r.archived)
  return html`<div class="routines-scroll">
    <div class="list-head"><button class="btn btn-primary sm" onClick=${add}><${Icon} name="plus" size=${14} />Nouvelle routine</button>
      <span class="muted">Une routine est une suite d'étapes à enchaîner (matin, révisions, coucher…).</span></div>
    ${list.length === 0 && html`<${Empty} icon="listCheck" title="Aucune routine" text="Créez une routine pour enchaîner vos étapes habituelles sans y penser." />`}
    <div class="routine-grid">
      ${list.map(r => editing === r.id ? html`<${RoutineEditor} key=${r.id} r=${r} onDone=${() => setEditing(null)} />` : html`<${RoutineCard} key=${r.id} r=${r} now=${now} onEdit=${() => setEditing(r.id)} />`)}
    </div>
  </div>`
}

function RoutineCard({ r, now, onEdit }) {
  const d = useDb()
  const today = routineScheduled(r, now)
  const p = routineProgress(d.routineLogs, r, now)
  const days = weekdayOrder(d.settings.weekStart).filter(x => (r.days || []).includes(x))
  return html`<div class=${cx('card routine-card', p.complete && 'complete')}>
    <div class="card-head">
      <div><h2>${r.name}</h2><div class="card-sub">${days.map(x => WEEKDAYS[x].slice(0, 3) + '.').join(' ') || 'Aucun jour'}${r.time ? ' · ' + r.time : ''} · ${routineMinutes(r)} min${r.reminder ? ' · rappel' : ''}</div></div>
      <${IconButton} icon="edit" label="Modifier" onClick=${onEdit} />
    </div>
    <${CatTag} id=${r.categoryId} />
    ${today ? html`
      <div class="progress"><span style=${{ width: (p.total ? p.done / p.total * 100 : 0) + '%' }}></span></div>
      <div class="routine-steps">
        ${(r.steps || []).map(st => html`<label class=${cx('routine-step', p.doneIds.has(st.id) && 'done')} key=${st.id}>
          <${Checkbox} checked=${p.doneIds.has(st.id)} size=${15} onChange=${() => toggleRoutineStep(r.id, now, st.id)} label=${st.title} />
          <span>${st.title}</span>${st.minutes > 0 && html`<span class="muted">${st.minutes} min</span>`}</label>`)}
        ${(r.steps || []).length === 0 && html`<div class="card-empty">Ajoutez des étapes avec le bouton Modifier.</div>`}
      </div>` : html`<div class="card-empty">Pas prévue aujourd'hui · ${(r.steps || []).length} étape${(r.steps || []).length > 1 ? 's' : ''}</div>`}
  </div>`
}

function RoutineEditor({ r, onDone }) {
  const d = useDb()
  const [step, setStep] = useState('')
  const set = patch => updateItem('routines', r.id, patch)
  const steps = r.steps || []
  const move = (i, dir) => { const s = steps.slice(); const [x] = s.splice(i, 1); s.splice(i + dir, 0, x); set({ steps: s }) }
  return html`<div class="card routine-card editing">
    <input class="td-title" value=${r.name} onInput=${e => set({ name: e.target.value })} placeholder="Nom de la routine" />
    <div class="form-grid">
      <${Field} label="Jours"><div class="day-chips">
        ${weekdayOrder(d.settings.weekStart).map(x => html`<button class=${cx('day-chip', (r.days || []).includes(x) && 'on')} title=${WEEKDAYS[x]}
          onClick=${() => { const ds = new Set(r.days || []); ds.has(x) ? ds.delete(x) : ds.add(x); set({ days: [...ds] }) }}>${WEEKDAYS_LETTER[x]}</button>`)}
      </div><//>
      <${Field} label="Heure de début (facultatif)"><div class="inline">
        <input type="time" class="input" value=${r.time || ''} onChange=${e => set({ time: e.target.value || null })} />
        <label class="inline-check"><${Switch} checked=${!!r.reminder} onChange=${v => set({ reminder: v })} label="Rappel" /> Rappel</label>
      </div><//>
      <${Field} label="Catégorie"><${CategorySelect} value=${r.categoryId} onChange=${v => set({ categoryId: v })} /><//>
    </div>
    <div class="side-title-sm">Étapes · ${routineMinutes(r)} min</div>
    ${steps.map((st, i) => html`<div class="step-edit" key=${st.id}>
      <input class="input" value=${st.title} onInput=${e => set({ steps: steps.map(x => x.id === st.id ? { ...x, title: e.target.value } : x) })} />
      <input class="input num" type="number" min="0" value=${st.minutes || 0} title="Minutes" onChange=${e => set({ steps: steps.map(x => x.id === st.id ? { ...x, minutes: Math.max(0, Number(e.target.value) || 0) } : x) })} />
      <button class="icon-btn sm" disabled=${i === 0} aria-label="Monter" onClick=${() => move(i, -1)}><${Icon} name="arrowUp" size=${13} /></button>
      <button class="icon-btn sm" disabled=${i === steps.length - 1} aria-label="Descendre" onClick=${() => move(i, 1)}><${Icon} name="arrowDown" size=${13} /></button>
      <button class="icon-btn sm" aria-label="Supprimer l'étape" onClick=${() => set({ steps: steps.filter(x => x.id !== st.id) })}><${Icon} name="x" size=${13} /></button>
    </div>`)}
    <div class="subtask add"><${Icon} name="plus" size=${14} />
      <input placeholder="Ajouter une étape puis Entrée" value=${step} onInput=${e => setStep(e.target.value)}
        onKeyDown=${e => { if (e.key === 'Enter' && step.trim()) { set({ steps: [...steps, { id: uid(), title: step.trim(), minutes: 5 }] }); setStep('') } }} /></div>
    <div class="td-foot">
      <button class="btn btn-primary sm" onClick=${onDone}>Terminé</button>
      <button class="btn btn-ghost danger sm" onClick=${() => withUndo('Routine supprimée', () => removeItem('routines', r.id))}><${Icon} name="trash" size=${14} />Supprimer</button>
    </div>
  </div>`
}

// ─── Rappels et alarmes ──────────────────────────────────────────────────────

function Reminders() {
  const d = useDb()
  const now = new Date()
  const def = () => { const x = new Date(now); x.setMinutes(0, 0, 0); x.setHours(x.getHours() + 1); return toIso(x) }
  const [title, setTitle] = useState('')
  const [at, setAt] = useState(def)
  const [repeat, setRepeat] = useState('')
  const [alarm, setAlarm] = useState(false)
  const add = () => {
    if (!title.trim() || !at) return
    addItem('reminders', { title: title.trim(), at, repeat: repeat || null, alarm, done: false, skips: [] })
    setTitle(''); setAt(def()); setRepeat(''); setAlarm(false)
  }
  const active = d.reminders.filter(r => r.repeat || !r.done).sort((a, b) => a.at.localeCompare(b.at))
  const past = d.reminders.filter(r => !r.repeat && r.done).sort((a, b) => b.at.localeCompare(a.at))
  return html`<div class="routines-scroll">
    <div class="card reminder-form">
      <input class="input grow" placeholder="Rappel — « Rendre le dossier de bourse »" value=${title} onInput=${e => setTitle(e.target.value)} onKeyDown=${e => e.key === 'Enter' && add()} />
      <input class="input" type="datetime-local" value=${at} onChange=${e => setAt(e.target.value)} />
      <select class="input select" value=${repeat} onChange=${e => setRepeat(e.target.value)}>
        <option value="">Une fois</option>${Object.entries(REPEATS).map(([k, l]) => html`<option value=${k}>${l}</option>`)}
      </select>
      <label class="inline-check"><${Switch} checked=${alarm} onChange=${setAlarm} label="Alarme" /> Alarme</label>
      <button class="btn btn-primary sm" disabled=${!title.trim()} onClick=${add}>Ajouter</button>
    </div>
    <p class="field-hint">Une <b>alarme</b> reste affichée jusqu'à ce que vous la fermiez, sonne trois fois et passe outre les heures calmes. Les rappels partent tant que ZR Agenda tourne (fenêtre ouverte ou icône dans la zone de notification).</p>
    ${active.length === 0 && past.length === 0 && html`<${Empty} icon="bell" title="Aucun rappel" text="Ajoutez un rappel ponctuel ou récurrent, indépendant de l'agenda." />`}
    ${active.length > 0 && html`<div class="group-label">À venir<span class="count">${active.length}</span></div>`}
    ${active.map(r => html`<${ReminderRow} key=${r.id} r=${r} now=${now} />`)}
    ${past.length > 0 && html`<div class="group-label">Passés<span class="count">${past.length}</span></div>`}
    ${past.slice(0, 20).map(r => html`<${ReminderRow} key=${r.id} r=${r} now=${now} />`)}
  </div>`
}

function ReminderRow({ r, now }) {
  const at = parse(r.at)
  const set = patch => updateItem('reminders', r.id, patch)
  return html`<div class=${cx('reminder-row', r.done && !r.repeat && 'done')}>
    <${Icon} name=${r.alarm ? 'alarm' : 'bell'} size=${16} />
    <input class="input bare" value=${r.title} onInput=${e => set({ title: e.target.value })} />
    <span class="muted">${r.repeat ? REPEATS[r.repeat] + ' · ' + hm(at) : fmtRelativeDay(at, now) + ' · ' + hm(at)}</span>
    <label class="inline-check"><${Switch} checked=${!!r.alarm} onChange=${v => set({ alarm: v })} label="Alarme" /> Alarme</label>
    ${!r.repeat && html`<button class="btn btn-ghost sm" onClick=${() => set({ done: !r.done })}>${r.done ? 'Réactiver' : 'Marquer fait'}</button>`}
    <button class="icon-btn sm" aria-label="Supprimer" onClick=${() => withUndo('Rappel supprimé', () => removeItem('reminders', r.id))}><${Icon} name="trash" size=${14} /></button>
  </div>`
}

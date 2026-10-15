import { html, useState, useEffect, useRef } from './lib.js'
import {
  parse, toIso, ymd, addDays, addMinutes, startOfDay, MINUTE, DAY, WEEKDAYS, WEEKDAYS_LETTER, MONTHS,
  describeRecurrence, nthLabel, fmtDuration, expandAll, fmtTime, fmtDayShort, weekdayOrder, pad
} from './dates.js'
import { Icon } from './icons.js'
import { Switch, AutoTextarea, IconButton, Kbd, cx } from './ui.js'
import { useUi, db, setUi, addEvent, updateEvent, detachOccurrence, ask, toast, withUndo, removeEvent } from './store.js'
import { deleteOccurrence } from './calendar.js'
import { draftConflicts } from './core/conflicts.js'

const REMINDERS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080]
const remLabel = m => m === 0 ? "À l'heure de début" : m < 60 ? m + ' minutes avant' : m < 1440 ? (m / 60) + (m === 60 ? ' heure avant' : ' heures avant') : m < 10080 ? (m / 1440) + (m === 1440 ? ' jour avant' : ' jours avant') : '1 semaine avant'

function recurrencePresets(start) {
  const wd = start.getDay()
  return [
    { key: 'none', label: 'Ne se répète pas', value: null },
    { key: 'daily', label: 'Tous les jours', value: { freq: 'daily', interval: 1 } },
    { key: 'weekdays', label: 'Tous les jours de semaine (lun. – ven.)', value: { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5] } },
    { key: 'weekly', label: 'Toutes les semaines le ' + WEEKDAYS[wd], value: { freq: 'weekly', interval: 1, byDay: [wd] } },
    { key: 'biweekly', label: 'Toutes les deux semaines le ' + WEEKDAYS[wd], value: { freq: 'weekly', interval: 2, byDay: [wd] } },
    { key: 'monthly', label: 'Tous les mois le ' + start.getDate(), value: { freq: 'monthly', interval: 1, monthlyMode: 'day' } },
    { key: 'monthlyWd', label: 'Tous les mois le ' + nthLabel(start).label, value: { freq: 'monthly', interval: 1, monthlyMode: 'weekday' } },
    { key: 'yearly', label: 'Tous les ans le ' + start.getDate() + ' ' + MONTHS[start.getMonth()], value: { freq: 'yearly', interval: 1 } },
    { key: 'custom', label: 'Personnalisé…', value: 'custom' }
  ]
}

function presetKey(rec, start) {
  if (!rec) return 'none'
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const norm = r => ({ freq: r.freq, interval: r.interval || 1, byDay: r.byDay && r.byDay.length ? r.byDay.slice().sort() : undefined, monthlyMode: r.freq === 'monthly' ? r.monthlyMode || 'day' : undefined })
  if (rec.until || rec.count) return 'custom'
  for (const p of recurrencePresets(start)) {
    if (p.value && p.value !== 'custom' && same(norm(p.value), norm(rec))) return p.key
  }
  if (rec.freq === 'weekly' && (!rec.byDay || !rec.byDay.length) && (rec.interval || 1) === 1) return 'weekly'
  return 'custom'
}

export function EventEditor() {
  const u = useUi()
  if (!u.editor) return null
  return html`<${EditorPanel} key=${u.editor.draft.id || 'new'} editor=${u.editor} />`
}

function EditorPanel({ editor }) {
  const d = db()
  const s = d.settings
  const [ev, setEv] = useState(editor.draft)
  const [showCustom, setShowCustom] = useState(() => presetKey(editor.draft.recurrence, parse(editor.draft.start)) === 'custom')
  const titleRef = useRef()
  const isNew = !ev.id

  useEffect(() => { setTimeout(() => titleRef.current && titleRef.current.focus(), 60) }, [])

  const start = parse(ev.start), end = parse(ev.end)
  const set = patch => setEv(prev => ({ ...prev, ...patch }))
  const duration = Math.round((end - start) / MINUTE)

  // Dates : en mode « journée », la fin affichée est inclusive.
  const endDateShown = ev.allDay ? ymd(addDays(end, -1)) : ymd(end)

  const setStartDate = v => {
    if (!v) return
    const ns = parse(v + 'T' + toIso(start).slice(11))
    const delta = ns - start
    set({ start: toIso(ns), end: toIso(new Date(end.getTime() + delta)) })
  }
  const setStartTime = v => {
    if (!v) return
    const ns = parse(ymd(start) + 'T' + v)
    set({ start: toIso(ns), end: toIso(new Date(ns.getTime() + (end - start))) })
  }
  const setEndDate = v => {
    if (!v) return
    let ne = ev.allDay ? addDays(parse(v), 1) : parse(v + 'T' + toIso(end).slice(11))
    if (ne <= start) ne = ev.allDay ? addDays(startOfDay(start), 1) : addMinutes(start, 30)
    set({ end: toIso(ne) })
  }
  const setEndTime = v => {
    if (!v) return
    let ne = parse(ymd(end) + 'T' + v)
    if (ne <= start) ne = parse(ymd(start) + 'T' + v)
    if (ne <= start) ne = addDays(ne, 1)
    set({ end: toIso(ne) })
  }
  const toggleAllDay = on => {
    if (on) set({ allDay: true, start: toIso(startOfDay(start)), end: toIso(addDays(startOfDay(end > start && !sameMidnight(end) ? end : addMinutes(end, -1)), 1)) })
    else {
      const ns = new Date(startOfDay(start)); ns.setHours(Math.max(s.workStart, 9))
      set({ allDay: false, start: toIso(ns), end: toIso(addMinutes(ns, s.defaultDuration)) })
    }
  }

  const presets = recurrencePresets(start)
  const pkey = showCustom ? 'custom' : presetKey(ev.recurrence, start)
  const onPreset = key => {
    const p = presets.find(x => x.key === key)
    if (p.value === 'custom') {
      setShowCustom(true)
      if (!ev.recurrence) set({ recurrence: { freq: 'weekly', interval: 1, byDay: [start.getDay()] } })
    } else {
      setShowCustom(false)
      set({ recurrence: p.value ? { ...p.value } : null })
    }
  }
  const rec = ev.recurrence
  const setRec = patch => set({ recurrence: { ...rec, ...patch } })

  // Conflits avec d'autres événements
  // (série comprise : les 6 prochains mois d'occurrences sont vérifiés)
  const conflicts = draftConflicts(ev, d.events, new Set(d.calendars.filter(c => c.visible).map(c => c.id))).map(c => c.other)
  const periods = (d.periods || []).filter(p => p.end && p.end >= ymd(start) && (!p.start || p.start <= ymd(start)))

  const close = () => setUi({ editor: null })

  const save = async () => {
    const data = { ...ev, title: ev.title.trim() || 'Sans titre' }
    if (isNew) {
      const created = addEvent(data)
      toast('Événement créé', { action: 'Annuler', onAction: () => removeEvent(created.id) })
      return close()
    }
    if (editor.occurrence) {
      const master = d.events.find(x => x.id === ev.id)
      const r = await ask({
        title: 'Modifier un événement récurrent',
        message: 'Appliquer les modifications à :',
        stacked: true,
        actions: [
          { label: 'Cet événement uniquement', value: 'one', tone: 'primary' },
          { label: 'Tous les événements de la série', value: 'all' },
          { label: 'Annuler', value: null }
        ]
      })
      if (!r) return
      if (r === 'one') {
        const { id, createdAt, updatedAt, exdates, ...rest } = data
        detachOccurrence(master.id, editor.occurrence, { ...rest })
      } else {
        // Décale la série du même écart que l'occurrence modifiée
        const occStart = parse(editor.occurrence + 'T' + master.start.slice(11))
        const delta = start - occStart
        const ms = new Date(parse(master.start).getTime() + delta)
        const { id, createdAt, ...rest } = data
        updateEvent(master.id, { ...rest, start: toIso(ms), end: toIso(new Date(ms.getTime() + (end - start))), exdates: master.exdates })
      }
      toast('Modifications enregistrées')
      return close()
    }
    updateEvent(ev.id, data)
    toast('Modifications enregistrées')
    close()
  }

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); close() }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save() }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const cal = d.calendars.find(c => c.id === ev.calendarId)
  const reminders = (ev.reminders || []).slice().sort((a, b) => a - b)
  const order = weekdayOrder(s.weekStart)

  return html`
    <div class="drawer-layer" onMouseDown=${e => { if (e.target === e.currentTarget) close() }}>
      <aside class="drawer" role="dialog" aria-label=${isNew ? 'Nouvel événement' : "Modifier l'événement"} style=${{ '--c': cal?.color }}>
        <header class="drawer-head">
          <span class="drawer-kicker">${isNew ? 'Nouvel événement' : editor.occurrence ? 'Occurrence d\'une série' : 'Événement'}</span>
          <${IconButton} icon="x" label="Fermer" onClick=${close} />
        </header>

        <div class="drawer-body">
          <div class="title-field">
            <span class="title-swatch"></span>
            <input ref=${titleRef} class="title-input" placeholder="Ajouter un titre" value=${ev.title}
              onInput=${e => set({ title: e.target.value })} onKeyDown=${e => { if (e.key === 'Enter') save() }} />
          </div>

          <div class="field-row">
            <${Icon} name="clock" size=${16} class="field-icon" />
            <div class="field-main">
              <div class="datetime-grid">
                <span class="dt-label">Début</span>
                <input type="date" class="input" value=${ymd(start)} onChange=${e => setStartDate(e.target.value)} />
                ${!ev.allDay ? html`<input type="time" class="input" step="300" value=${toIso(start).slice(11)} onChange=${e => setStartTime(e.target.value)} />` : html`<span></span>`}
                <span class="dt-label">Fin</span>
                <input type="date" class="input" value=${endDateShown} min=${ymd(start)} onChange=${e => setEndDate(e.target.value)} />
                ${!ev.allDay ? html`<input type="time" class="input" step="300" value=${toIso(end).slice(11)} onChange=${e => setEndTime(e.target.value)} />` : html`<span></span>`}
              </div>
              <div class="field-sub">
                <label class="inline-switch"><${Switch} checked=${ev.allDay} onChange=${toggleAllDay} label="Toute la journée" /> Toute la journée</label>
                ${!ev.allDay && html`<span class="muted">${fmtDuration(duration)}</span>`}
                ${!ev.allDay && html`<div class="dur-chips">
                  ${[15, 30, 45, 60, 90, 120].map(m => html`<button class=${cx('chip-btn', duration === m && 'active')}
                    onClick=${() => set({ end: toIso(addMinutes(start, m)) })}>${fmtDuration(m)}</button>`)}
                </div>`}
              </div>
              ${conflicts.length > 0 && html`<div class="conflict">
                <${Icon} name="info" size=${14} />
                Chevauche « ${conflicts[0].ev.title || 'Sans titre'} » (${fmtDayShort(conflicts[0].start)}, ${fmtTime(conflicts[0].start, s.h12)})${conflicts.length > 1 ? ' et ' + (conflicts.length - 1) + ' autre' + (conflicts.length > 2 ? 's' : '') + ' occurrence' + (conflicts.length > 2 ? 's' : '') : ''}
              </div>`}
            </div>
          </div>

          <div class="field-row">
            <${Icon} name="repeat" size=${16} class="field-icon" />
            <div class="field-main">
              <select class="input select" value=${pkey} onChange=${e => onPreset(e.target.value)}>
                ${presets.map(p => html`<option value=${p.key}>${p.label}</option>`)}
              </select>
              ${pkey === 'custom' && rec && html`
                <div class="rec-custom">
                  <div class="rec-line">
                    <span>Toutes les</span>
                    <input type="number" min="1" max="99" class="input num" value=${rec.interval || 1}
                      onInput=${e => setRec({ interval: Math.max(1, Number(e.target.value) || 1) })} />
                    <select class="input select" value=${rec.freq} onChange=${e => setRec({ freq: e.target.value, byDay: e.target.value === 'weekly' ? [start.getDay()] : undefined })}>
                      <option value="daily">jour(s)</option>
                      <option value="weekly">semaine(s)</option>
                      <option value="monthly">mois</option>
                      <option value="yearly">année(s)</option>
                    </select>
                  </div>
                  ${rec.freq === 'weekly' && html`
                    <div class="weekday-picker">
                      ${order.map(w => {
                        const on = (rec.byDay || [start.getDay()]).includes(w)
                        return html`<button class=${cx('wd', on && 'on')} title=${WEEKDAYS[w]} onClick=${() => {
                          const cur = rec.byDay && rec.byDay.length ? rec.byDay : [start.getDay()]
                          const next = on ? cur.filter(x => x !== w) : [...cur, w]
                          if (next.length) setRec({ byDay: next })
                        }}>${WEEKDAYS_LETTER[w]}</button>`
                      })}
                    </div>`}
                  ${rec.freq === 'monthly' && html`
                    <select class="input select" value=${rec.monthlyMode || 'day'} onChange=${e => setRec({ monthlyMode: e.target.value })}>
                      <option value="day">Le ${start.getDate()} du mois</option>
                      <option value="weekday">Le ${nthLabel(start).label} du mois</option>
                    </select>`}
                  <div class="rec-end">
                    <span class="muted">Fin</span>
                    <select class="input select" value=${rec.until ? 'until' : rec.count ? 'count' : 'never'}
                      onChange=${e => {
                        const v = e.target.value
                        if (v === 'never') setRec({ until: null, count: null })
                        if (v === 'until') setRec({ until: ymd(addDays(start, 30)), count: null })
                        if (v === 'count') setRec({ count: 10, until: null })
                      }}>
                      <option value="never">Jamais</option>
                      <option value="until">Le</option>
                      <option value="count">Après</option>
                    </select>
                    ${rec.until && html`<input type="date" class="input" min=${ymd(start)} value=${rec.until} onChange=${e => e.target.value && setRec({ until: e.target.value })} />`}
                    ${rec.count && html`<input type="number" class="input num" min="1" max="999" value=${rec.count}
                      onInput=${e => setRec({ count: Math.max(1, Number(e.target.value) || 1) })} /><span class="muted">occurrences</span>`}
                  </div>
                  <div class="rec-summary">${describeRecurrence(rec, start)}</div>
                </div>`}
              ${rec && periods.length > 0 && html`<div class="period-chips"><span class="muted">S'arrêter à la fin de</span>
                ${periods.map(p => html`<button class=${cx('chip-btn', rec.until === p.end && 'active')} title=${"Jusqu'au " + fmtDayShort(parse(p.end))}
                  onClick=${() => { setRec({ until: p.end, count: null }); setShowCustom(true) }}>${p.name}</button>`)}</div>`}
            </div>
          </div>

          <div class="field-row">
            <${Icon} name="calendar" size=${16} class="field-icon" />
            <div class="field-main">
              <div class="cal-picker">
                ${d.calendars.map(c => html`<button class=${cx('cal-opt', c.id === ev.calendarId && 'active')} style=${{ '--c': c.color }}
                  onClick=${() => set({ calendarId: c.id })}><span class="dot"></span>${c.name}</button>`)}
              </div>
            </div>
          </div>

          <div class="field-row">
            <${Icon} name="mapPin" size=${16} class="field-icon" />
            <div class="field-main with-action">
              <input class="input bare" placeholder="Ajouter un lieu ou un lien de visio" value=${ev.location}
                onInput=${e => set({ location: e.target.value })} />
              ${ev.location && html`<a class="icon-btn" title="Ouvrir dans Google Maps" target="_blank"
                href=${/^https?:/.test(ev.location) ? ev.location : 'https://www.google.com/maps/search/' + encodeURIComponent(ev.location)}><${Icon} name="externalLink" size=${15} /></a>`}
            </div>
          </div>

          <div class="field-row">
            <${Icon} name="bell" size=${16} class="field-icon" />
            <div class="field-main">
              <div class="reminders">
                ${reminders.map(m => html`<span class="rem-chip">${remLabel(m)}
                  <button aria-label="Retirer" onClick=${() => set({ reminders: reminders.filter(x => x !== m) })}><${Icon} name="x" size=${12} /></button></span>`)}
                ${reminders.length < 5 && html`
                  <select class="input select ghost-select" value="" onChange=${e => { const v = Number(e.target.value); if (!reminders.includes(v)) set({ reminders: [...reminders, v] }); e.target.value = '' }}>
                    <option value="" disabled>${reminders.length ? 'Ajouter un rappel' : 'Aucun rappel — en ajouter un'}</option>
                    ${REMINDERS.filter(m => !reminders.includes(m)).map(m => html`<option value=${m}>${remLabel(m)}</option>`)}
                  </select>`}
              </div>
            </div>
          </div>

          <div class="field-row top">
            <${Icon} name="text" size=${16} class="field-icon" />
            <div class="field-main">
              <${AutoTextarea} class="input bare textarea" placeholder="Ajouter une description, un ordre du jour, des notes…" minRows=${3}
                value=${ev.description} onInput=${v => set({ description: v })} />
            </div>
          </div>
        </div>

        <footer class="drawer-foot">
          ${!isNew && html`<button class="btn btn-ghost danger" onClick=${() => {
            const occ = editor.occurrence
            close()
            const o = { ev: d.events.find(x => x.id === ev.id), start, end, occurrence: occ, key: ev.id }
            deleteOccurrence(o)
          }}><${Icon} name="trash" size=${15} />Supprimer</button>`}
          <span class="foot-hint"><${Kbd}>Ctrl</${Kbd}>+<${Kbd}>Entrée</${Kbd}></span>
          <button class="btn btn-secondary" onClick=${close}>Annuler</button>
          <button class="btn btn-primary" onClick=${save}>${isNew ? 'Créer' : 'Enregistrer'}</button>
        </footer>
      </aside>
    </div>`
}

function sameMidnight(d) { return d.getHours() === 0 && d.getMinutes() === 0 }

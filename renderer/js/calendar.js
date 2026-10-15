import { html, useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from './lib.js'
import {
  DAY, MINUTE, addDays, addMinutes, startOfDay, startOfWeek, startOfMonth, sameDay, diffDays, parse, toIso, ymd,
  minutesOfDay, isoWeek, fmtTime, fmtDayLong, fmtDayShort, fmtMonthYear, fmtRange, fmtRelativeDay, describeRecurrence,
  holidayOf, expandAll, monthMatrix, weekdayOrder, MONTHS, MONTHS_SHORT, WEEKDAYS_SHORT, WEEKDAYS_LETTER, cap, fmtDuration, pad
} from './dates.js'
import { Icon } from './icons.js'
import { Floating, Menu, Segmented, Checkbox, IconButton, Kbd, cx } from './ui.js'
import {
  useDb, useUi, db, ui, setUi, openEditor, addEvent, updateEvent, removeEvent, excludeOccurrence, endSeriesBefore,
  detachOccurrence, withUndo, ask, toast, toggleTask, setSettings
} from './store.js'
import { parseQuick, quickToEvent } from './nlp.js'

// ─── Helpers ────────────────────────────────────────────────────────────────

export function calColor(calendarId) {
  const c = db().calendars.find(x => x.id === calendarId)
  return c ? c.color : 'var(--text-3)'
}

export function useOccurrences(from, to) {
  const d = useDb()
  const fromT = from.getTime(), toT = to.getTime()
  return useMemo(() => {
    const visible = new Set(d.calendars.filter(c => c.visible).map(c => c.id))
    return expandAll(d.events, from, to, visible)
  }, [d.events, d.calendars, fromT, toT])
}

const isAllDayLike = o => o.ev.allDay || o.end - o.start >= DAY

function tasksByDay(tasks) {
  const map = new Map()
  for (const t of tasks) {
    if (!t.due) continue
    if (!map.has(t.due)) map.set(t.due, [])
    map.get(t.due).push(t)
  }
  return map
}

export function navigate(dir) {
  const { view, date } = ui()
  let d
  if (dir === 0) d = startOfDay(new Date())
  else if (view === 'day') d = addDays(date, dir)
  else if (view === 'week' || view === 'list') d = addDays(date, 7 * dir)
  else if (view === 'month') { d = new Date(date.getFullYear(), date.getMonth() + dir, 1) }
  else if (view === 'year') d = new Date(date.getFullYear() + dir, 0, 1)
  setUi({ date: d })
}

export function weekDays(date, settings) {
  const start = startOfWeek(date, settings.weekStart)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  return settings.hideWeekends ? days.filter(d => d.getDay() !== 0 && d.getDay() !== 6) : days
}

// ─── Actions communes ───────────────────────────────────────────────────────

export function editOccurrence(o) {
  const draft = { ...o.ev }
  if (o.occurrence) { draft.start = toIso(o.start); draft.end = toIso(o.end) }
  openEditor(draft, o.occurrence || null)
}

export function duplicateEvent(o) {
  const { id, createdAt, updatedAt, ...rest } = o.ev
  const copy = addEvent({ ...rest, start: toIso(o.start), end: toIso(o.end), recurrence: null, exdates: [], title: o.ev.title })
  setUi({ popover: null })
  toast('Événement dupliqué', { action: 'Modifier', onAction: () => openEditor(copy) })
}

export async function deleteOccurrence(o) {
  setUi({ popover: null })
  if (o.occurrence) {
    const r = await ask({
      title: 'Supprimer un événement récurrent',
      message: '« ' + (o.ev.title || 'Sans titre') + ' » fait partie d\'une série.',
      stacked: true,
      actions: [
        { label: 'Cet événement uniquement', value: 'one', tone: 'primary' },
        { label: 'Cet événement et les suivants', value: 'following' },
        { label: 'Toute la série', value: 'all' },
        { label: 'Annuler', value: null }
      ]
    })
    if (!r) return
    withUndo(r === 'all' ? 'Série supprimée' : 'Événement supprimé', () => {
      if (r === 'one') excludeOccurrence(o.ev.id, o.occurrence)
      else if (r === 'following') endSeriesBefore(o.ev.id, o.occurrence)
      else removeEvent(o.ev.id)
    })
  } else {
    withUndo('Événement supprimé', () => removeEvent(o.ev.id))
  }
}

// Déplace / redimensionne une occurrence (deltas en millisecondes).
export async function shiftOccurrence(o, dStart, dEnd) {
  if (!dStart && !dEnd) return
  const ns = new Date(o.start.getTime() + dStart), ne = new Date(o.end.getTime() + dEnd)
  if (ne <= ns) return
  if (o.occurrence) {
    const r = await ask({
      title: 'Modifier un événement récurrent',
      message: 'Appliquer ce changement à quelle partie de la série ?',
      stacked: true,
      actions: [
        { label: 'Cet événement uniquement', value: 'one', tone: 'primary' },
        { label: 'Toute la série', value: 'all' },
        { label: 'Annuler', value: null }
      ]
    })
    if (!r) return
    if (r === 'one') detachOccurrence(o.ev.id, o.occurrence, { start: toIso(ns), end: toIso(ne) })
    else {
      const ms = parse(o.ev.start), me = parse(o.ev.end)
      updateEvent(o.ev.id, { start: toIso(new Date(ms.getTime() + dStart)), end: toIso(new Date(me.getTime() + dEnd)) })
    }
  } else {
    updateEvent(o.ev.id, { start: toIso(ns), end: toIso(ne) })
  }
}

function newDraftAt(start, minutes, allDay = false) {
  const s = db().settings
  const calId = s.defaultCalendarId && db().calendars.some(c => c.id === s.defaultCalendarId) ? s.defaultCalendarId : db().calendars[0]?.id
  return {
    title: '', calendarId: calId, allDay,
    start: toIso(start), end: toIso(allDay ? addDays(start, 1) : addMinutes(start, minutes || s.defaultDuration)),
    location: '', description: '', recurrence: null, exdates: [],
    reminders: allDay || s.defaultReminder < 0 ? [] : [s.defaultReminder]
  }
}

export function createAt(start, minutes, allDay) { openEditor(newDraftAt(start, minutes, allDay)) }

export function openOccurrence(o, el) {
  setUi({ popover: { kind: 'event', rect: el.getBoundingClientRect(), payload: o } })
}

function openContextMenu(e, o) {
  e.preventDefault()
  setUi({ popover: { kind: 'event-menu', rect: { x: e.clientX, y: e.clientY }, payload: o } })
}

// ─── Section Calendrier ─────────────────────────────────────────────────────

const VIEWS = [
  { value: 'day', label: 'Jour', title: 'Jour (J)' },
  { value: 'week', label: 'Semaine', title: 'Semaine (S)' },
  { value: 'month', label: 'Mois', title: 'Mois (M)' },
  { value: 'year', label: 'Année', title: 'Année (A)' },
  { value: 'list', label: 'Liste', title: 'Liste (L)' }
]

export function CalendarSection() {
  const d = useDb()
  const u = useUi()
  const s = d.settings
  let title, sub
  if (u.view === 'day') {
    title = cap(fmtDayLong(u.date))
    sub = holidayOf(u.date) && s.showHolidays ? holidayOf(u.date) : null
  } else if (u.view === 'week') {
    const days = weekDays(u.date, s)
    const a = days[0], b = days[days.length - 1]
    title = a.getMonth() === b.getMonth() ? fmtMonthYear(a)
      : cap(MONTHS_SHORT[a.getMonth()]) + ' – ' + MONTHS_SHORT[b.getMonth()] + ' ' + b.getFullYear()
    sub = 'Semaine ' + isoWeek(addDays(startOfWeek(u.date, 1), 3))
  } else if (u.view === 'month') title = fmtMonthYear(u.date)
  else if (u.view === 'year') title = String(u.date.getFullYear())
  else { title = 'Agenda'; sub = 'À partir du ' + fmtDayShort(u.date) }

  return html`
    <section class="section calendar-section">
      <header class="toolbar">
        <div class="toolbar-left">
          <button class="btn btn-secondary" onClick=${() => navigate(0)} title="Aujourd'hui (T)">Aujourd'hui</button>
          <div class="nav-arrows">
            <${IconButton} icon="chevronLeft" label="Précédent" kbd="←" onClick=${() => navigate(-1)} />
            <${IconButton} icon="chevronRight" label="Suivant" kbd="→" onClick=${() => navigate(1)} />
          </div>
          <h1 class="toolbar-title">${title}</h1>
          ${sub && html`<span class="chip">${sub}</span>`}
        </div>
        <div class="toolbar-right">
          <${QuickAdd} />
          ${(u.view === 'week' || u.view === 'day') && html`
            <div class="zoom">
              <${IconButton} icon="zoomOut" label="Réduire" onClick=${() => setSettings({ hourHeight: Math.max(36, s.hourHeight - 8) })} />
              <${IconButton} icon="zoomIn" label="Agrandir" onClick=${() => setSettings({ hourHeight: Math.min(120, s.hourHeight + 8) })} />
            </div>`}
          <${Segmented} value=${u.view} options=${VIEWS} onChange=${v => setUi({ view: v })} />
        </div>
      </header>
      <div class="calendar-body">
        ${u.view === 'day' && html`<${TimeGrid} days=${[u.date]} />`}
        ${u.view === 'week' && html`<${TimeGrid} days=${weekDays(u.date, s)} />`}
        ${u.view === 'month' && html`<${MonthView} />`}
        ${u.view === 'year' && html`<${YearView} />`}
        ${u.view === 'list' && html`<${ListView} />`}
      </div>
    </section>`
}

// ─── Saisie rapide ──────────────────────────────────────────────────────────

function QuickAdd() {
  const [text, setText] = useState('')
  const [focus, setFocus] = useState(false)
  const ref = useRef()
  const d = db()
  const parsed = useMemo(() => text.trim() ? parseQuick(text) : null, [text])
  const draft = parsed ? quickToEvent(parsed, { defaultDuration: d.settings.defaultDuration, calendars: d.calendars, defaultCalendarId: d.settings.defaultCalendarId || d.calendars[0]?.id }) : null

  useEffect(() => {
    const onFocusQuick = () => ref.current && ref.current.focus()
    window.addEventListener('zr:quick-add', onFocusQuick)
    return () => window.removeEventListener('zr:quick-add', onFocusQuick)
  }, [])

  const submit = e => {
    if (!draft) return
    const full = { ...draft, reminders: draft.allDay || d.settings.defaultReminder < 0 ? [] : [d.settings.defaultReminder] }
    if (e.shiftKey) { openEditor(full) }
    else {
      const ev = addEvent(full)
      setUi({ date: startOfDay(parse(ev.start)) })
      toast('« ' + ev.title + ' » ajouté le ' + fmtDayShort(parse(ev.start)), { action: 'Modifier', onAction: () => openEditor(ev) })
    }
    setText('')
  }

  const cal = draft && d.calendars.find(c => c.id === draft.calendarId)
  return html`
    <div class=${cx('quick-add', focus && 'focused')}>
      <${Icon} name="plus" size=${15} />
      <input ref=${ref} value=${text} placeholder="Ajout rapide : « Déjeuner jeudi 12h30 @Le Procope »"
        onInput=${e => setText(e.target.value)} onFocus=${() => setFocus(true)} onBlur=${() => setTimeout(() => setFocus(false), 150)}
        onKeyDown=${e => { if (e.key === 'Enter') submit(e); if (e.key === 'Escape') { setText(''); e.target.blur() } }} />
      ${focus && draft && html`
        <div class="quick-preview">
          <div class="qp-title"><span class="dot" style=${{ background: cal?.color }}></span>${draft.title}</div>
          <div class="qp-meta">
            <span><${Icon} name="clock" size=${13} />${fmtRelativeDay(parse(draft.start))}, ${fmtRange(parse(draft.start), parse(draft.end), draft.allDay, d.settings.h12).toLowerCase()}</span>
            ${draft.recurrence && html`<span><${Icon} name="repeat" size=${13} />${describeRecurrence(draft.recurrence, parse(draft.start))}</span>`}
            ${draft.location && html`<span><${Icon} name="mapPin" size=${13} />${draft.location}</span>`}
            ${cal && html`<span><${Icon} name="calendar" size=${13} />${cal.name}</span>`}
          </div>
          <div class="qp-hint"><${Kbd}>Entrée</${Kbd}> créer <span class="sep"></span> <${Kbd}>Maj</${Kbd}>+<${Kbd}>Entrée</${Kbd}> détailler</div>
        </div>`}
      ${focus && !draft && html`
        <div class="quick-preview help">
          <div class="qp-help-title">Écrivez naturellement</div>
          <div class="qp-example">Rendez-vous dentiste mardi 9h30</div>
          <div class="qp-example">Point équipe chaque lundi 10h pendant 30 min #travail</div>
          <div class="qp-example">Anniversaire de Léa le 20 décembre tous les ans</div>
          <div class="qp-hint"><span class="mono">@</span> lieu <span class="sep"></span> <span class="mono">#</span> agenda <span class="sep"></span> « de 14h à 16h »</div>
        </div>`}
    </div>`
}

// ─── Grille horaire (jour / semaine) ────────────────────────────────────────

function layoutSegments(segs) {
  segs.sort((a, b) => a.s - b.s || b.e - a.e)
  let cluster = [], end = -1
  const flush = () => {
    const cols = []
    for (const seg of cluster) {
      let i = cols.findIndex(c => c <= seg.s)
      if (i < 0) { i = cols.length; cols.push(0) }
      cols[i] = seg.e
      seg.col = i
    }
    for (const seg of cluster) {
      seg.cols = cols.length
      // Étend l'événement sur les colonnes libres à sa droite
      let span = 1
      for (let c = seg.col + 1; c < cols.length; c++) {
        if (cluster.some(o => o !== seg && o.col === c && o.s < seg.e && o.e > seg.s)) break
        span++
      }
      seg.span = span
    }
  }
  for (const seg of segs) {
    if (seg.s >= end && cluster.length) { flush(); cluster = [] }
    cluster.push(seg)
    end = Math.max(end, seg.e)
  }
  if (cluster.length) flush()
  return segs
}

const SNAP = 15

function TimeGrid({ days }) {
  const d = useDb()
  const u = useUi()
  const s = d.settings
  const hh = s.hourHeight
  const from = days[0], to = addDays(days[days.length - 1], 1)
  const occ = useOccurrences(from, to)
  const scroller = useRef()
  const cols = useRef()
  const [now, setNow] = useState(new Date())
  const [drag, setDrag] = useState(null)
  const [allDayOpen, setAllDayOpen] = useState(false)
  const dragRef = useRef(null)

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t) }, [])

  useLayoutEffect(() => {
    const showsToday = days.some(x => sameDay(x, new Date()))
    const target = showsToday ? Math.max(0, minutesOfDay(new Date()) / 60 - 2) : Math.max(0, s.workStart - 0.5)
    scroller.current.scrollTop = target * hh
  }, [ymd(days[0]), days.length])

  // Événements « journée »
  const allDay = occ.filter(isAllDayLike)
  const lanes = []
  const bars = []
  for (const o of allDay) {
    const firstDay = startOfDay(o.start)
    const lastDay = startOfDay(o.ev.allDay ? addDays(o.end, -1) : new Date(o.end.getTime() - 1))
    const inside = days.map((x, i) => x >= firstDay && x <= lastDay ? i : -1).filter(i => i >= 0)
    if (!inside.length) continue
    const startIdx = inside[0], endIdx = inside[inside.length - 1]
    let lane = lanes.findIndex(l => l < startIdx)
    if (lane < 0) { lane = lanes.length; lanes.push(-1) }
    lanes[lane] = endIdx
    bars.push({ o, startIdx, endIdx, lane, clipL: firstDay < days[0], clipR: lastDay > days[days.length - 1] })
  }
  const tasks = s.showTasksInCalendar ? tasksByDay(d.tasks) : new Map()
  const maxTasks = Math.max(0, ...days.map(x => (tasks.get(ymd(x)) || []).length))
  const holidayRow = s.showHolidays && days.some(x => holidayOf(x))
  const laneLimit = allDayOpen ? 99 : 3
  const shownLanes = Math.min(lanes.length, laneLimit)
  const hol0 = holidayRow ? 1 : 0
  const moreRow = lanes.length > 3 && !allDayOpen ? 1 : 0
  const totalRows = Math.max(1, hol0 + shownLanes + moreRow + maxTasks)

  // Segments horaires par jour
  const perDay = days.map(day => {
    const ds = day.getTime(), de = addDays(day, 1).getTime()
    const segs = []
    for (const o of occ) {
      if (isAllDayLike(o)) continue
      const a = Math.max(o.start.getTime(), ds), b = Math.min(o.end.getTime(), de)
      if (b <= a && !(o.start.getTime() === o.end.getTime() && a >= ds && a < de)) continue
      segs.push({ o, s: (a - ds) / MINUTE, e: Math.max((b - ds) / MINUTE, (a - ds) / MINUTE + 15) })
    }
    return layoutSegments(segs)
  })

  // ─── Glisser-déposer ───
  const pointToSlot = (x, y) => {
    const r = cols.current.getBoundingClientRect()
    const di = Math.max(0, Math.min(days.length - 1, Math.floor((x - r.left) / (r.width / days.length))))
    const min = Math.max(0, Math.min(24 * 60, Math.round(((y - r.top) / hh * 60) / SNAP) * SNAP))
    return { di, min }
  }

  const startDrag = (e, kind, o, seg) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    setUi({ popover: null })
    const p = pointToSlot(e.clientX, e.clientY)
    const st = { kind, o, seg, origin: p, cur: p, x0: e.clientX, y0: e.clientY, moved: false, el: e.currentTarget }
    if (kind === 'move') st.grab = p.min - Math.round(seg.s / SNAP) * SNAP
    dragRef.current = st
    setDrag({ ...st })
    const onMove = ev => {
      const st = dragRef.current
      if (!st) return
      if (Math.abs(ev.clientX - st.x0) + Math.abs(ev.clientY - st.y0) > 4) st.moved = true
      st.cur = pointToSlot(ev.clientX, ev.clientY)
      autoScroll(ev.clientY)
      setDrag({ ...st })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const st = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (st) finishDrag(st)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const autoScroll = y => {
    const r = scroller.current.getBoundingClientRect()
    if (y < r.top + 30) scroller.current.scrollTop -= 12
    else if (y > r.bottom - 30) scroller.current.scrollTop += 12
  }

  const finishDrag = st => {
    if (st.kind === 'create') {
      const a = Math.min(st.origin.min, st.cur.min), b = Math.max(st.origin.min, st.cur.min)
      const day = days[st.origin.di]
      const start = addMinutes(day, st.moved ? a : st.origin.min)
      const dur = st.moved && b - a >= SNAP ? b - a : s.defaultDuration
      createAt(start, dur)
    } else if (st.kind === 'move') {
      if (!st.moved) return openOccurrence(st.o, st.el)
      const segStart = Math.round(st.seg.s / SNAP) * SNAP
      const newMin = st.cur.min - st.grab
      const delta = (diffDays(days[0], days[st.cur.di]) - diffDays(days[0], days[st.origin.di])) * DAY + (newMin - segStart) * MINUTE
      shiftOccurrence(st.o, delta, delta)
    } else if (st.kind === 'resize') {
      if (!st.moved) return
      const day = days[st.origin.di]
      const newEnd = addMinutes(day, Math.max(st.cur.min, st.seg.s + SNAP))
      shiftOccurrence(st.o, 0, newEnd - st.o.end)
    }
  }

  // Aperçu pendant le glissement
  let ghost = null
  if (drag && drag.moved) {
    if (drag.kind === 'create') {
      const a = Math.min(drag.origin.min, drag.cur.min), b = Math.max(drag.origin.min, drag.cur.min)
      if (b > a) ghost = { di: drag.origin.di, s: a, e: b, color: calColor(s.defaultCalendarId || d.calendars[0]?.id), title: 'Nouvel événement' }
    } else if (drag.kind === 'move') {
      const len = drag.seg.e - drag.seg.s
      const st = Math.max(0, Math.min(24 * 60 - SNAP, drag.cur.min - drag.grab))
      ghost = { di: drag.cur.di, s: st, e: st + len, color: calColor(drag.o.ev.calendarId), title: drag.o.ev.title }
    } else if (drag.kind === 'resize') {
      ghost = { di: drag.origin.di, s: drag.seg.s, e: Math.max(drag.cur.min, drag.seg.s + SNAP), color: calColor(drag.o.ev.calendarId), title: drag.o.ev.title }
    }
  }
  // Brouillon en cours d'édition
  const ed = u.editor
  let draftGhost = null
  if (ed && !ed.draft.id && !ed.draft.allDay) {
    const ds = parse(ed.draft.start), de = parse(ed.draft.end)
    const di = days.findIndex(x => sameDay(x, ds))
    if (di >= 0) draftGhost = { di, s: minutesOfDay(ds), e: sameDay(ds, de) ? minutesOfDay(de) : 1440, color: calColor(ed.draft.calendarId), title: ed.draft.title || 'Nouvel événement' }
  }

  const fmtGhost = g => fmtTime(addMinutes(startOfDay(new Date()), g.s), s.h12) + ' – ' + fmtTime(addMinutes(startOfDay(new Date()), g.e), s.h12)
  const nowMin = minutesOfDay(now)
  const gridCols = { gridTemplateColumns: 'var(--gutter) repeat(' + days.length + ', minmax(0, 1fr))' }
  const single = days.length === 1

  return html`
    <div class=${cx('timegrid', single && 'single', drag && drag.moved && 'dragging')} style=${{ '--hh': hh + 'px' }}>
      <div class="tg-head" style=${gridCols}>
        <div class="tg-corner">${s.showWeekNumbers && !single ? html`<span title="Semaine ISO">S${isoWeek(addDays(startOfWeek(days[0], 1), 3))}</span>` : null}</div>
        ${days.map(day => {
          const today = sameDay(day, now)
          const past = day < startOfDay(now)
          return html`<button class=${cx('tg-day', today && 'today', past && 'past', [0, 6].includes(day.getDay()) && 'weekend')}
              onClick=${() => setUi({ view: 'day', date: day })} title="Afficher la journée">
            <span class="tg-dow">${WEEKDAYS_SHORT[day.getDay()].replace('.', '')}</span>
            <span class="tg-num">${day.getDate()}</span>
          </button>`
        })}
      </div>

      ${(bars.length > 0 || maxTasks > 0 || holidayRow) && html`
        <div class="tg-allday" style=${{ ...gridCols, gridTemplateRows: 'repeat(' + totalRows + ', auto)' }}>
          <div class="tg-allday-label" style=${{ gridRow: '1 / ' + (totalRows + 1) }}>
            ${lanes.length > 3 ? html`<button class="link-btn" title=${allDayOpen ? 'Réduire' : 'Tout afficher'} onClick=${() => setAllDayOpen(!allDayOpen)}>
              <${Icon} name=${allDayOpen ? 'chevronUp' : 'chevronDown'} size=${13} /></button>` : html`<span>Journée</span>`}
          </div>
          ${days.map((day, i) => html`<div class="tg-allday-cell" style=${{ gridColumn: i + 2, gridRow: '1 / ' + (totalRows + 1) }}
              title="Double-cliquez pour créer un événement sur la journée"
              onDblClick=${() => createAt(startOfDay(day), 0, true)}></div>`)}
          ${holidayRow && days.map((day, i) => holidayOf(day) ? html`
            <div class="holiday-bar" style=${{ gridColumn: i + 2, gridRow: 1 }} title="Jour férié">${holidayOf(day)}</div>` : null)}
          ${bars.filter(b => b.lane < laneLimit).map(b => html`
            <button class=${cx('allday-bar', b.clipL && 'clip-l', b.clipR && 'clip-r')}
              style=${{ '--c': calColor(b.o.ev.calendarId), gridColumn: (b.startIdx + 2) + ' / ' + (b.endIdx + 3), gridRow: b.lane + 1 + hol0 }}
              onClick=${e => openOccurrence(b.o, e.currentTarget)} onContextMenu=${e => openContextMenu(e, b.o)}>
              ${b.o.ev.recurrence && html`<${Icon} name="repeat" size=${11} />`}${b.o.ev.title || 'Sans titre'}
            </button>`)}
          ${moreRow > 0 && days.map((day, i) => {
            const hidden = bars.filter(b => b.lane >= 3 && b.startIdx <= i && b.endIdx >= i).length
            return hidden ? html`<button class="more-bar" style=${{ gridColumn: i + 2, gridRow: 4 + hol0 }}
              onClick=${() => setAllDayOpen(true)}>+${hidden} de plus</button>` : null
          })}
          ${days.map((day, i) => (tasks.get(ymd(day)) || []).map((t, j) => html`
            <div class=${cx('task-chip', t.done && 'done')} style=${{ gridColumn: i + 2, gridRow: hol0 + shownLanes + moreRow + j + 1 }}
              onClick=${() => setUi({ section: 'tasks', selectedTask: t.id })}>
              <${Checkbox} checked=${t.done} round size=${13} onChange=${() => toggleTask(t.id)} label="Terminer" />
              <span>${t.dueTime ? t.dueTime + ' ' : ''}${t.title}</span>
            </div>`))}
        </div>`}

      <div class="tg-scroll" ref=${scroller}>
        <div class="tg-body" style=${{ ...gridCols, height: 24 * hh + 'px' }}>
          <div class="tg-gutter">
            ${Array.from({ length: 24 }, (_, h) => h === 0 || (days.some(x => sameDay(x, now)) && Math.abs(h * 60 - nowMin) < 14) ? null : html`
              <div class="tg-hour" style=${{ top: h * hh + 'px' }}>${s.h12 ? (h % 12 || 12) + (h < 12 ? ' am' : ' pm') : pad(h) + ':00'}</div>`)}
          </div>
          <div class="tg-cols" ref=${cols} style=${{ gridColumn: '2 / -1', gridTemplateColumns: 'repeat(' + days.length + ', minmax(0, 1fr))' }}>
            ${days.map((day, di) => {
              const today = sameDay(day, now)
              return html`
                <div class=${cx('tg-col', today && 'today', [0, 6].includes(day.getDay()) && 'weekend')}
                  onMouseDown=${e => { if (e.target.classList.contains('tg-col') || e.target.classList.contains('tg-work')) startDrag(e, 'create') }}>
                  <div class="tg-work" style=${{ top: s.workStart * hh + 'px', height: (s.workEnd - s.workStart) * hh + 'px' }}></div>
                  ${perDay[di].map(seg => {
                    const o = seg.o, ev = o.ev
                    const top = seg.s / 60 * hh, height = Math.max((seg.e - seg.s) / 60 * hh, 20)
                    const hiding = drag && drag.moved && drag.o === o && drag.kind !== 'create'
                    const compact = height < 40
                    const past = o.end < now
                    return html`
                      <div key=${o.key} class=${cx('ev', compact && 'compact', past && 'past', hiding && 'hiding')}
                        style=${{ '--c': calColor(ev.calendarId), top: top + 'px', height: height - 2 + 'px',
                          left: 'calc(' + (seg.col / seg.cols * 100) + '% + 1px)', width: 'calc(' + (seg.span / seg.cols * 100) + '% - 4px)' }}
                        onMouseDown=${e => startDrag(e, 'move', o, seg)} onContextMenu=${e => openContextMenu(e, o)}>
                        <div class="ev-title">${ev.recurrence && html`<${Icon} name="repeat" size=${11} />`}${ev.title || 'Sans titre'}${compact && html`<span class="ev-time-inline">${fmtTime(o.start, s.h12)}</span>`}</div>
                        ${!compact && html`<div class="ev-time">${fmtTime(o.start, s.h12)} – ${fmtTime(o.end, s.h12)}</div>`}
                        ${!compact && height > 64 && ev.location && html`<div class="ev-loc">${ev.location}</div>`}
                        <div class="ev-resize" onMouseDown=${e => startDrag(e, 'resize', o, seg)}></div>
                      </div>`
                  })}
                  ${ghost && ghost.di === di && html`
                    <div class="ev ghost" style=${{ '--c': ghost.color, top: ghost.s / 60 * hh + 'px', height: Math.max((ghost.e - ghost.s) / 60 * hh, 20) - 2 + 'px', left: '1px', width: 'calc(100% - 4px)' }}>
                      <div class="ev-title">${ghost.title}</div><div class="ev-time">${fmtGhost(ghost)}</div>
                    </div>`}
                  ${!ghost && draftGhost && draftGhost.di === di && html`
                    <div class="ev ghost draft" style=${{ '--c': draftGhost.color, top: draftGhost.s / 60 * hh + 'px', height: Math.max((draftGhost.e - draftGhost.s) / 60 * hh, 20) - 2 + 'px', left: '1px', width: 'calc(100% - 4px)' }}>
                      <div class="ev-title">${draftGhost.title}</div><div class="ev-time">${fmtGhost(draftGhost)}</div>
                    </div>`}
                  ${today && html`<div class="now-line" style=${{ top: nowMin / 60 * hh + 'px' }}><span class="now-dot"></span></div>`}
                </div>`
            })}
          </div>
          ${days.some(x => sameDay(x, now)) && html`<div class="now-label" style=${{ top: nowMin / 60 * hh + 'px' }}>${fmtTime(now, s.h12)}</div>`}
        </div>
      </div>
    </div>`
}

// ─── Vue mois ───────────────────────────────────────────────────────────────

function MonthView() {
  const d = useDb()
  const u = useUi()
  const s = d.settings
  const cells = monthMatrix(u.date, s.weekStart)
  const from = cells[0], to = addDays(cells[41], 1)
  const occ = useOccurrences(from, to)
  const tasks = s.showTasksInCalendar ? tasksByDay(d.tasks) : new Map()
  const ref = useRef()
  const [perCell, setPerCell] = useState(4)
  const [dropDay, setDropDay] = useState(null)
  const today = new Date()

  useLayoutEffect(() => {
    const el = ref.current
    const ro = new ResizeObserver(() => {
      const rowH = el.clientHeight / 6
      setPerCell(Math.max(1, Math.floor((rowH - 30) / 21)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const byDay = useMemo(() => {
    const map = new Map()
    for (const o of occ) {
      const last = o.ev.allDay ? addDays(o.end, -1) : new Date(Math.max(o.start.getTime(), o.end.getTime() - 1))
      for (let x = startOfDay(o.start); x <= last && x < to; x = addDays(x, 1)) {
        if (x < from) continue
        const k = ymd(x)
        if (!map.has(k)) map.set(k, [])
        map.get(k).push(o)
      }
    }
    for (const list of map.values()) list.sort((a, b) => (isAllDayLike(b) - isAllDayLike(a)) || a.start - b.start)
    return map
  }, [occ])

  const onDrop = (e, day) => {
    e.preventDefault()
    setDropDay(null)
    const key = e.dataTransfer.getData('text/zr-occ')
    const o = occ.find(x => x.key === key)
    if (!o) return
    const delta = diffDays(o.start, day) * DAY
    if (delta) shiftOccurrence(o, delta, delta)
  }

  const order = weekdayOrder(s.weekStart)
  return html`
    <div class="month">
      <div class="month-head">
        ${s.showWeekNumbers && html`<div class="month-wk-head"></div>`}
        ${order.map(w => html`<div class="month-dow">${cap(WEEKDAYS_SHORT[w].replace('.', ''))}</div>`)}
      </div>
      <div class=${cx('month-grid', s.showWeekNumbers && 'with-wk')} ref=${ref}>
        ${Array.from({ length: 6 }, (_, r) => html`
          ${s.showWeekNumbers && html`<button class="month-wk" onClick=${() => setUi({ view: 'week', date: cells[r * 7] })}>${isoWeek(addDays(cells[r * 7], 3 - ((cells[r * 7].getDay() + 6) % 7)))}</button>`}
          ${cells.slice(r * 7, r * 7 + 7).map(day => {
            const k = ymd(day)
            const list = byDay.get(k) || []
            const tlist = tasks.get(k) || []
            const total = list.length + tlist.length
            const shown = total > perCell ? perCell - 1 : perCell
            const hol = s.showHolidays && holidayOf(day)
            const isToday = sameDay(day, today)
            return html`
              <div class=${cx('mcell', day.getMonth() !== u.date.getMonth() && 'out', isToday && 'today', [0, 6].includes(day.getDay()) && 'weekend', dropDay === k && 'drop')}
                onDblClick=${e => { if (e.target === e.currentTarget || e.target.classList.contains('mcell-head')) { const st = new Date(day); st.setHours(9); createAt(st) } }}
                onDragOver=${e => { e.preventDefault(); setDropDay(k) }} onDragLeave=${() => setDropDay(null)} onDrop=${e => onDrop(e, day)}>
                <div class="mcell-head">
                  <button class="mcell-num" onClick=${() => setUi({ view: 'day', date: day })}>${day.getDate() === 1 ? day.getDate() + ' ' + MONTHS_SHORT[day.getMonth()] : day.getDate()}</button>
                  ${hol && html`<span class="mcell-hol" title=${hol}>${hol}</span>`}
                </div>
                ${list.slice(0, shown).map(o => {
                  const ad = isAllDayLike(o)
                  const cont = ad && !sameDay(o.start, day)
                  return html`<div key=${o.key} draggable="true" class=${cx('mchip', ad && 'allday', cont && 'cont', o.end < today && 'past')}
                    style=${{ '--c': calColor(o.ev.calendarId) }}
                    onDragStart=${e => { e.dataTransfer.setData('text/zr-occ', o.key); e.dataTransfer.effectAllowed = 'move' }}
                    onClick=${e => openOccurrence(o, e.currentTarget)} onContextMenu=${e => openContextMenu(e, o)}>
                    ${!ad && html`<span class="dot"></span><span class="mchip-time">${fmtTime(o.start, s.h12)}</span>`}
                    <span class="mchip-title">${o.ev.title || 'Sans titre'}</span>
                  </div>`
                })}
                ${tlist.slice(0, Math.max(0, shown - list.length)).map(t => html`
                  <div class=${cx('mchip', 'task', t.done && 'done')} onClick=${() => setUi({ section: 'tasks', selectedTask: t.id })}>
                    <${Checkbox} checked=${t.done} round size=${12} onChange=${() => toggleTask(t.id)} label="Terminer" />
                    <span class="mchip-title">${t.title}</span>
                  </div>`)}
                ${total > shown && html`<button class="mmore" onClick=${e => setUi({ popover: { kind: 'day-list', rect: e.currentTarget.getBoundingClientRect(), payload: { day, list, tasks: tlist } } })}>
                  ${total - shown} de plus</button>`}
              </div>`
          })}`)}
      </div>
    </div>`
}

// ─── Vue année ──────────────────────────────────────────────────────────────

function YearView() {
  const d = useDb()
  const u = useUi()
  const s = d.settings
  const y = u.date.getFullYear()
  const from = new Date(y, 0, 1), to = new Date(y + 1, 0, 1)
  const occ = useOccurrences(from, to)
  const today = new Date()
  const counts = useMemo(() => {
    const m = new Map()
    for (const o of occ) {
      const last = o.ev.allDay ? addDays(o.end, -1) : o.start
      for (let x = startOfDay(o.start); x <= last; x = addDays(x, 1)) m.set(ymd(x), (m.get(ymd(x)) || 0) + 1)
    }
    return m
  }, [occ])
  const order = weekdayOrder(s.weekStart)
  return html`
    <div class="year">
      ${Array.from({ length: 12 }, (_, m) => {
        const first = new Date(y, m, 1)
        const cells = monthMatrix(first, s.weekStart)
        return html`
          <div class="ymonth">
            <button class="ymonth-title" onClick=${() => setUi({ view: 'month', date: first })}>${cap(MONTHS[m])}</button>
            <div class="ygrid">
              ${order.map(w => html`<span class="ydow">${WEEKDAYS_LETTER[w]}</span>`)}
              ${cells.map(day => {
                if (day.getMonth() !== m) return html`<span class="yday out"></span>`
                const c = counts.get(ymd(day)) || 0
                const lvl = c === 0 ? 0 : c === 1 ? 1 : c <= 3 ? 2 : 3
                const hol = s.showHolidays && holidayOf(day)
                return html`<button class=${cx('yday', 'l' + lvl, sameDay(day, today) && 'today', hol && 'hol')}
                  title=${fmtDayLong(day) + (c ? ' · ' + c + ' événement' + (c > 1 ? 's' : '') : '') + (hol ? ' · ' + hol : '')}
                  onClick=${() => setUi({ view: 'day', date: day })}>${day.getDate()}</button>`
              })}
            </div>
          </div>`
      })}
    </div>`
}

// ─── Vue liste ──────────────────────────────────────────────────────────────

function ListView() {
  const d = useDb()
  const u = useUi()
  const s = d.settings
  const [span, setSpan] = useState(60)
  const from = u.date, to = addDays(u.date, span)
  const occ = useOccurrences(from, to)
  const groups = useMemo(() => {
    const map = new Map()
    for (const o of occ) {
      const last = o.ev.allDay ? addDays(o.end, -1) : new Date(Math.max(o.start.getTime(), o.end.getTime() - 1))
      for (let x = startOfDay(o.start); x <= last && x < to; x = addDays(x, 1)) {
        if (x < from) continue
        const k = ymd(x)
        if (!map.has(k)) map.set(k, [])
        map.get(k).push(o)
      }
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [occ])
  const now = new Date()
  if (!groups.length) return html`<div class="list-empty">
    <div class="empty"><div class="empty-icon"><${Icon} name="calendar" size=${22} /></div>
    <div class="empty-title">Rien de prévu</div><div class="empty-text">Aucun événement dans les ${span} prochains jours.</div>
    <button class="btn btn-secondary" onClick=${() => createAt(addMinutes(startOfDay(now), 9 * 60))}>Planifier un événement</button></div></div>`
  return html`
    <div class="agenda-list">
      ${groups.map(([k, list]) => {
        const day = parse(k)
        return html`
          <div class="agenda-day" key=${k}>
            <div class=${cx('agenda-date', sameDay(day, now) && 'today')}>
              <span class="ad-num">${day.getDate()}</span>
              <span class="ad-meta"><span>${cap(WEEKDAYS_SHORT[day.getDay()].replace('.', ''))}</span><span>${MONTHS_SHORT[day.getMonth()]}</span></span>
            </div>
            <div class="agenda-items">
              ${list.map(o => html`
                <button key=${o.key} class=${cx('agenda-item', o.end < now && 'past')} style=${{ '--c': calColor(o.ev.calendarId) }}
                  onClick=${e => openOccurrence(o, e.currentTarget)} onContextMenu=${e => openContextMenu(e, o)}>
                  <span class="ai-time">${isAllDayLike(o) ? 'Journée' : fmtTime(o.start, s.h12) + ' – ' + fmtTime(o.end, s.h12)}</span>
                  <span class="ai-bar"></span>
                  <span class="ai-title">${o.ev.title || 'Sans titre'}</span>
                  ${o.ev.recurrence && html`<${Icon} name="repeat" size=${13} class="muted" />`}
                  ${o.ev.location && html`<span class="ai-loc"><${Icon} name="mapPin" size=${13} />${o.ev.location}</span>`}
                </button>`)}
            </div>
          </div>`
      })}
      <div class="agenda-more"><button class="btn btn-ghost" onClick=${() => setSpan(span + 60)}>Afficher les 60 jours suivants</button></div>
    </div>`
}

// ─── Mini calendrier (barre latérale) ───────────────────────────────────────

export function MiniCalendar() {
  const d = useDb()
  const u = useUi()
  const s = d.settings
  const [month, setMonth] = useState(startOfMonth(u.date))
  useEffect(() => { setMonth(startOfMonth(u.date)) }, [u.date.getFullYear(), u.date.getMonth()])
  const cells = monthMatrix(month, s.weekStart)
  const occ = useOccurrences(cells[0], addDays(cells[41], 1))
  const busy = useMemo(() => new Set(occ.map(o => ymd(o.start))), [occ])
  const today = new Date()
  const weekSel = u.section === 'calendar' && u.view === 'week' ? weekDays(u.date, s) : null
  const order = weekdayOrder(s.weekStart)
  return html`
    <div class="mini-cal">
      <div class="mini-head">
        <span class="mini-title">${fmtMonthYear(month)}</span>
        <div class="mini-nav">
          <${IconButton} icon="chevronLeft" size=${14} label="Mois précédent" onClick=${() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} />
          <${IconButton} icon="chevronRight" size=${14} label="Mois suivant" onClick=${() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} />
        </div>
      </div>
      <div class="mini-grid">
        ${order.map(w => html`<span class="mini-dow">${WEEKDAYS_LETTER[w]}</span>`)}
        ${cells.map(day => {
          const inWeek = weekSel && weekSel.some(x => sameDay(x, day))
          const sel = u.section === 'calendar' && u.view === 'day' && sameDay(day, u.date)
          return html`<button class=${cx('mini-day', day.getMonth() !== month.getMonth() && 'out', sameDay(day, today) && 'today', inWeek && 'in-week', sel && 'selected', busy.has(ymd(day)) && 'busy')}
            onClick=${() => setUi({ section: 'calendar', date: day, view: u.view === 'year' || u.view === 'list' ? 'day' : u.view })}>${day.getDate()}</button>`
        })}
      </div>
    </div>`
}

// ─── Popovers ───────────────────────────────────────────────────────────────

export function CalendarPopovers() {
  const u = useUi()
  const p = u.popover
  if (!p) return null
  const close = () => setUi({ popover: null })
  if (p.kind === 'event') return html`<${Floating} anchor=${p.rect} onClose=${close} placement="right" width=${340}><${EventCard} o=${p.payload} /><//>`
  if (p.kind === 'event-menu') {
    const o = p.payload
    const items = [
      { label: 'Modifier', icon: 'edit', onClick: () => editOccurrence(o) },
      { label: 'Dupliquer', icon: 'copy', onClick: () => duplicateEvent(o) },
      '-',
      ...db().calendars.map(c => ({ label: c.name, color: c.color, checked: c.id === o.ev.calendarId, onClick: () => updateEvent(o.ev.id, { calendarId: c.id }) })),
      '-',
      { label: 'Supprimer', icon: 'trash', danger: true, onClick: () => deleteOccurrence(o) }
    ]
    return html`<${Floating} anchor=${p.rect} onClose=${close} width=${220}><${Menu} items=${items} onClose=${close} /><//>`
  }
  if (p.kind === 'day-list') {
    const { day, list, tasks } = p.payload
    const s = db().settings
    return html`<${Floating} anchor=${p.rect} onClose=${close} width=${280}>
      <div class="daylist">
        <div class="daylist-title">${cap(fmtDayLong(day))}</div>
        ${list.map(o => html`<button class="mchip wide" style=${{ '--c': calColor(o.ev.calendarId) }}
          onClick=${e => openOccurrence(o, e.currentTarget)}>
          <span class="dot"></span><span class="mchip-time">${isAllDayLike(o) ? 'Journée' : fmtTime(o.start, s.h12)}</span><span class="mchip-title">${o.ev.title || 'Sans titre'}</span></button>`)}
        ${tasks.map(t => html`<div class=${cx('mchip', 'task', 'wide', t.done && 'done')}>
          <${Checkbox} checked=${t.done} round size=${12} onChange=${() => toggleTask(t.id)} label="Terminer" /><span class="mchip-title">${t.title}</span></div>`)}
      </div><//>`
  }
  return null
}

function EventCard({ o }) {
  const d = db()
  const s = d.settings
  const ev = o.ev
  const cal = d.calendars.find(c => c.id === ev.calendarId)
  const now = new Date()
  const remLabel = m => m === 0 ? "À l'heure de début" : m < 60 ? m + ' min avant' : m < 1440 ? (m / 60) + ' h avant' : (m / 1440) + ' j avant'
  let status = null
  if (o.start <= now && o.end > now) status = 'En cours'
  else if (o.start > now && o.start - now < DAY) {
    const min = Math.round((o.start - now) / MINUTE)
    status = min < 60 ? 'Dans ' + min + ' min' : 'Dans ' + Math.floor(min / 60) + ' h ' + pad(min % 60)
  }
  const url = (ev.description || '').match(/https?:\/\/\S+/)
  return html`
    <div class="evcard" style=${{ '--c': cal?.color }}>
      <div class="evcard-actions">
        <${IconButton} icon="edit" label="Modifier" onClick=${() => editOccurrence(o)} />
        <${IconButton} icon="copy" label="Dupliquer" onClick=${() => duplicateEvent(o)} />
        <${IconButton} icon="trash" label="Supprimer" onClick=${() => deleteOccurrence(o)} />
        <${IconButton} icon="x" label="Fermer" onClick=${() => setUi({ popover: null })} />
      </div>
      <div class="evcard-head">
        <span class="evcard-swatch"></span>
        <div>
          <div class="evcard-title">${ev.title || 'Sans titre'}</div>
          <div class="evcard-when">${cap(fmtDayLong(o.start))}<br/>${fmtRange(o.start, o.end, ev.allDay, s.h12)}
            ${!ev.allDay && html`<span class="muted"> · ${fmtDuration(Math.round((o.end - o.start) / MINUTE))}</span>`}</div>
          ${status && html`<span class="badge">${status}</span>`}
        </div>
      </div>
      <div class="evcard-rows">
        ${ev.recurrence && html`<div class="evcard-row"><${Icon} name="repeat" size=${15} />${describeRecurrence(ev.recurrence, parse(ev.start))}</div>`}
        ${ev.location && html`<div class="evcard-row"><${Icon} name="mapPin" size=${15} />
          <a href=${'https://www.google.com/maps/search/' + encodeURIComponent(ev.location)} target="_blank">${ev.location}</a></div>`}
        ${(ev.reminders || []).length > 0 && html`<div class="evcard-row"><${Icon} name="bell" size=${15} />${ev.reminders.slice().sort((a, b) => a - b).map(remLabel).join(', ')}</div>`}
        <div class="evcard-row"><${Icon} name="calendar" size=${15} />${cal ? cal.name : 'Sans agenda'}</div>
        ${ev.description && html`<div class="evcard-row desc"><${Icon} name="text" size=${15} /><div>${ev.description}</div></div>`}
        ${url && html`<div class="evcard-row"><${Icon} name="externalLink" size=${15} /><a href=${url[0]} target="_blank">Ouvrir le lien</a></div>`}
      </div>
    </div>`
}

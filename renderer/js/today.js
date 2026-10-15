// Accueil : répond d'un coup d'œil à quatre questions, puis déroule la journée dans l'ordre chronologique.

import { html, useState, useEffect, useMemo } from './lib.js'
import {
  addDays, startOfDay, sameDay, fmtTime, fmtDayLong, fmtRelativeDay, fmtDuration, fmtIn, isoWeek, cap, holidayOf, MINUTE, ymd, parse, hm,
  wallTimeIn, tzOffsetMinutes, fmtOffset
} from './dates.js'
import { Icon } from './icons.js'
import { Empty, Checkbox, cx } from './ui.js'
import { useDb, useUi, setUi, addNote, toggleTask, setHabitCount } from './store.js'
import { useOccurrences, calColor, openOccurrence, createAt } from './calendar.js'
import { TaskRow, TaskQuickAdd, PRIORITIES } from './tasks.js'
import { stripHtml } from './notes.js'
import { FocusCard } from './focus.js'
import { buildDay, timeLeft, urgentItems, goalsOverview } from './core/plan.js'
import { streaks, weekProgress } from './core/habits.js'
import { describe, forecastFor } from './core/weather.js'
import { KIND_META, Bar, DataStatus, CatTag } from './widgets.js'
import { useWeather } from './weather-client.js'

function greeting(h) {
  if (h < 5) return 'Bonne nuit'
  if (h < 12) return 'Bonjour'
  if (h < 18) return 'Bon après-midi'
  return 'Bonsoir'
}

const minLabel = m => m <= 0 ? '0 min' : fmtDuration(Math.round(m))

export function TodaySection() {
  const d = useDb()
  const u = useUi()
  const s = d.settings
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t) }, [])
  const minute = Math.floor(now / MINUTE)
  const today = startOfDay(now)

  const plan = useMemo(() => buildDay(d, now, now), [d, minute])
  const tl = useMemo(() => timeLeft(d, now, plan), [plan])
  const urgent = useMemo(() => urgentItems(d, now), [d, minute])
  const goals = useMemo(() => goalsOverview(d, now), [d, minute])

  const hol = s.showHolidays && holidayOf(now)
  const name = s.userName ? ', ' + s.userName.split(' ')[0] : ''
  const weather = useWeather(s.homeLocation)
  const wToday = forecastFor(weather.entry, ymd(now))

  return html`
    <section class="section today-section">
      <div class="today-scroll">
        <header class="today-hero">
          <div>
            <div class="hero-date">${cap(fmtDayLong(now))} · Semaine ${isoWeek(now)}${hol ? ' · ' + hol : ''}</div>
            <h1 class="hero-title">${greeting(now.getHours())}${name}.</h1>
          </div>
          ${s.weatherEnabled && s.homeLocation && html`<div class="hero-weather">
            ${weather.entry?.data && html`<div class="hw-main">
              <${Icon} name=${describe(weather.entry.data.current?.code ?? wToday?.code).icon} size=${26} />
              <div><div class="hw-temp">${weather.entry.data.current ? Math.round(weather.entry.data.current.temp) + '°' : '—'}</div>
                <div class="hw-sub">${describe(weather.entry.data.current?.code ?? wToday?.code).label}${wToday ? ' · ' + Math.round(wToday.min) + '° / ' + Math.round(wToday.max) + '°' : ''}${wToday?.rain != null ? ' · pluie ' + wToday.rain + ' %' : ''}</div></div>
            </div>`}
            <div class="hw-place"><${Icon} name="mapPin" size=${12} />${s.homeLocation.name}</div>
            <${DataStatus} status=${weather.status} onRefresh=${weather.refresh} />
          </div>`}
        </header>

        <div class="questions">
          <${TodoCard} plan=${plan} now=${now} d=${d} />
          <${UrgentCard} urgent=${urgent} missed=${u.missed} now=${now} />
          <${TimeCard} tl=${tl} plan=${plan} now=${now} s=${s} />
          <${GoalsCard} goals=${goals} plan=${plan} d=${d} />
        </div>

        <div class="today-grid">
          <${Chronology} plan=${plan} now=${now} d=${d} tl=${tl} />
          <div class="today-side">
            <div class="card">
              <div class="card-head">
                <h2>Tâches du jour</h2>
                <button class="btn btn-ghost sm" onClick=${() => setUi({ section: 'tasks' })}>Toutes<${Icon} name="arrowRight" size=${14} /></button>
              </div>
              <${TaskQuickAdd} placeholder="Ajouter une tâche pour aujourd'hui" defaultDue=${ymd(today)} />
              <${DueTasks} d=${d} now=${now} />
            </div>
            <${HabitsToday} d=${d} now=${now} />
            <div class="card"><div class="card-head"><h2>Concentration</h2></div><${FocusCard} /></div>
          </div>
          <${Upcoming} now=${now} s=${s} />
          <${RecentNotes} d=${d} />
        </div>
      </div>
    </section>`
}

// ─── Les quatre questions ────────────────────────────────────────────────────

function TodoCard({ plan, now, d }) {
  const events = plan.timed.filter(x => x.kind === 'event' && x.end > now).length + plan.allDay.length
  const tasks = plan.untimed.filter(x => x.kind === 'task').length + plan.timed.filter(x => x.kind === 'task').length
  const habits = [...plan.timed, ...plan.untimed].filter(x => x.kind === 'habit' && x.pending).length
  const routines = [...plan.timed, ...plan.untimed].filter(x => x.kind === 'routine' && !(x.progress && x.progress.complete)).length
  const total = events + tasks + habits + routines
  const rows = [
    ['event', events, 'calendar', { section: 'calendar', view: 'day', date: startOfDay(now) }],
    ['task', tasks, 'tasks', { section: 'tasks' }],
    ['habit', habits, 'habits', { section: 'habits', habitsTab: 'habits' }],
    ['routine', routines, 'habits', { section: 'habits', habitsTab: 'routines' }]
  ]
  return html`<div class="card q-card">
    <div class="q-label">Que dois-je faire aujourd'hui ?</div>
    <div class="q-value">${total}<span>${total > 1 ? ' éléments restants' : ' élément restant'}</span></div>
    <div class="q-rows">
      ${rows.map(([k, n, , go]) => html`<button class=${cx('q-row', n === 0 && 'zero')} onClick=${() => setUi(go)}>
        <${Icon} name=${KIND_META[k].icon} size=${14} /><span>${KIND_META[k].label}${n > 1 ? 's' : ''}</span><b>${n}</b></button>`)}
    </div>
  </div>`
}

function openUrgent(it) {
  if (it.kind === 'task') setUi({ section: 'tasks', selectedTask: it.ref.id })
  else if (it.kind === 'conflict') setUi({ section: 'calendar', view: 'day', date: startOfDay(it.at) })
  else if (it.kind === 'goal') setUi({ section: 'goals' })
  else if (it.kind === 'leg') setUi({ section: 'trips', selectedTrip: it.ref.trip.id })
}

function UrgentCard({ urgent, missed, now }) {
  const n = urgent.length
  return html`<div class=${cx('card q-card', n > 0 && 'q-alert')}>
    <div class="q-label">Qu'est-ce qui est urgent ?</div>
    <div class="q-value">${n}<span>${n === 0 ? ' rien d\'urgent' : n > 1 ? ' points à traiter' : ' point à traiter'}</span></div>
    <div class="q-list">
      ${urgent.slice(0, 4).map(it => html`<button class=${'urgent-item lv-' + it.level} onClick=${() => openUrgent(it)}>
        <${Icon} name=${it.kind === 'conflict' ? 'alert' : it.kind === 'goal' ? 'target' : it.kind === 'leg' ? 'plane' : 'flag'} size=${13} />
        <span class="ui-title">${it.title}</span><span class="ui-detail">${it.detail}</span></button>`)}
      ${n > 4 && html`<div class="q-more">+ ${n - 4} autre${n - 4 > 1 ? 's' : ''}</div>`}
      ${n === 0 && html`<div class="q-calm">Aucune tâche en retard, aucun conflit, aucune échéance proche.</div>`}
    </div>
    ${missed.length > 0 && html`<div class="missed">
      <div class="missed-head"><${Icon} name="bell" size=${13} /><span>${missed.length} rappel${missed.length > 1 ? 's' : ''} manqué${missed.length > 1 ? 's' : ''}</span>
        <button class="link-btn" onClick=${() => setUi({ missed: [] })}>Tout effacer</button></div>
      ${missed.slice(-3).reverse().map(a => html`<div class="missed-item"><span class="mono">${sameDay(a.at, now) ? hm(a.at) : fmtRelativeDay(a.at, now) + ' ' + hm(a.at)}</span><span>${a.title}</span>${a.quiet && html`<span class="muted">heures calmes</span>`}</div>`)}
    </div>`}
  </div>`
}

function TimeCard({ tl, plan, now, s }) {
  const next = plan.timed.find(x => ['event', 'leg', 'routine'].includes(x.kind) && x.start > now)
  const current = plan.timed.find(x => ['event', 'leg', 'routine'].includes(x.kind) && x.start <= now && x.end > now)
  const span = tl.dayEnd - tl.dayStart
  const elapsedPct = tl.elapsed * 100
  const busyPct = Math.min(100 - elapsedPct, tl.busy * MINUTE / span * 100)
  const after = now >= tl.dayEnd
  return html`<div class="card q-card">
    <div class="q-label">Combien de temps me reste‑t‑il ?</div>
    <div class="q-value">${after ? 'Journée terminée' : minLabel(tl.free)}${!after && html`<span> libres d'ici ${fmtTime(tl.dayEnd, s.h12)}</span>`}</div>
    <div class="daybar" title="Écoulé · planifié · libre">
      <span class="db-elapsed" style=${{ width: elapsedPct + '%' }}></span>
      <span class="db-busy" style=${{ width: busyPct + '%' }}></span>
    </div>
    <div class="daybar-legend"><span><i class="lg-elapsed"></i>Écoulé</span><span><i class="lg-busy"></i>Planifié ${minLabel(tl.busy)}</span><span><i class="lg-free"></i>Libre</span></div>
    <div class="q-facts">
      <div><span>Tâches estimées</span><b>${minLabel(tl.taskLoad)}</b>${tl.unestimated > 0 && html`<small>+ ${tl.unestimated} sans estimation</small>`}</div>
      ${current ? html`<div><span>En cours</span><b>${current.title}</b><small>jusqu'à ${fmtTime(current.end, s.h12)}</small></div>`
        : next ? html`<div><span>Prochain</span><b>${next.title}</b><small>${fmtTime(next.start, s.h12)} · ${fmtIn(next.start - now)}</small></div>`
        : html`<div><span>Prochain</span><b>—</b><small>plus rien de planifié</small></div>`}
    </div>
    ${tl.overbooked && !after && html`<div class="q-warn"><${Icon} name="alert" size=${13} />Les tâches estimées dépassent le temps libre de ${minLabel(tl.taskLoad - tl.free)}.</div>`}
  </div>`
}

function GoalsCard({ goals, plan, d }) {
  const habits = [...plan.timed, ...plan.untimed].filter(x => x.kind === 'habit')
  const habitsDone = habits.filter(x => !x.pending).length
  const shown = goals.filter(x => x.g.period === 'day' || x.g.period === 'week').slice(0, 4)
  const byPeriod = k => goals.filter(x => x.g.period === k)
  const day = byPeriod('day'), week = byPeriod('week')
  return html`<div class="card q-card">
    <div class="q-label">Où en suis-je de mes objectifs ?</div>
    <div class="q-value">${day.filter(x => x.p.done).length}/${day.length}<span> objectifs du jour</span></div>
    <div class="q-sub">${week.filter(x => x.p.done).length}/${week.length} cette semaine · ${habitsDone}/${habits.length} habitude${habits.length > 1 ? 's' : ''} aujourd'hui</div>
    <div class="q-goals">
      ${shown.map(({ g, p }) => html`<button class="q-goal" onClick=${() => setUi({ section: 'goals' })}>
        <span class="qg-title">${g.title}</span><span class="qg-val">${Math.round(p.value)}/${p.target}${g.unit ? ' ' + g.unit : ''}</span>
        <${Bar} ratio=${p.ratio} tone=${p.done ? 'ok' : null} label=${g.title} /></button>`)}
      ${goals.length === 0 && html`<button class="q-calm link" onClick=${() => setUi({ section: 'goals' })}>Définir un premier objectif →</button>`}
    </div>
  </div>`
}

// ─── Chronologie ─────────────────────────────────────────────────────────────

const FILTER_KEY = 'zr-chrono-hidden'
const loadHidden = () => { try { return new Set(JSON.parse(localStorage.getItem(FILTER_KEY) || '[]')) } catch { return new Set() } }

function Chronology({ plan, now, d, tl }) {
  const s = d.settings
  const [hidden, setHidden] = useState(loadHidden)
  const toggle = k => {
    const n = new Set(hidden); n.has(k) ? n.delete(k) : n.add(k); setHidden(n)
    try { localStorage.setItem(FILTER_KEY, JSON.stringify([...n])) } catch {}
  }
  const present = new Set([...plan.timed, ...plan.untimed, ...plan.allDay].map(x => x.kind))
  const timed = plan.timed.filter(x => !hidden.has(x.kind))
  const untimed = plan.untimed.filter(x => !hidden.has(x.kind))

  // Insère « maintenant » et les créneaux libres (≥ 30 min, dans la journée active, à venir)
  const rows = []
  let cursor = new Date(Math.max(now, tl.dayStart)); cursor.setSeconds(0, 0)
  let nowPlaced = now < tl.dayStart || now >= tl.dayEnd
  const blocks = plan.timed.filter(x => ['event', 'leg', 'routine'].includes(x.kind))
  const freeBefore = t => {
    const busyUntil = blocks.filter(b => b.start <= cursor && b.end > cursor).reduce((m, b) => Math.max(m, b.end), 0)
    if (busyUntil) cursor = new Date(busyUntil)
    const end = new Date(Math.min(t, tl.dayEnd))
    if (end - cursor >= 30 * MINUTE && cursor >= now) rows.push({ type: 'free', a: new Date(cursor), b: end })
  }
  for (const it of timed) {
    if (!nowPlaced && it.start > now) { rows.push({ type: 'now' }); nowPlaced = true }
    if (it.start > cursor && it.start > now) freeBefore(it.start)
    rows.push({ type: 'item', it })
    if (['event', 'leg', 'routine'].includes(it.kind) && it.end > cursor) cursor = new Date(it.end)
  }
  if (!nowPlaced) rows.push({ type: 'now' })
  if (cursor < tl.dayEnd) freeBefore(tl.dayEnd)

  return html`<div class="card chrono-card">
    <div class="card-head">
      <h2>Chronologie du jour</h2>
      <button class="btn btn-ghost sm" onClick=${() => setUi({ section: 'calendar', view: 'day', date: startOfDay(now) })}>Vue jour<${Icon} name="arrowRight" size=${14} /></button>
    </div>
    <div class="kind-filters" role="group" aria-label="Types affichés">
      ${Object.entries(KIND_META).filter(([k]) => present.has(k)).map(([k, m]) => html`
        <button class=${cx('kind-filter k-' + k, hidden.has(k) && 'off')} aria-pressed=${!hidden.has(k)} onClick=${() => toggle(k)}>
          <${Icon} name=${m.icon} size=${12} />${m.label}</button>`)}
    </div>

    ${plan.allDay.length > 0 && !hidden.has('event') && html`<div class="allday-list">
      ${plan.allDay.map(x => html`<button class="allday-pill" style=${{ '--c': calColor(x.ref.ev.calendarId) }} onClick=${e => openOccurrence(x.ref, e.currentTarget)}>${x.title}</button>`)}
    </div>`}

    ${untimed.length > 0 && html`<div class="chrono-untimed">
      <div class="chrono-sub">Sans horaire</div>
      ${untimed.map(it => html`<${ChronoRow} key=${it.key} it=${it} now=${now} d=${d} conflicts=${plan.conflicts} />`)}
    </div>`}

    ${timed.length === 0 && untimed.length === 0 && plan.allDay.length === 0 ? html`<${Empty} icon="sun" title="Journée libre"
      text="Rien n'est planifié. Bloquez du temps pour ce qui compte."
      action=${html`<button class="btn btn-secondary" onClick=${() => { const x = new Date(now); x.setMinutes(0, 0, 0); x.setHours(x.getHours() + 1); createAt(x) }}>Planifier</button>`} />` : html`
    <div class="chrono">
      ${rows.map(r => r.type === 'now' ? html`<div class="chrono-now"><span>${fmtTime(now, s.h12)}</span><i></i>Maintenant</div>`
        : r.type === 'free' ? html`<button class="tl-free" onClick=${() => createAt(r.a, Math.min(60, Math.round((r.b - r.a) / MINUTE)))}>
            <span class="tl-time">${fmtTime(r.a, s.h12)}</span>
            <span class="tl-free-label">Créneau libre · ${fmtDuration(Math.round((r.b - r.a) / MINUTE))}</span>
            <span class="tl-free-add"><${Icon} name="plus" size=${13} />Planifier</span></button>`
        : html`<${ChronoRow} key=${r.it.key} it=${r.it} now=${now} d=${d} conflicts=${plan.conflicts} timed />`)}
    </div>`}
  </div>`
}

function ChronoRow({ it, now, d, conflicts, timed }) {
  const s = d.settings
  const past = timed && (it.end > it.start ? it.end <= now : it.start < now)
  const live = timed && it.start <= now && it.end > now
  const conflict = conflicts.has(it.key)
  const time = timed ? html`<span class="tl-time">${fmtTime(it.start, s.h12)}${it.end > it.start && html`<small>${fmtTime(it.end, s.h12)}</small>`}</span>` : html`<span class="tl-time muted">—</span>`
  const cls = cx('cr', 'k-' + it.kind, past && 'past', live && 'now', conflict && 'conflict')

  if (it.kind === 'event') {
    const o = it.ref
    return html`<button class=${cls} style=${{ '--c': calColor(o.ev.calendarId) }} onClick=${e => openOccurrence(o, e.currentTarget)}>
      ${time}<span class="cr-mark"></span>
      <span class="cr-body"><span class="cr-title">${it.title}</span>
        <span class="cr-meta"><span class="cr-kind"><${Icon} name="calendar" size=${11} />Rendez-vous</span>${fmtDuration(Math.round((it.end - it.start) / MINUTE))}${o.ev.location ? ' · ' + o.ev.location : ''}</span></span>
      ${conflict && html`<span class="badge danger" title="Chevauche un autre élément"><${Icon} name="alert" size=${11} />Conflit</span>`}
      ${live && html`<span class="badge live">En cours</span>`}
    </button>`
  }
  if (it.kind === 'task') {
    const t = it.ref
    return html`<div class=${cls} onClick=${() => setUi({ section: 'tasks', selectedTask: t.id })}>
      ${time}<span class="cr-mark"><${Checkbox} checked=${false} size=${15} color=${t.priority ? PRIORITIES[t.priority].color : undefined} onChange=${() => toggleTask(t.id)} label="Terminer la tâche" /></span>
      <span class="cr-body"><span class="cr-title">${it.title}</span>
        <span class="cr-meta"><span class="cr-kind"><${Icon} name="tasks" size=${11} />Tâche</span>${it.overdue ? html`<span class="danger-text">En retard · ${fmtRelativeDay(parse(t.due), now)}</span>` : timed ? 'Échéance ' + t.dueTime : "Aujourd'hui"}${t.estimate ? ' · ' + fmtDuration(t.estimate) : ''}</span></span>
      <${CatTag} id=${t.categoryId} />
      ${t.priority > 0 && html`<span class="prio" style=${{ color: PRIORITIES[t.priority].color }}><${Icon} name="flag" size=${13} /></span>`}
    </div>`
  }
  if (it.kind === 'habit') {
    const h = it.ref
    const st = streaks(d.habitLogs, h, now, s.weekStart)
    const weekly = (h.schedule || {}).type === 'weekly'
    const wp = weekly && weekProgress(d.habitLogs, h, now, s.weekStart)
    return html`<div class=${cx(cls, !it.pending && 'done')}>
      ${time}<span class="cr-mark"><button class=${cx('habit-hit', !it.pending && 'on')} aria-label=${'Pointer ' + h.name}
        onClick=${() => setHabitCount(h.id, now, it.count >= it.target ? 0 : it.count + 1)}>${it.target > 1 ? it.count : !it.pending ? html`<${Icon} name="check" size=${12} stroke=${2.5} />` : ''}</button></span>
      <span class="cr-body"><span class="cr-title">${it.title}</span>
        <span class="cr-meta"><span class="cr-kind"><${Icon} name="repeat" size=${11} />Habitude</span>${it.target > 1 ? it.count + '/' + it.target + (h.unit ? ' ' + h.unit : '') : weekly ? wp.done + '/' + wp.target + ' cette semaine' : it.pending ? 'À faire' : 'Fait'}</span></span>
      ${st.current > 0 && html`<span class="streak" title=${'Série : ' + st.current + ' ' + st.unit + (st.current > 1 ? 's' : '')}><${Icon} name="flame" size=${13} />${st.current}</span>`}
    </div>`
  }
  if (it.kind === 'routine') {
    const p = it.progress
    return html`<button class=${cx(cls, p && p.complete && 'done')} onClick=${() => setUi({ section: 'habits', habitsTab: 'routines' })}>
      ${time}<span class="cr-mark"><${Icon} name="listCheck" size=${15} /></span>
      <span class="cr-body"><span class="cr-title">${it.title}</span>
        <span class="cr-meta"><span class="cr-kind"><${Icon} name="listCheck" size=${11} />Routine</span>${p ? p.done + '/' + p.total + ' étapes' : ''}</span></span>
      ${conflict && html`<span class="badge danger"><${Icon} name="alert" size=${11} />Conflit</span>`}
    </button>`
  }
  if (it.kind === 'reminder') {
    return html`<div class=${cls}>
      ${time}<span class="cr-mark"><${Icon} name=${it.ref.alarm ? 'alarm' : 'bell'} size=${14} /></span>
      <span class="cr-body"><span class="cr-title">${it.title}</span>
        <span class="cr-meta"><span class="cr-kind"><${Icon} name="bell" size=${11} />${it.ref.alarm ? 'Alarme' : 'Rappel'}</span></span></span>
    </div>`
  }
  if (it.kind === 'leg') {
    const l = it.ref
    const tzInfo = (tz, at) => tz ? wallTimeIn(at, tz).slice(11) + ' ' + fmtOffset(tzOffsetMinutes(at, tz)) : ''
    return html`<button class=${cls} onClick=${() => setUi({ section: 'trips', selectedTrip: l.trip.id })}>
      ${time}<span class="cr-mark"><${Icon} name=${l.leg.mode === 'train' ? 'train' : l.leg.mode === 'car' ? 'car' : 'plane'} size=${15} /></span>
      <span class="cr-body"><span class="cr-title">${it.title}</span>
        <span class="cr-meta"><span class="cr-kind"><${Icon} name="plane" size=${11} />Déplacement</span>${l.trip.title}${l.leg.arriveTz ? ' · arrivée ' + tzInfo(l.leg.arriveTz, l.end) + ' (heure locale)' : ''}</span></span>
      ${conflict && html`<span class="badge danger"><${Icon} name="alert" size=${11} />Conflit</span>`}
    </button>`
  }
  return null
}

// ─── Colonne latérale ────────────────────────────────────────────────────────

function DueTasks({ d, now }) {
  const key = ymd(now)
  const due = d.tasks.filter(t => !t.done && t.due && t.due <= key)
    .sort((a, b) => a.due.localeCompare(b.due) || b.priority - a.priority || (a.dueTime || '99').localeCompare(b.dueTime || '99'))
  if (!due.length) return html`<div class="card-empty">Aucune tâche due aujourd'hui.</div>`
  return html`<div class="task-stack">${due.slice(0, 8).map(t => html`<${TaskRow} key=${t.id} t=${t} compact />`)}</div>
    ${due.length > 8 && html`<button class="link-more" onClick=${() => setUi({ section: 'tasks' })}>+ ${due.length - 8} autres</button>`}`
}

function HabitsToday({ d, now }) {
  const list = buildDay(d, now, now)
  const habits = [...list.timed, ...list.untimed].filter(x => x.kind === 'habit')
  return html`<div class="card">
    <div class="card-head"><h2>Habitudes du jour</h2>
      <button class="btn btn-ghost sm" onClick=${() => setUi({ section: 'habits' })}>Gérer<${Icon} name="arrowRight" size=${14} /></button></div>
    ${habits.length === 0 ? html`<div class="card-empty">Aucune habitude prévue aujourd'hui.</div>` : html`<div class="habit-today">
      ${habits.map(it => html`<${ChronoRow} key=${it.key} it=${it} now=${now} d=${d} conflicts=${new Set()} />`)}
    </div>`}
  </div>`
}

function Upcoming({ now, s }) {
  const today = startOfDay(now)
  const occ = useOccurrences(addDays(today, 1), addDays(today, 8))
  const groups = []
  for (const o of occ) {
    const k = ymd(o.start)
    let g = groups.find(x => x.k === k)
    if (!g) { g = { k, day: startOfDay(o.start), items: [] }; groups.push(g) }
    g.items.push(o)
  }
  return html`<div class="card">
    <div class="card-head"><h2>Les 7 prochains jours</h2></div>
    ${groups.length === 0 ? html`<div class="card-empty">Rien de prévu cette semaine.</div>` : html`
      <div class="upcoming">
        ${groups.slice(0, 6).map(g => html`
          <div class="up-day">
            <button class="up-date" onClick=${() => setUi({ section: 'calendar', view: 'day', date: g.day })}>${fmtRelativeDay(g.day, now)}</button>
            ${g.items.slice(0, 4).map(o => html`
              <button class="up-item" style=${{ '--c': calColor(o.ev.calendarId) }} onClick=${e => openOccurrence(o, e.currentTarget)}>
                <span class="dot"></span>
                <span class="up-time">${o.ev.allDay ? 'Journée' : fmtTime(o.start, s.h12)}</span>
                <span class="up-title">${o.ev.title || 'Sans titre'}</span>
              </button>`)}
            ${g.items.length > 4 && html`<span class="up-more">+ ${g.items.length - 4} autres</span>`}
          </div>`)}
      </div>`}
  </div>`
}

function RecentNotes({ d }) {
  const notes = d.notes.slice().sort((a, b) => (b.pinned - a.pinned) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4)
  return html`<div class="card">
    <div class="card-head">
      <h2>Notes</h2>
      <button class="btn btn-ghost sm" onClick=${() => { const n = addNote({}); setUi({ section: 'notes', selectedNote: n.id }) }}><${Icon} name="plus" size=${14} />Nouvelle</button>
    </div>
    ${notes.length === 0 ? html`<div class="card-empty">Vos notes récentes apparaîtront ici.</div>` : html`
      <div class="note-tiles">
        ${notes.map(n => html`<button class="note-tile" onClick=${() => setUi({ section: 'notes', selectedNote: n.id })}>
          <span class="nt-title">${n.pinned && html`<${Icon} name="pin" size=${12} />`}${n.title || 'Sans titre'}</span>
          <span class="nt-preview">${stripHtml(n.content).slice(0, 140) || 'Aucun contenu'}</span>
        </button>`)}
      </div>`}
  </div>`
}

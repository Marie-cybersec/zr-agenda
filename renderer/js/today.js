import { html, useState, useEffect } from './lib.js'
import {
  addDays, startOfDay, sameDay, fmtTime, fmtDayLong, fmtRelativeDay, fmtDuration, fmtIn, isoWeek, cap, holidayOf, MINUTE, DAY, ymd, parse, diffDays
} from './dates.js'
import { Icon } from './icons.js'
import { Empty, cx } from './ui.js'
import { useDb, setUi, addNote } from './store.js'
import { useOccurrences, calColor, openOccurrence, createAt } from './calendar.js'
import { TaskRow, TaskQuickAdd } from './tasks.js'
import { stripHtml } from './notes.js'
import { FocusCard } from './focus.js'

function greeting(h) {
  if (h < 5) return 'Bonne nuit'
  if (h < 12) return 'Bonjour'
  if (h < 18) return 'Bon après-midi'
  return 'Bonsoir'
}

export function TodaySection() {
  const d = useDb()
  const s = d.settings
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t) }, [])
  const today = startOfDay(now)
  const occ = useOccurrences(today, addDays(today, 8))
  const todays = occ.filter(o => o.start < addDays(today, 1) && o.end > today)
  const timed = todays.filter(o => !o.ev.allDay && o.end - o.start < DAY)
  const allDay = todays.filter(o => o.ev.allDay || o.end - o.start >= DAY)
  const next = timed.find(o => o.start > now)
  const current = timed.filter(o => o.start <= now && o.end > now)
  const upcoming = occ.filter(o => o.start >= addDays(today, 1))

  const openTasks = d.tasks.filter(t => !t.done)
  const dueTasks = openTasks.filter(t => t.due && diffDays(now, parse(t.due)) <= 0)
    .sort((a, b) => a.due.localeCompare(b.due) || b.priority - a.priority)
  const doneToday = d.tasks.filter(t => t.done && t.doneAt && sameDay(new Date(t.doneAt), now)).length

  const busyMin = timed.reduce((sum, o) => sum + (Math.min(o.end, addDays(today, 1)) - Math.max(o.start, today)) / MINUTE, 0)

  // Créneaux libres pendant les heures de travail
  const free = []
  const ws = new Date(today); ws.setHours(s.workStart, 0, 0, 0)
  const we = new Date(today); we.setHours(s.workEnd, 0, 0, 0)
  let cursor = new Date(Math.max(ws, now))
  cursor.setSeconds(0, 0)
  for (const o of timed.slice().sort((a, b) => a.start - b.start)) {
    if (o.end <= cursor) continue
    if (o.start > cursor && o.start - cursor >= 30 * MINUTE && cursor < we) free.push([new Date(cursor), new Date(Math.min(o.start, we))])
    if (o.end > cursor) cursor = new Date(o.end)
  }
  if (we - cursor >= 30 * MINUTE) free.push([new Date(cursor), we])

  // Programme : événements + créneaux libres, triés
  const agenda = [
    ...timed.map(o => ({ type: 'ev', t: o.start, o })),
    ...free.map(([a, b]) => ({ type: 'free', t: a, a, b }))
  ].sort((x, y) => x.t - y.t)

  const notes = d.notes.slice().sort((a, b) => (b.pinned - a.pinned) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4)
  const hol = s.showHolidays && holidayOf(now)
  const name = s.userName ? ', ' + s.userName.split(' ')[0] : ''

  const upcomingByDay = []
  for (const o of upcoming) {
    const k = ymd(o.start)
    let g = upcomingByDay.find(x => x.k === k)
    if (!g) { g = { k, day: startOfDay(o.start), items: [] }; upcomingByDay.push(g) }
    g.items.push(o)
  }

  return html`
    <section class="section today-section">
      <div class="today-scroll">
        <header class="today-hero">
          <div>
            <div class="hero-date">${cap(fmtDayLong(now))} · Semaine ${isoWeek(now)}${hol ? ' · ' + hol : ''}</div>
            <h1 class="hero-title">${greeting(now.getHours())}${name}.</h1>
            <p class="hero-sub">
              ${timed.length === 0 && allDay.length === 0 ? 'Aucun événement aujourd\'hui.' :
                (timed.length + allDay.length) + ' événement' + (timed.length + allDay.length > 1 ? 's' : '') + ' aujourd\'hui'}
              ${busyMin > 0 ? ' · ' + fmtDuration(Math.round(busyMin)) + ' planifiées' : ''}
              ${dueTasks.length ? ' · ' + dueTasks.length + ' tâche' + (dueTasks.length > 1 ? 's' : '') + ' à traiter' : ''}
            </p>
          </div>
          <div class="hero-stats">
            <div class="stat"><span class="stat-value">${current.length ? 'En cours' : next ? fmtTime(next.start, s.h12) : '—'}</span>
              <span class="stat-label">${current.length ? current[0].ev.title : next ? 'Prochain · ' + fmtIn(next.start - now) : 'Plus rien aujourd\'hui'}</span></div>
            <div class="stat"><span class="stat-value">${doneToday}</span><span class="stat-label">Tâche${doneToday > 1 ? 's' : ''} terminée${doneToday > 1 ? 's' : ''}</span></div>
            <div class="stat"><span class="stat-value">${openTasks.length}</span><span class="stat-label">Tâches ouvertes</span></div>
          </div>
        </header>

        <div class="today-grid">
          <div class="card schedule-card">
            <div class="card-head">
              <h2>Programme du jour</h2>
              <button class="btn btn-ghost sm" onClick=${() => setUi({ section: 'calendar', view: 'day', date: today })}>Vue jour<${Icon} name="arrowRight" size=${14} /></button>
            </div>
            ${allDay.length > 0 && html`<div class="allday-list">
              ${allDay.map(o => html`<button class="allday-pill" style=${{ '--c': calColor(o.ev.calendarId) }} onClick=${e => openOccurrence(o, e.currentTarget)}>${o.ev.title}</button>`)}
            </div>`}
            ${agenda.length === 0 && allDay.length === 0 && html`<${Empty} icon="sun" title="Journée libre"
              text="Rien n'est planifié. Bloquez du temps pour ce qui compte."
              action=${html`<button class="btn btn-secondary" onClick=${() => { const x = new Date(now); x.setMinutes(0, 0, 0); x.setHours(x.getHours() + 1); createAt(x) }}>Planifier</button>`} />`}
            <div class="timeline">
              ${agenda.map(item => {
                if (item.type === 'free') return html`
                  <button class="tl-free" onClick=${() => createAt(item.a, Math.min(60, Math.round((item.b - item.a) / MINUTE)))}>
                    <span class="tl-time">${fmtTime(item.a, s.h12)}</span>
                    <span class="tl-free-label">Créneau libre · ${fmtDuration(Math.round((item.b - item.a) / MINUTE))}</span>
                    <span class="tl-free-add"><${Icon} name="plus" size=${13} />Planifier</span>
                  </button>`
                const o = item.o
                const state = o.end <= now ? 'past' : o.start <= now ? 'now' : next === o ? 'next' : ''
                return html`
                  <button class=${cx('tl-item', state)} style=${{ '--c': calColor(o.ev.calendarId) }} onClick=${e => openOccurrence(o, e.currentTarget)}>
                    <span class="tl-time">${fmtTime(o.start, s.h12)}<small>${fmtTime(o.end, s.h12)}</small></span>
                    <span class="tl-bar"></span>
                    <span class="tl-body">
                      <span class="tl-title">${o.ev.title || 'Sans titre'}</span>
                      <span class="tl-meta">${fmtDuration(Math.round((o.end - o.start) / MINUTE))}${o.ev.location ? ' · ' + o.ev.location : ''}</span>
                    </span>
                    ${state === 'now' && html`<span class="badge live">En cours</span>`}
                    ${state === 'next' && html`<span class="badge">${fmtIn(o.start - now)}</span>`}
                  </button>`
              })}
            </div>
          </div>

          <div class="today-side">
            <div class="card">
              <div class="card-head">
                <h2>À traiter</h2>
                <button class="btn btn-ghost sm" onClick=${() => setUi({ section: 'tasks' })}>Toutes<${Icon} name="arrowRight" size=${14} /></button>
              </div>
              <${TaskQuickAdd} placeholder="Ajouter une tâche pour aujourd'hui" defaultDue=${ymd(today)} />
              ${dueTasks.length === 0 ? html`<div class="card-empty">Aucune tâche due aujourd'hui.</div>` :
                html`<div class="task-stack">${dueTasks.slice(0, 8).map(t => html`<${TaskRow} key=${t.id} t=${t} compact />`)}</div>`}
              ${dueTasks.length > 8 && html`<button class="link-more" onClick=${() => setUi({ section: 'tasks' })}>+ ${dueTasks.length - 8} autres</button>`}
            </div>

            <div class="card"><div class="card-head"><h2>Concentration</h2></div><${FocusCard} /></div>
          </div>

          <div class="card">
            <div class="card-head"><h2>Les 7 prochains jours</h2></div>
            ${upcomingByDay.length === 0 ? html`<div class="card-empty">Rien de prévu cette semaine.</div>` : html`
              <div class="upcoming">
                ${upcomingByDay.slice(0, 6).map(g => html`
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
          </div>

          <div class="card">
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
          </div>
        </div>
      </div>
    </section>`
}

import { html, useState, useMemo } from './lib.js'
import {
  addDays, startOfDay, startOfWeek, startOfMonth, daysInMonth, MINUTE, DAY, fmtDuration, fmtMonthYear, fmtDayShort, ymd,
  WEEKDAYS_SHORT, cap, isoWeek, MONTHS_SHORT
} from './dates.js'
import { Icon } from './icons.js'
import { Segmented, IconButton, Empty, cx } from './ui.js'
import { useDb } from './store.js'
import { useOccurrences } from './calendar.js'
import { completionRate } from './core/habits.js'
import { MOODS } from './journal.js'

const hoursLabel = min => min >= 60 ? (Math.round(min / 6) / 10).toLocaleString('fr-FR') + ' h' : Math.round(min) + ' min'

export function InsightsSection() {
  const d = useDb()
  const [range, setRange] = useState('week')
  const [anchor, setAnchor] = useState(startOfDay(new Date()))
  const from = range === 'week' ? startOfWeek(anchor, d.settings.weekStart) : startOfMonth(anchor)
  const len = range === 'week' ? 7 : daysInMonth(from.getFullYear(), from.getMonth())
  const to = addDays(from, len)
  const occ = useOccurrences(from, to)
  const prevOcc = useOccurrences(range === 'week' ? addDays(from, -7) : new Date(from.getFullYear(), from.getMonth() - 1, 1), from)

  const stats = useMemo(() => {
    const days = Array.from({ length: len }, (_, i) => ({ day: addDays(from, i), min: 0, count: 0, done: 0 }))
    const byCal = new Map()
    let total = 0
    for (const o of occ) {
      if (o.ev.allDay || o.end - o.start >= DAY) continue
      const a = Math.max(o.start, from), b = Math.min(o.end, to)
      const min = (b - a) / MINUTE
      if (min <= 0) continue
      total += min
      byCal.set(o.ev.calendarId, (byCal.get(o.ev.calendarId) || 0) + min)
      const i = Math.floor((startOfDay(new Date(a)) - from) / DAY)
      if (days[i]) { days[i].min += min; days[i].count++ }
    }
    let prevTotal = 0
    for (const o of prevOcc) if (!o.ev.allDay && o.end - o.start < DAY) prevTotal += (o.end - o.start) / MINUTE
    let done = 0
    for (const t of d.tasks) {
      if (!t.done || !t.doneAt) continue
      const dt = new Date(t.doneAt)
      if (dt >= from && dt < to) { done++; const i = Math.floor((startOfDay(dt) - from) / DAY); if (days[i]) days[i].done++ }
    }
    const created = d.tasks.filter(t => new Date(t.createdAt) >= from && new Date(t.createdAt) < to).length
    const cals = d.calendars.map(c => ({ ...c, min: byCal.get(c.id) || 0 })).filter(c => c.min > 0).sort((a, b) => b.min - a.min)
    const busiest = days.reduce((m, x) => x.min > m.min ? x : m, days[0])

    // Ponctualité : tâches terminées avec échéance, terminées au plus tard le jour prévu
    const withDue = d.tasks.filter(t => t.done && t.doneAt && t.due && new Date(t.doneAt) >= from && new Date(t.doneAt) < to)
    const onTime = withDue.filter(t => ymd(new Date(t.doneAt)) <= t.due).length
    const last = new Date(Math.min(Date.now(), to - 1))
    const habits = d.habits.filter(h => !h.archived).map(h => ({ h, rate: completionRate(d.habitLogs, h, from, last, d.settings.weekStart) })).filter(x => x.rate != null)
    const focus = d.focusLog.filter(f => new Date(f.at) >= from && new Date(f.at) < to)
    const focusByCat = new Map()
    for (const f of focus) focusByCat.set(f.categoryId || '', (focusByCat.get(f.categoryId || '') || 0) + f.minutes)
    const moods = d.journal.filter(e => e.mood && e.date >= ymd(from) && e.date < ymd(to)).map(e => e.mood)
    return {
      days, total, prevTotal, done, created, cals, busiest, events: occ.length,
      onTime: withDue.length ? onTime / withDue.length : null, withDue: withDue.length,
      habits: habits.sort((a, b) => b.rate - a.rate), focusTotal: focus.reduce((a, f) => a + f.minutes, 0),
      focusCats: [...focusByCat].map(([id, min]) => ({ cat: d.categories.find(c => c.id === id), min })).sort((a, b) => b.min - a.min),
      mood: moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : null, moodCount: moods.length
    }
  }, [occ, prevOcc, d.tasks, d.calendars, d.habits, d.habitLogs, d.focusLog, d.journal])

  const step = dir => setAnchor(range === 'week' ? addDays(anchor, 7 * dir) : new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1))
  const title = range === 'week'
    ? 'Semaine ' + isoWeek(addDays(from, 3)) + ' · ' + from.getDate() + ' ' + MONTHS_SHORT[from.getMonth()] + ' – ' + addDays(to, -1).getDate() + ' ' + MONTHS_SHORT[addDays(to, -1).getMonth()]
    : fmtMonthYear(from)
  const delta = stats.prevTotal ? Math.round((stats.total - stats.prevTotal) / stats.prevTotal * 100) : null
  const workMin = (d.settings.workEnd - d.settings.workStart) * 60 * stats.days.filter(x => ![0, 6].includes(x.day.getDay())).length
  const load = workMin ? Math.round(stats.total / workMin * 100) : 0

  return html`
    <section class="section insights-section">
      <header class="toolbar">
        <div class="toolbar-left">
          <h1 class="toolbar-title">Analyse</h1>
          <div class="nav-arrows">
            <${IconButton} icon="chevronLeft" label="Période précédente" onClick=${() => step(-1)} />
            <${IconButton} icon="chevronRight" label="Période suivante" onClick=${() => step(1)} />
          </div>
          <span class="toolbar-subtitle">${title}</span>
        </div>
        <div class="toolbar-right">
          <${Segmented} value=${range} onChange=${v => { setRange(v); setAnchor(startOfDay(new Date())) }}
            options=${[{ value: 'week', label: 'Semaine' }, { value: 'month', label: 'Mois' }]} />
        </div>
      </header>
      <div class="insights-scroll">
        <div class="kpis">
          <div class="kpi">
            <span class="kpi-label">Temps planifié</span>
            <span class="kpi-value">${hoursLabel(stats.total)}</span>
            <span class="kpi-foot">${delta === null ? 'Aucune donnée sur la période précédente' : (delta >= 0 ? '+' : '') + delta + ' % par rapport à la période précédente'}</span>
          </div>
          <div class="kpi">
            <span class="kpi-label">Charge des heures ouvrées</span>
            <span class="kpi-value">${load} %</span>
            <div class="meter"><span style=${{ width: Math.min(100, load) + '%' }}></span></div>
          </div>
          <div class="kpi">
            <span class="kpi-label">Événements</span>
            <span class="kpi-value">${stats.events}</span>
            <span class="kpi-foot">${stats.busiest && stats.busiest.min > 0 ? 'Jour le plus chargé : ' + fmtDayShort(stats.busiest.day) : 'Aucun jour chargé'}</span>
          </div>
          <div class="kpi">
            <span class="kpi-label">Tâches terminées</span>
            <span class="kpi-value">${stats.done}</span>
            <span class="kpi-foot">${stats.created} créée${stats.created > 1 ? 's' : ''} sur la période</span>
          </div>
        </div>

        <div class="kpis">
          <div class="kpi">
            <span class="kpi-label">Tâches terminées à temps</span>
            <span class="kpi-value">${stats.onTime == null ? '—' : Math.round(stats.onTime * 100) + ' %'}</span>
            <span class="kpi-foot">${stats.withDue} tâche${stats.withDue > 1 ? 's' : ''} avec échéance terminée${stats.withDue > 1 ? 's' : ''}</span>
          </div>
          <div class="kpi">
            <span class="kpi-label">Habitudes réussies</span>
            <span class="kpi-value">${stats.habits.length ? Math.round(stats.habits.reduce((a, x) => a + x.rate, 0) / stats.habits.length * 100) + ' %' : '—'}</span>
            <span class="kpi-foot">${stats.habits.length ? 'Meilleure : ' + stats.habits[0].h.name : 'Aucune habitude suivie'}</span>
          </div>
          <div class="kpi">
            <span class="kpi-label">Concentration</span>
            <span class="kpi-value">${hoursLabel(stats.focusTotal)}</span>
            <span class="kpi-foot">${stats.focusCats.length ? stats.focusCats.slice(0, 2).map(x => (x.cat ? x.cat.name : 'Sans catégorie') + ' ' + hoursLabel(x.min)).join(' · ') : 'Aucune session terminée'}</span>
          </div>
          <div class="kpi">
            <span class="kpi-label">Humeur moyenne (journal)</span>
            <span class="kpi-value">${stats.mood == null ? '—' : MOODS[Math.round(stats.mood) - 1].label}</span>
            <span class="kpi-foot">${stats.moodCount ? stats.moodCount + ' entrée' + (stats.moodCount > 1 ? 's' : '') + ' notée' + (stats.moodCount > 1 ? 's' : '') + ' · ' + stats.mood.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + '/5' : 'Aucune humeur notée'}</span>
          </div>
        </div>

        <div class="charts">
          <div class="card chart-card wide">
            <div class="card-head"><h2>Temps planifié par jour</h2><span class="card-sub">Heures d'événements, hors journées entières</span></div>
            <${BarChart} data=${stats.days.map(x => ({
              label: range === 'week' ? cap(WEEKDAYS_SHORT[x.day.getDay()].replace('.', '')) + ' ' + x.day.getDate() : String(x.day.getDate()),
              value: x.min / 60,
              tip: cap(fmtDayShort(x.day)) + ' · ' + (x.min ? fmtDuration(Math.round(x.min)) : 'aucun événement') + (x.count ? ' · ' + x.count + ' événement' + (x.count > 1 ? 's' : '') : ''),
              weekend: [0, 6].includes(x.day.getDay())
            }))} unit="h" showEvery=${range === 'week' ? 1 : 3} />
          </div>

          <div class="card chart-card">
            <div class="card-head"><h2>Répartition par agenda</h2></div>
            ${stats.cals.length === 0 ? html`<${Empty} icon="chart" title="Pas encore de données" text="Les heures planifiées apparaîtront ici." />` : html`
              <div class="hbars">
                ${stats.cals.map(c => html`
                  <div class="hbar" title=${c.name + ' · ' + fmtDuration(Math.round(c.min))}>
                    <span class="hbar-label"><span class="dot" style=${{ background: c.color }}></span>${c.name}</span>
                    <span class="hbar-track"><span class="hbar-fill" style=${{ width: (c.min / stats.cals[0].min * 100) + '%', background: c.color }}></span></span>
                    <span class="hbar-value">${hoursLabel(c.min)}<small>${Math.round(c.min / stats.total * 100)} %</small></span>
                  </div>`)}
              </div>`}
          </div>

          <div class="card chart-card">
            <div class="card-head"><h2>Tâches terminées par jour</h2></div>
            <${BarChart} data=${stats.days.map(x => ({
              label: range === 'week' ? cap(WEEKDAYS_SHORT[x.day.getDay()].replace('.', '')) : String(x.day.getDate()),
              value: x.done,
              tip: cap(fmtDayShort(x.day)) + ' · ' + x.done + ' tâche' + (x.done > 1 ? 's' : '') + ' terminée' + (x.done > 1 ? 's' : ''),
              weekend: [0, 6].includes(x.day.getDay())
            }))} integer showEvery=${range === 'week' ? 1 : 5} height=${160} />
          </div>
        </div>
      </div>
    </section>`
}

// Histogramme vertical, une seule série, survol avec info-bulle.
function BarChart({ data, unit = '', integer, showEvery = 1, height = 220 }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(...data.map(x => x.value), 0)
  const niceMax = max <= 0 ? (integer ? 4 : 2) : integer ? Math.max(4, Math.ceil(max / 2) * 2) : Math.ceil(max / 2) * 2 || 2
  const ticks = Array.from({ length: 5 }, (_, i) => niceMax / 4 * i)
  return html`
    <div class="barchart" style=${{ height: height + 'px' }}>
      <div class="bc-grid">
        ${ticks.map(t => html`<div class="bc-tick" style=${{ bottom: (t / niceMax * 100) + '%' }}>
          <span>${integer ? Math.round(t) : (Math.round(t * 10) / 10).toLocaleString('fr-FR')}${t > 0 && unit ? ' ' + unit : ''}</span></div>`)}
      </div>
      <div class="bc-bars" style=${{ gridTemplateColumns: 'repeat(' + data.length + ', minmax(0, 1fr))' }}>
        ${data.map((x, i) => html`
          <div class=${cx('bc-col', hover === i && 'hover')} onMouseEnter=${() => setHover(i)} onMouseLeave=${() => setHover(null)}>
            <div class="bc-bar-wrap">
              <div class=${cx('bc-bar', x.weekend && 'weekend')} style=${{ height: (x.value / niceMax * 100) + '%' }}></div>
            </div>
            <span class="bc-label">${i % showEvery === 0 ? x.label : ''}</span>
            ${hover === i && html`<div class="bc-tip">${x.tip}</div>`}
          </div>`)}
      </div>
    </div>`
}

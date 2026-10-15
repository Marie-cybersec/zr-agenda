// Planification des déplacements : étapes avec fuseaux horaires, météo de destination, liste de bagages.

import { html, useState, useMemo } from './lib.js'
import { ymd, parse, addDays, toIso, fmtDayShort, fmtDuration, hm, cap, localTimeZone, isValidTimeZone, tzOffsetMinutes, fmtOffset, DAY } from './dates.js'
import { Icon } from './icons.js'
import { IconButton, AutoTextarea, Empty, Checkbox, cx } from './ui.js'
import { useDb, useUi, db, setUi, addItem, updateItem, removeItem, addEvent, withUndo, toast, uid } from './store.js'
import { MODES, legInstants, tripStatus } from './core/trips.js'
import { busyItems } from './core/plan.js'
import { describe, forecastFor, FORECAST_DAYS } from './core/weather.js'
import { Field, PlacePicker, DataStatus } from './widgets.js'
import { useWeather } from './weather-client.js'

const MODE_ICON = { train: 'train', plane: 'plane', bus: 'car', car: 'car', boat: 'route', other: 'route' }
const STATUS_LABEL = { ongoing: 'En cours', upcoming: 'À venir', past: 'Passés', draft: 'Sans dates' }

let zoneList = null
const zones = () => zoneList || (zoneList = (() => { try { return Intl.supportedValuesOf('timeZone') } catch { return [] } })())

export function TripsSection() {
  const d = useDb()
  const u = useUi()
  const now = new Date()
  const sel = d.trips.find(t => t.id === u.selectedTrip)
  const add = () => {
    const start = ymd(addDays(now, 7))
    const t = addItem('trips', { title: 'Nouveau déplacement', destination: null, start, end: start, legs: [], checklist: [], notes: '' }, true)
    setUi({ selectedTrip: t.id })
  }
  const groups = ['ongoing', 'upcoming', 'draft', 'past'].map(k => [k, d.trips.filter(t => tripStatus(t, now) === k)
    .sort((a, b) => k === 'past' ? (b.start || '').localeCompare(a.start || '') : (a.start || '').localeCompare(b.start || ''))]).filter(([, l]) => l.length)
  return html`<section class="section trips-section">
    <header class="toolbar">
      <div class="toolbar-left"><h1 class="toolbar-title">Déplacements</h1></div>
      <div class="toolbar-right"><button class="btn btn-primary sm" onClick=${add}><${Icon} name="plus" size=${14} />Nouveau déplacement</button></div>
    </header>
    <div class="split">
      <div class="split-main">
        ${d.trips.length === 0 && html`<${Empty} icon="plane" title="Aucun déplacement"
          text="Préparez un voyage, un stage ou un examen dans une autre ville : trajets avec fuseaux horaires, météo sur place, liste de bagages." />`}
        ${groups.map(([k, list]) => html`<div key=${k}>
          <div class="group-label">${STATUS_LABEL[k]}<span class="count">${list.length}</span></div>
          ${list.map(t => html`<button class=${cx('trip-item', u.selectedTrip === t.id && 'selected', k === 'past' && 'past')} key=${t.id} onClick=${() => setUi({ selectedTrip: t.id })}>
            <${Icon} name="plane" size=${16} />
            <span class="trip-body"><b>${t.title}</b>
              <small>${t.destination ? t.destination.name + ' · ' : ''}${t.start ? fmtDayShort(parse(t.start)) + (t.end && t.end !== t.start ? ' – ' + fmtDayShort(parse(t.end)) : '') : 'Dates à définir'}</small></span>
            <span class="muted">${(t.legs || []).length} trajet${(t.legs || []).length > 1 ? 's' : ''}</span>
          </button>`)}
        </div>`)}
      </div>
      ${sel ? html`<${TripDetail} key=${sel.id} t=${sel} />` : html`<aside class="split-side placeholder"><${Empty} icon="route" title="Aucun déplacement sélectionné" text="Choisissez un déplacement pour en préparer les détails." /></aside>`}
    </div>
  </section>`
}

function TripDetail({ t }) {
  const d = useDb()
  const set = patch => updateItem('trips', t.id, patch)
  const [item, setItem] = useState('')
  const legs = t.legs || []
  const checklist = t.checklist || []
  const setLeg = (id, patch) => set({ legs: legs.map(l => l.id === id ? { ...l, ...patch } : l) })
  const addLeg = () => {
    const prev = legs[legs.length - 1]
    const day = prev ? (prev.arrive || prev.depart || '').slice(0, 10) : t.start || ymd(new Date())
    const tz = prev ? prev.arriveTz || prev.departTz : localTimeZone()
    set({ legs: [...legs, { id: uid(), mode: 'train', from: prev ? prev.to : '', to: t.destination?.name || '', depart: day + 'T09:00', departTz: tz, arrive: day + 'T11:00', arriveTz: t.destination?.timezone || tz, ref: '' }] })
  }
  const done = checklist.filter(c => c.done).length
  return html`<aside class="split-side trip-detail">
    <div class="td-head">
      <input class="td-title" value=${t.title} placeholder="Nom du déplacement" onInput=${e => set({ title: e.target.value })} />
      <${IconButton} icon="trash" label="Supprimer" onClick=${() => { setUi({ selectedTrip: null }); withUndo('Déplacement supprimé', () => removeItem('trips', t.id)) }} />
      <${IconButton} icon="x" label="Fermer" onClick=${() => setUi({ selectedTrip: null })} />
    </div>
    <div class="form-grid">
      <${Field} label="Destination"><${PlacePicker} value=${t.destination} onChange=${v => set({ destination: v })} placeholder="Ville de destination" /><//>
      <div class="inline">
        <${Field} label="Du"><input type="date" class="input" value=${t.start || ''} onChange=${e => set({ start: e.target.value || null, end: t.end && t.end >= e.target.value ? t.end : e.target.value })} /><//>
        <${Field} label="Au"><input type="date" class="input" value=${t.end || ''} min=${t.start || ''} onChange=${e => set({ end: e.target.value || null })} /><//>
      </div>
    </div>

    <${TripWeather} t=${t} />

    <div class="side-title-sm">Trajets</div>
    ${legs.length === 0 && html`<div class="card-empty">Ajoutez les trajets : les heures se saisissent dans le fuseau local du départ et de l'arrivée.</div>`}
    ${legs.map(l => html`<${LegEditor} key=${l.id} l=${l} trip=${t} d=${d} onChange=${p => setLeg(l.id, p)} onRemove=${() => set({ legs: legs.filter(x => x.id !== l.id) })} />`)}
    <button class="btn btn-ghost sm add-row" onClick=${addLeg}><${Icon} name="plus" size=${14} />Ajouter un trajet</button>

    <div class="side-title-sm">À emporter ${checklist.length > 0 && html`<span class="count">${done}/${checklist.length}</span>`}</div>
    ${checklist.map(c => html`<div class=${cx('subtask', c.done && 'done')} key=${c.id}>
      <${Checkbox} checked=${c.done} size=${15} onChange=${v => set({ checklist: checklist.map(x => x.id === c.id ? { ...x, done: v } : x) })} label="Préparé" />
      <input value=${c.title} onInput=${e => set({ checklist: checklist.map(x => x.id === c.id ? { ...x, title: e.target.value } : x) })} />
      <button class="icon-btn sm" aria-label="Retirer" onClick=${() => set({ checklist: checklist.filter(x => x.id !== c.id) })}><${Icon} name="x" size=${13} /></button>
    </div>`)}
    <div class="subtask add"><${Icon} name="plus" size=${14} />
      <input placeholder="Passeport, chargeur, convocation…" value=${item} onInput=${e => setItem(e.target.value)}
        onKeyDown=${e => { if (e.key === 'Enter' && item.trim()) { set({ checklist: [...checklist, { id: uid(), title: item.trim(), done: false }] }); setItem('') } }} /></div>

    <div class="side-title-sm">Notes</div>
    <${AutoTextarea} class="input textarea" minRows=${3} placeholder="Adresse de l'hébergement, contacts, réservations…" value=${t.notes || ''} onInput=${v => set({ notes: v })} />
  </aside>`
}

function LegEditor({ l, trip, d, onChange, onRemove }) {
  const i = legInstants(l)
  const conflicts = useMemo(() => {
    if (!i || !i.valid || i.end <= i.start) return []
    return busyItems(d, i.start, i.end).filter(x => x.kind !== 'leg' && x.start < i.end && x.end > i.start)
  }, [d.events, d.routines, l.depart, l.arrive, l.departTz, l.arriveTz])
  const here = localTimeZone()
  const toAgenda = () => {
    if (!i) return
    const ev = addEvent({
      title: MODES[l.mode] + ' ' + (l.from || '') + ' → ' + (l.to || ''), calendarId: db().settings.defaultCalendarId || db().calendars[0]?.id,
      allDay: false, start: toIso(i.start), end: toIso(i.end > i.start ? i.end : new Date(+i.start + 3600000)),
      location: l.from || '', description: [trip.title, l.ref ? 'Réf. ' + l.ref : '', l.departTz && l.departTz !== here ? 'Départ ' + l.depart.slice(11) + ' heure locale (' + l.departTz + ')' : '', l.arriveTz && l.arriveTz !== here ? 'Arrivée ' + (l.arrive || '').slice(11) + ' heure locale (' + l.arriveTz + ')' : ''].filter(Boolean).join('\n'),
      recurrence: null, exdates: [], reminders: [Math.max(0, db().settings.tripReminder || 60)]
    })
    toast('Trajet ajouté à l\'agenda', { action: 'Voir', onAction: () => setUi({ section: 'calendar', view: 'day', date: parse(ev.start.slice(0, 10)) }) })
  }
  const tzField = (val, key) => html`<input class=${cx('input tz-input', val && !isValidTimeZone(val) && 'invalid')} list="zr-zones" placeholder="Fuseau" value=${val || ''}
    title="Fuseau horaire IANA, ex. Europe/Paris" onChange=${e => onChange({ [key]: e.target.value.trim() || null })} />`
  return html`<div class="card leg-card">
    <datalist id="zr-zones">${zones().map(z => html`<option value=${z} />`)}</datalist>
    <div class="leg-row">
      <select class="input select" value=${l.mode} onChange=${e => onChange({ mode: e.target.value })}>${Object.entries(MODES).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select>
      <input class="input" placeholder="Départ" value=${l.from} onInput=${e => onChange({ from: e.target.value })} />
      <${Icon} name="arrowRight" size=${14} />
      <input class="input" placeholder="Arrivée" value=${l.to} onInput=${e => onChange({ to: e.target.value })} />
      <${IconButton} icon="x" label="Retirer le trajet" onClick=${onRemove} />
    </div>
    <div class="leg-row">
      <span class="leg-lbl">Départ</span><input type="datetime-local" class="input" value=${l.depart || ''} onChange=${e => onChange({ depart: e.target.value || null })} />${tzField(l.departTz, 'departTz')}
    </div>
    <div class="leg-row">
      <span class="leg-lbl">Arrivée</span><input type="datetime-local" class="input" value=${l.arrive || ''} onChange=${e => onChange({ arrive: e.target.value || null })} />${tzField(l.arriveTz, 'arriveTz')}
    </div>
    <div class="leg-row">
      <span class="leg-lbl">Réf.</span><input class="input" placeholder="N° de train, vol, réservation" value=${l.ref || ''} onInput=${e => onChange({ ref: e.target.value })} />
    </div>
    ${i && html`<div class="leg-info">
      <${Icon} name=${MODE_ICON[l.mode]} size=${13} />
      ${i.valid ? html`<span>Durée réelle ${fmtDuration(i.minutes)}</span>` : html`<span class="danger-text">L'arrivée précède le départ (vérifiez les fuseaux)</span>`}
      ${(l.departTz && l.departTz !== here || l.arriveTz && l.arriveTz !== here) && html`<span class="muted">· Sur cet appareil (${fmtOffset(tzOffsetMinutes(i.start, here))}) : ${cap(fmtDayShort(i.start))} ${hm(i.start)} → ${hm(i.end)}${i.end - i.start > 0 && ymd(i.end) !== ymd(i.start) ? ' (+' + Math.round((parse(ymd(i.end)) - parse(ymd(i.start))) / DAY) + ' j)' : ''}</span>`}
    </div>`}
    ${conflicts.length > 0 && html`<div class="q-warn"><${Icon} name="alert" size=${13} />Conflit avec ${conflicts.map(c => c.title).join(', ')}</div>`}
    <div class="leg-actions"><button class="btn btn-ghost sm" disabled=${!i || !i.valid} onClick=${toAgenda}><${Icon} name="calendarPlus" size=${14} />Ajouter à l'agenda</button></div>
  </div>`
}

function TripWeather({ t }) {
  const d = useDb()
  const loc = t.destination && t.destination.lat != null ? t.destination : null
  const w = useWeather(loc)
  if (!t.destination) return null
  const days = []
  if (t.start) for (let x = parse(t.start); x <= parse(t.end || t.start) && days.length < 21; x = addDays(x, 1)) days.push(ymd(x))
  return html`<div class="trip-weather">
    <div class="side-title-sm">Météo à ${t.destination.name}
      ${!loc ? html`<span class="data-status s-off"><span class="ds-dot"></span><span class="ds-label">Lieu sans coordonnées · météo indisponible</span></span>`
        : html`<${DataStatus} status=${w.status} onRefresh=${w.refresh} />`}
    </div>
    ${!d.settings.weatherEnabled && html`<div class="field-hint">Activez la météo dans Paramètres › Général pour afficher les prévisions.</div>`}
    ${loc && w.entry?.data && html`<div class="wx-days">
      ${days.map(k => {
        const f = forecastFor(w.entry, k)
        return html`<div class=${cx('wx-day', !f && 'na')} title=${f ? describe(f.code).label : 'Prévision disponible ' + FORECAST_DAYS + ' jours avant'}>
          <span class="wx-date">${cap(fmtDayShort(parse(k)))}</span>
          ${f ? html`<${Icon} name=${describe(f.code).icon} size=${18} /><span class="wx-t">${Math.round(f.min)}° / ${Math.round(f.max)}°</span>${f.rain != null && html`<span class="wx-r">${f.rain} %</span>`}`
            : html`<span class="muted">—</span>`}
        </div>`
      })}
    </div>`}
  </div>`
}

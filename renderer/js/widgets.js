// Petits composants partagés par les nouvelles sections.

import { html, useState } from './lib.js'
import { Icon } from './icons.js'
import { cx } from './ui.js'
import { useDb } from './store.js'
import { describe } from './core/weather.js'
import { geocode } from './weather-client.js'

// Types d'éléments du planning : libellé + icône, jamais la couleur seule.
export const KIND_META = {
  event: { label: 'Rendez-vous', icon: 'calendar' },
  task: { label: 'Tâche', icon: 'tasks' },
  habit: { label: 'Habitude', icon: 'repeat' },
  routine: { label: 'Routine', icon: 'listCheck' },
  reminder: { label: 'Rappel', icon: 'bell' },
  leg: { label: 'Déplacement', icon: 'plane' }
}

export function KindTag({ kind }) {
  const m = KIND_META[kind]
  return html`<span class=${'kind-tag k-' + kind}><${Icon} name=${m.icon} size=${11} />${m.label}</span>`
}

export function CategorySelect({ value, onChange, none = 'Sans catégorie', class: cls = '' }) {
  const d = useDb()
  return html`<select class=${cx('input select', cls)} value=${value || ''} onChange=${e => onChange(e.target.value || null)}>
    <option value="">${none}</option>
    ${d.categories.map(c => html`<option value=${c.id}>${c.name}</option>`)}
  </select>`
}

export function CatTag({ id }) {
  const d = useDb()
  const c = d.categories.find(x => x.id === id)
  if (!c) return null
  return html`<span class="cat-tag" style=${{ '--c': c.color }}><span class="dot"></span>${c.name}</span>`
}

export function Bar({ ratio, tone, label }) {
  return html`<div class=${cx('bar', tone && 'bar-' + tone)} role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(ratio * 100)} aria-label=${label}>
    <span style=${{ width: Math.max(0, Math.min(100, ratio * 100)) + '%' }}></span></div>`
}

export function Field({ label, children, hint }) {
  return html`<label class="field"><span class="field-label">${label}</span>${children}${hint && html`<span class="field-hint">${hint}</span>`}</label>`
}

const STATE_TONE = { ok: 'ok', stale: 'warn', offline: 'off', error: 'bad', loading: 'off', off: 'off' }

// Pastille d'état des données externes (météo).
export function DataStatus({ status, onRefresh }) {
  return html`<span class=${'data-status s-' + STATE_TONE[status.state]} title=${status.label}>
    <span class="ds-dot"></span><span class="ds-label">${status.label}</span>
    ${onRefresh && status.state !== 'loading' && status.state !== 'off' && html`<button class="ds-refresh" aria-label="Actualiser la météo" onClick=${onRefresh}><${Icon} name="refresh" size=${12} /></button>`}
  </span>`
}

export function WeatherGlyph({ code, size = 16 }) {
  return html`<${Icon} name=${describe(code).icon} size=${size} />`
}

// Recherche d'un lieu (Open-Meteo). Hors ligne : saisie libre, sans coordonnées.
export function PlacePicker({ value, onChange, placeholder = 'Ville' }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const search = async () => {
    if (!q.trim()) return
    setBusy(true); setErr('')
    try { setRes(await geocode(q)) } catch (e) { setRes(null); setErr(e.message === 'offline' ? 'Hors ligne : lieu enregistré sans prévisions.' : 'Recherche indisponible (' + e.message + ').') }
    setBusy(false)
  }
  if (value && !res) return html`<div class="place-chosen">
    <${Icon} name="mapPin" size=${14} /><span>${value.name}${value.country ? ', ' + value.country : ''}</span>
    ${value.timezone && html`<span class="muted">${value.timezone}</span>`}
    <button class="btn btn-ghost sm" onClick=${() => { setQ(value.name); onChange(null) }}>Changer</button>
  </div>`
  return html`<div class="place-picker">
    <div class="inline">
      <input class="input" placeholder=${placeholder} value=${q} onInput=${e => setQ(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); search() } }} />
      <button class="btn btn-secondary sm" disabled=${busy || !q.trim()} onClick=${search}>${busy ? 'Recherche…' : 'Rechercher'}</button>
    </div>
    ${err && html`<div class="field-hint warn">${err} <button class="link-btn" onClick=${() => { onChange({ name: q.trim(), lat: null, lon: null, timezone: null }); setErr('') }}>Enregistrer « ${q.trim()} »</button></div>`}
    ${res && (res.length === 0 ? html`<div class="field-hint">Aucun lieu trouvé.</div>` : html`<div class="place-results">
      ${res.map(r => html`<button class="place-opt" onClick=${() => { onChange(r); setRes(null) }}>
        <${Icon} name="mapPin" size=${13} /><span>${r.name}</span><span class="muted">${[r.region, r.country].filter(Boolean).join(', ')}</span></button>`)}
    </div>`)}
  </div>`
}

export function Stepper({ value, onChange, min = 0, max = 999, step = 1 }) {
  return html`<div class="stepper">
    <button aria-label="Moins" onClick=${() => onChange(Math.max(min, (Number(value) || 0) - step))}><${Icon} name="minus" size=${13} /></button>
    <input class="input num" type="number" value=${value} min=${min} max=${max} onChange=${e => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))} />
    <button aria-label="Plus" onClick=${() => onChange(Math.min(max, (Number(value) || 0) + step))}><${Icon} name="plus" size=${13} /></button>
  </div>`
}

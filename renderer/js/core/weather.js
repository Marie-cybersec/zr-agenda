// Météo (Open-Meteo, sans clé). Les requêtes passent par le processus principal ;
// ce module décrit les adresses, interprète les réponses et calcule l'état de disponibilité.

import { MINUTE } from '../dates.js'

export const FRESH_MS = 3 * 60 * MINUTE
export const FORECAST_DAYS = 16

export function forecastUrl(lat, lon) {
  return 'https://api.open-meteo.com/v1/forecast?latitude=' + Number(lat).toFixed(4) + '&longitude=' + Number(lon).toFixed(4) +
    '&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&timezone=auto&forecast_days=' + FORECAST_DAYS
}

export function geocodeUrl(name) {
  return 'https://geocoding-api.open-meteo.com/v1/search?count=6&language=fr&format=json&name=' + encodeURIComponent(name.trim())
}

export function parseGeocode(json) {
  return ((json && json.results) || []).map(r => ({
    name: r.name, lat: r.latitude, lon: r.longitude, timezone: r.timezone || null,
    country: r.country || '', region: r.admin1 || ''
  }))
}

// Codes WMO → libellé et icône.
const WMO = [
  [[0], 'Ciel dégagé', 'sun'], [[1], 'Peu nuageux', 'cloudSun'], [[2], 'Partiellement nuageux', 'cloudSun'], [[3], 'Couvert', 'cloud'],
  [[45, 48], 'Brouillard', 'cloud'], [[51, 53, 55, 56, 57], 'Bruine', 'rain'], [[61, 63, 65, 66, 67], 'Pluie', 'rain'],
  [[71, 73, 75, 77], 'Neige', 'snow'], [[80, 81, 82], 'Averses', 'rain'], [[85, 86], 'Averses de neige', 'snow'], [[95, 96, 99], 'Orage', 'storm']
]
export function describe(code) {
  const w = WMO.find(([codes]) => codes.includes(Number(code)))
  return w ? { label: w[1], icon: w[2] } : { label: 'Inconnu', icon: 'cloud' }
}

export function parseForecast(json) {
  if (!json || !json.daily || !Array.isArray(json.daily.time)) throw new Error('Réponse météo invalide')
  const d = json.daily
  return {
    timezone: json.timezone || null,
    current: json.current ? { temp: json.current.temperature_2m, code: json.current.weather_code, wind: json.current.wind_speed_10m, time: json.current.time } : null,
    daily: d.time.map((date, i) => ({
      date, code: d.weather_code?.[i], max: d.temperature_2m_max?.[i], min: d.temperature_2m_min?.[i], rain: d.precipitation_probability_max?.[i] ?? null
    }))
  }
}

export const cacheKey = loc => loc ? Number(loc.lat).toFixed(2) + ',' + Number(loc.lon).toFixed(2) : null

// État affiché : off | loading | ok | stale | offline | error
// entry = { data, fetchedAt, error, errorAt } (cache), net = { online, loading }
export function weatherState(entry, now = Date.now(), net = {}) {
  if (!entry || (!entry.data && !entry.error)) {
    if (net.loading) return { state: 'loading', label: 'Chargement de la météo…' }
    if (net.online === false) return { state: 'offline', label: 'Hors ligne · aucune donnée météo' }
    return { state: 'off', label: 'Météo non chargée' }
  }
  const age = now - (entry.fetchedAt || 0)
  if (entry.data && age < FRESH_MS && !(entry.errorAt > entry.fetchedAt)) return { state: 'ok', label: 'À jour · ' + ago(age), age }
  if (entry.data) {
    const why = net.online === false ? 'Hors ligne' : entry.error ? 'Service indisponible' : 'Données anciennes'
    return { state: 'stale', label: why + ' · relevé ' + ago(age), age }
  }
  return { state: net.online === false ? 'offline' : 'error', label: net.online === false ? 'Hors ligne · aucune donnée météo' : 'Météo indisponible (' + entry.error + ')' }
}

function ago(ms) {
  const m = Math.round(ms / MINUTE)
  if (m < 1) return "à l'instant"
  if (m < 60) return 'il y a ' + m + ' min'
  const h = Math.round(m / 60)
  if (h < 48) return 'il y a ' + h + ' h'
  return 'il y a ' + Math.round(h / 24) + ' j'
}

// Prévision d'un jour donné ; null si hors de la plage couverte.
export function forecastFor(entry, ymdKey) {
  return (entry && entry.data && entry.data.daily.find(x => x.date === ymdKey)) || null
}

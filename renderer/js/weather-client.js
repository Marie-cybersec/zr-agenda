// Météo côté interface : cache chiffré dans la base, rafraîchissement, état de disponibilité.

import { useState, useEffect } from './lib.js'
import { db, useDb, useUi, setCache } from './store.js'
import { forecastUrl, geocodeUrl, parseForecast, parseGeocode, cacheKey, weatherState, FRESH_MS } from './core/weather.js'

const inflight = new Map()
const MAX_ENTRIES = 12

export function refreshWeather(loc, force = false) {
  const k = cacheKey(loc)
  if (!k || !window.zr?.getJson) return Promise.resolve()
  const entry = (db().cache.weather || {})[k]
  if (!force && entry?.fetchedAt && Date.now() - entry.fetchedAt < FRESH_MS && !(entry.errorAt > entry.fetchedAt)) return Promise.resolve()
  if (inflight.has(k)) return inflight.get(k)
  const p = (async () => {
    const r = await window.zr.getJson(forecastUrl(loc.lat, loc.lon))
    const cache = { ...(db().cache.weather || {}) }
    const prev = cache[k] || {}
    if (r.ok) {
      try { cache[k] = { data: parseForecast(r.data), fetchedAt: Date.now(), name: loc.name } } catch { cache[k] = { ...prev, error: 'réponse invalide', errorAt: Date.now() } }
    } else cache[k] = { ...prev, error: r.error, errorAt: Date.now() }
    const keys = Object.keys(cache).sort((a, b) => (cache[b].fetchedAt || 0) - (cache[a].fetchedAt || 0))
    for (const old of keys.slice(MAX_ENTRIES)) delete cache[old]
    setCache('weather', cache)
  })().finally(() => inflight.delete(k))
  inflight.set(k, p)
  return p
}

// État et données météo d'un lieu ; se met à jour au retour du réseau et toutes les 30 minutes.
export function useWeather(loc) {
  const d = useDb()
  const u = useUi()
  const k = cacheKey(loc)
  const enabled = !!d.settings.weatherEnabled
  const [loading, setLoading] = useState(false)
  const run = force => { setLoading(true); refreshWeather(loc, force).finally(() => setLoading(false)) }
  useEffect(() => {
    if (!k || !enabled) return
    run(false)
    const t = setInterval(() => run(false), 30 * 60000)
    return () => clearInterval(t)
  }, [k, enabled, u.online])
  const entry = k ? (d.cache.weather || {})[k] : null
  let status
  if (!enabled) status = { state: 'off', label: 'Météo désactivée' }
  else if (!k) status = { state: 'off', label: 'Aucun lieu défini' }
  else status = weatherState(entry, Date.now(), { online: u.online, loading })
  return { entry, status, loading, refresh: () => run(true) }
}

export async function geocode(name) {
  const r = await window.zr.getJson(geocodeUrl(name))
  if (!r.ok) throw new Error(r.error)
  return parseGeocode(r.data)
}

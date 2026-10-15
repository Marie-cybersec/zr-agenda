import { html, useState, useEffect, useRef, useMemo } from './lib.js'
import { parse, fmtDayShort, fmtTime, fmtRange, startOfDay, addDays, ymd, cap, fmtRelativeDay } from './dates.js'
import { Icon } from './icons.js'
import { Kbd, cx } from './ui.js'
import { useUi, db, setUi, addEvent, addTask, addNote, openEditor, toast, setSettings } from './store.js'
import { parseQuick, quickToEvent } from './nlp.js'
import { calColor, createAt, editOccurrence } from './calendar.js'
import { stripHtml } from './notes.js'

const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function score(text, q) {
  const t = norm(text)
  if (!q) return 1
  if (t.startsWith(q)) return 3
  if (t.includes(' ' + q)) return 2
  if (t.includes(q)) return 1
  return 0
}

export function commands() {
  const s = db().settings
  const go = patch => () => setUi({ palette: false, ...patch })
  return [
    { id: 'new-event', icon: 'calendarPlus', label: 'Nouvel événement', hint: 'C', run: () => { setUi({ palette: false }); const x = new Date(); x.setMinutes(0, 0, 0); x.setHours(x.getHours() + 1); createAt(x) } },
    { id: 'new-task', icon: 'tasks', label: 'Nouvelle tâche', hint: 'Ctrl+Maj+T', run: () => { const t = addTask({ title: 'Nouvelle tâche' }); setUi({ palette: false, section: 'tasks', selectedTask: t.id }) } },
    { id: 'new-note', icon: 'note', label: 'Nouvelle note', hint: 'Ctrl+N', run: () => { const n = addNote({}); setUi({ palette: false, section: 'notes', selectedNote: n.id }) } },
    { id: 'go-today', icon: 'sun', label: "Aller à « Aujourd'hui »", hint: 'Alt+1', run: go({ section: 'today' }) },
    { id: 'go-cal', icon: 'calendar', label: 'Aller au calendrier', hint: 'Alt+2', run: go({ section: 'calendar' }) },
    { id: 'go-tasks', icon: 'tasks', label: 'Aller aux tâches', hint: 'Alt+3', run: go({ section: 'tasks' }) },
    { id: 'go-notes', icon: 'note', label: 'Aller aux notes', hint: 'Alt+4', run: go({ section: 'notes' }) },
    { id: 'go-insights', icon: 'chart', label: "Aller à l'analyse", hint: 'Alt+5', run: go({ section: 'insights' }) },
    { id: 'date-today', icon: 'today', label: "Afficher aujourd'hui dans le calendrier", hint: 'T', run: go({ section: 'calendar', date: startOfDay(new Date()) }) },
    { id: 'view-day', icon: 'calendar', label: 'Vue jour', hint: 'J', run: go({ section: 'calendar', view: 'day' }) },
    { id: 'view-week', icon: 'calendar', label: 'Vue semaine', hint: 'S', run: go({ section: 'calendar', view: 'week' }) },
    { id: 'view-month', icon: 'calendar', label: 'Vue mois', hint: 'M', run: go({ section: 'calendar', view: 'month' }) },
    { id: 'view-year', icon: 'calendar', label: 'Vue année', hint: 'A', run: go({ section: 'calendar', view: 'year' }) },
    { id: 'view-list', icon: 'list', label: 'Vue liste', hint: 'L', run: go({ section: 'calendar', view: 'list' }) },
    { id: 'theme', icon: s.theme === 'dark' ? 'sun' : 'moon', label: s.theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre', run: () => { setSettings({ theme: currentTheme() === 'dark' ? 'light' : 'dark' }); setUi({ palette: false }) } },
    { id: 'weekends', icon: 'calendar', label: s.hideWeekends ? 'Afficher les week-ends' : 'Masquer les week-ends', run: () => { setSettings({ hideWeekends: !s.hideWeekends }); setUi({ palette: false }) } },
    { id: 'settings', icon: 'settings', label: 'Paramètres', hint: 'Ctrl+,', run: go({ settings: 'general' }) },
    { id: 'import', icon: 'upload', label: 'Importer un fichier .ics', run: go({ settings: 'data' }) },
    { id: 'shortcuts', icon: 'keyboard', label: 'Raccourcis clavier', hint: '?', run: go({ shortcuts: true }) },
    { id: 'lock', icon: 'lock', label: 'Verrouiller', hint: 'Ctrl+L', run: () => { setUi({ palette: false }); window.dispatchEvent(new Event('zr:lock')) } }
  ]
}

export function currentTheme() {
  return document.documentElement.dataset.theme
}

export function CommandPalette() {
  const u = useUi()
  if (!u.palette) return null
  return html`<${Palette} />`
}

function Palette() {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef()
  const listRef = useRef()
  useEffect(() => { inputRef.current.focus() }, [])
  const d = db()
  const nq = norm(q.trim())
  const close = () => setUi({ palette: false })

  const results = useMemo(() => {
    const out = []
    // Création rapide d'événement si la saisie contient une date ou une heure
    if (q.trim().length > 2) {
      const p = parseQuick(q)
      if ((p.date || p.time) && p.title) {
        const draft = quickToEvent(p, { defaultDuration: d.settings.defaultDuration, calendars: d.calendars, defaultCalendarId: d.settings.defaultCalendarId || d.calendars[0]?.id })
        out.push({ group: 'Créer', id: 'quick', icon: 'calendarPlus', label: 'Créer « ' + draft.title + ' »',
          sub: fmtRelativeDay(parse(draft.start)) + ', ' + fmtRange(parse(draft.start), parse(draft.end), draft.allDay, d.settings.h12).toLowerCase(),
          run: () => { const ev = addEvent({ ...draft, reminders: draft.allDay ? [] : [d.settings.defaultReminder].filter(x => x >= 0) }); close(); setUi({ section: 'calendar', date: startOfDay(parse(ev.start)) }); toast('Événement créé', { action: 'Modifier', onAction: () => openEditor(ev) }) } })
        out.push({ group: 'Créer', id: 'quick-task', icon: 'tasks', label: 'Créer la tâche « ' + p.title + ' »', sub: p.date ? 'Échéance ' + fmtRelativeDay(p.date).toLowerCase() : '',
          run: () => { addTask({ title: p.title, due: p.date ? ymd(p.date) : null, priority: p.priority }); close(); toast('Tâche créée') } })
      }
    }
    const cmds = commands().map(c => ({ ...c, s: score(c.label, nq) })).filter(c => c.s > 0)
    if (nq) cmds.sort((a, b) => b.s - a.s)
    out.push(...cmds.slice(0, nq ? 6 : 9).map(c => ({ ...c, group: 'Actions' })))
    if (nq.length >= 2) {
      const evs = d.events.map(e => ({ e, s: Math.max(score(e.title, nq) * 2, score(e.location, nq), score(e.description, nq) ? 0.5 : 0) }))
        .filter(x => x.s > 0).sort((a, b) => b.s - a.s || b.e.start.localeCompare(a.e.start)).slice(0, 6)
      out.push(...evs.map(({ e }) => ({
        group: 'Événements', id: e.id, dot: calColor(e.calendarId), label: e.title || 'Sans titre',
        sub: cap(fmtDayShort(parse(e.start))) + (e.allDay ? '' : ', ' + fmtTime(parse(e.start), d.settings.h12)) + (e.recurrence ? ' · récurrent' : '') + (e.location ? ' · ' + e.location : ''),
        run: () => { close(); setUi({ section: 'calendar', date: startOfDay(parse(e.start)) }); editOccurrence({ ev: e, start: parse(e.start), end: parse(e.end) }) }
      })))
      const tasks = d.tasks.filter(t => score(t.title, nq) || score(t.notes, nq)).slice(0, 5)
      out.push(...tasks.map(t => ({ group: 'Tâches', id: t.id, icon: t.done ? 'checkCircle' : 'tasks', label: t.title, sub: t.due ? 'Échéance ' + fmtDayShort(parse(t.due)) : t.done ? 'Terminée' : '',
        run: () => setUi({ palette: false, section: 'tasks', selectedTask: t.id }) })))
      const notes = d.notes.filter(n => score(n.title, nq) || norm(stripHtml(n.content)).includes(nq)).slice(0, 5)
      out.push(...notes.map(n => {
        const txt = stripHtml(n.content)
        const i = norm(txt).indexOf(nq)
        return { group: 'Notes', id: n.id, icon: 'note', label: n.title || 'Sans titre', sub: i >= 0 ? '…' + txt.slice(Math.max(0, i - 30), i + 60) + '…' : txt.slice(0, 80),
          run: () => setUi({ palette: false, section: 'notes', selectedNote: n.id, notebookFilter: 'all' }) }
      }))
    }
    return out
  }, [q])

  useEffect(() => { setIdx(0) }, [q])
  useEffect(() => {
    const el = listRef.current && listRef.current.querySelector('.pal-item.active')
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [idx])

  const onKey = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(results.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); results[idx] && results[idx].run() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
  }

  let lastGroup = null
  return html`
    <div class="modal-layer palette-layer" onMouseDown=${e => { if (e.target === e.currentTarget) close() }}>
      <div class="palette" role="dialog" aria-label="Palette de commandes">
        <div class="pal-input">
          <${Icon} name="search" size=${17} />
          <input ref=${inputRef} value=${q} placeholder="Rechercher, créer « Dîner vendredi 20h », ou lancer une commande…"
            onInput=${e => setQ(e.target.value)} onKeyDown=${onKey} />
          <${Kbd}>Échap</${Kbd}>
        </div>
        <div class="pal-list" ref=${listRef}>
          ${results.length === 0 && html`<div class="pal-empty">Aucun résultat pour « ${q} »</div>`}
          ${results.map((r, i) => {
            const header = r.group !== lastGroup ? html`<div class="pal-group">${r.group}</div>` : null
            lastGroup = r.group
            return html`${header}
              <button class=${cx('pal-item', i === idx && 'active')} onMouseMove=${() => i !== idx && setIdx(i)} onClick=${r.run}>
                ${r.dot ? html`<span class="pal-dot" style=${{ background: r.dot }}></span>` : html`<${Icon} name=${r.icon || 'arrowRight'} size=${16} />`}
                <span class="pal-label">${r.label}${r.sub && html`<span class="pal-sub">${r.sub}</span>`}</span>
                ${r.hint && html`<${Kbd}>${r.hint}</${Kbd}>`}
                ${i === idx && html`<${Icon} name="cornerDownLeft" size=${14} class="pal-enter" />`}
              </button>`
          })}
        </div>
        <div class="pal-foot">
          <span><${Kbd}>↑</${Kbd}><${Kbd}>↓</${Kbd}> naviguer</span>
          <span><${Kbd}>Entrée</${Kbd}> ouvrir</span>
          <span class="grow"></span>
          <span>ZR Agenda</span>
        </div>
      </div>
    </div>`
}

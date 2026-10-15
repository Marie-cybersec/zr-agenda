import { html, useState, useEffect } from './lib.js'
import { Icon, Logo } from './icons.js'
import { Modal, Switch, Segmented, Kbd, IconButton, cx } from './ui.js'
import { useUi, useDb, db, setUi, setSettings, mutate, toast, ask, uid, withUndo, ACCENTS, CAL_COLORS, snapshot, restore } from './store.js'
import { exportIcs, importIcs } from './ics.js'

const TABS = [
  ['general', 'Général', 'sliders'],
  ['calendar', 'Calendrier', 'calendar'],
  ['appearance', 'Apparence', 'palette'],
  ['notifications', 'Notifications', 'bell'],
  ['security', 'Sécurité', 'shield'],
  ['data', 'Données', 'database'],
  ['shortcuts', 'Raccourcis', 'keyboard'],
  ['about', 'À propos', 'info']
]

export const SHORTCUTS = [
  ['Général', [
    [['Ctrl', 'K'], 'Rechercher et lancer une commande'],
    [['Alt', '1 – 5'], 'Aujourd\'hui, Calendrier, Tâches, Notes, Analyse'],
    [['Ctrl', ','], 'Paramètres'],
    [['Ctrl', 'L'], 'Verrouiller (si un mot de passe est défini)'],
    [['Ctrl', 'B'], 'Afficher ou masquer la barre latérale'],
    [['?'], 'Afficher les raccourcis']
  ]],
  ['Calendrier', [
    [['C'], 'Créer un événement'],
    [['/'], 'Ajout rapide en langage naturel'],
    [['T'], 'Revenir à aujourd\'hui'],
    [['←', '→'], 'Période précédente / suivante'],
    [['J'], 'Vue jour'], [['S'], 'Vue semaine'], [['M'], 'Vue mois'], [['A'], 'Vue année'], [['L'], 'Vue liste'],
    [['Ctrl', 'Entrée'], 'Enregistrer l\'événement en cours d\'édition'],
    [['Suppr'], 'Supprimer l\'événement affiché']
  ]],
  ['Notes', [
    [['Ctrl', 'N'], 'Nouvelle note'],
    [['#', 'Espace'], 'Titre (##, ### pour les niveaux suivants)'],
    [['-', 'Espace'], 'Liste à puces'], [['1.', 'Espace'], 'Liste numérotée'], [['[]', 'Espace'], 'Liste de tâches'],
    [['>', 'Espace'], 'Citation'], [['---', 'Entrée'], 'Séparateur'],
    [['Ctrl', 'K'], 'Insérer un lien (dans l\'éditeur)']
  ]]
]

export function ShortcutsList() {
  return html`<div class="shortcuts">
    ${SHORTCUTS.map(([group, list]) => html`
      <div class="sc-group">
        <div class="sc-title">${group}</div>
        ${list.map(([keys, label]) => html`<div class="sc-row"><span>${label}</span><span class="sc-keys">${keys.map(k => html`<${Kbd}>${k}</${Kbd}>`)}</span></div>`)}
      </div>`)}
  </div>`
}

export function ShortcutsModal() {
  const u = useUi()
  if (!u.shortcuts) return null
  return html`<${Modal} onClose=${() => setUi({ shortcuts: false })} width=${640}>
    <div class="modal-head"><h2>Raccourcis clavier</h2><${IconButton} icon="x" label="Fermer" onClick=${() => setUi({ shortcuts: false })} /></div>
    <div class="modal-scroll"><${ShortcutsList} /></div>
  <//>`
}

export function SettingsModal() {
  const u = useUi()
  if (!u.settings) return null
  const close = () => setUi({ settings: null })
  return html`<${Modal} onClose=${close} width=${860} class="settings-modal">
    <div class="settings">
      <nav class="settings-nav">
        <div class="settings-nav-title">Paramètres</div>
        ${TABS.map(([k, label, icon]) => html`<button class=${cx('settings-tab', u.settings === k && 'active')} onClick=${() => setUi({ settings: k })}>
          <${Icon} name=${icon} size=${15} />${label}</button>`)}
      </nav>
      <div class="settings-content">
        <div class="settings-head"><h2>${TABS.find(t => t[0] === u.settings)[1]}</h2><${IconButton} icon="x" label="Fermer" onClick=${close} /></div>
        <div class="settings-scroll">
          ${u.settings === 'general' && html`<${General} />`}
          ${u.settings === 'calendar' && html`<${CalendarPrefs} />`}
          ${u.settings === 'appearance' && html`<${Appearance} />`}
          ${u.settings === 'notifications' && html`<${Notifications} />`}
          ${u.settings === 'security' && html`<${Security} />`}
          ${u.settings === 'data' && html`<${Data} />`}
          ${u.settings === 'shortcuts' && html`<${ShortcutsList} />`}
          ${u.settings === 'about' && html`<${About} />`}
        </div>
      </div>
    </div>
  <//>`
}

function Row({ label, desc, children }) {
  return html`<div class="set-row"><div class="set-text"><div class="set-label">${label}</div>${desc && html`<div class="set-desc">${desc}</div>`}</div><div class="set-control">${children}</div></div>`
}

function General() {
  const s = useDb().settings
  return html`
    <div class="set-group">
      <${Row} label="Votre prénom" desc="Utilisé pour vous saluer dans la vue Aujourd'hui.">
        <input class="input" value=${s.userName} placeholder="Prénom" onInput=${e => setSettings({ userName: e.target.value })} />
      <//>
      <${Row} label="Section au démarrage">
        <select class="input select" value=${s.startSection || 'today'} onChange=${e => setSettings({ startSection: e.target.value })}>
          <option value="today">Aujourd'hui</option><option value="calendar">Calendrier</option><option value="tasks">Tâches</option><option value="notes">Notes</option>
        </select>
      <//>
      <${Row} label="Vue du calendrier par défaut">
        <select class="input select" value=${s.defaultView} onChange=${e => setSettings({ defaultView: e.target.value })}>
          <option value="day">Jour</option><option value="week">Semaine</option><option value="month">Mois</option><option value="year">Année</option><option value="list">Liste</option>
        </select>
      <//>
      <${Row} label="Format de l'heure">
        <${Segmented} size="sm" value=${s.h12 ? '12' : '24'} onChange=${v => setSettings({ h12: v === '12' })} options=${[{ value: '24', label: '14:30' }, { value: '12', label: '2:30 pm' }]} />
      <//>
      <${Row} label="Premier jour de la semaine">
        <${Segmented} size="sm" value=${String(s.weekStart)} onChange=${v => setSettings({ weekStart: Number(v) })} options=${[{ value: '1', label: 'Lundi' }, { value: '0', label: 'Dimanche' }, { value: '6', label: 'Samedi' }]} />
      <//>
    </div>`
}

function CalendarPrefs() {
  const d = useDb()
  const s = d.settings
  const hours = Array.from({ length: 25 }, (_, h) => h)
  return html`
    <div class="set-group">
      <div class="set-group-title">Mes agendas</div>
      ${d.calendars.map(c => html`<${CalendarRow} key=${c.id} c=${c} isDefault=${(s.defaultCalendarId || d.calendars[0]?.id) === c.id} />`)}
      <button class="btn btn-ghost sm add-row" onClick=${() => mutate(x => { x.calendars = [...x.calendars, { id: uid(), name: 'Nouvel agenda', color: CAL_COLORS[x.calendars.length % CAL_COLORS.length], visible: true }] })}>
        <${Icon} name="plus" size=${14} />Ajouter un agenda</button>
    </div>
    <div class="set-group">
      <div class="set-group-title">Affichage</div>
      <${Row} label="Heures de travail" desc="Mises en valeur dans la grille et utilisées pour les créneaux libres.">
        <div class="inline">
          <select class="input select" value=${s.workStart} onChange=${e => setSettings({ workStart: Math.min(Number(e.target.value), s.workEnd - 1) })}>${hours.slice(0, 24).map(h => html`<option value=${h}>${String(h).padStart(2, '0')}:00</option>`)}</select>
          <span class="muted">à</span>
          <select class="input select" value=${s.workEnd} onChange=${e => setSettings({ workEnd: Math.max(Number(e.target.value), s.workStart + 1) })}>${hours.slice(1).map(h => html`<option value=${h}>${String(h).padStart(2, '0')}:00</option>`)}</select>
        </div>
      <//>
      <${Row} label="Masquer les week-ends" desc="Vue semaine réduite aux jours ouvrés."><${Switch} checked=${s.hideWeekends} onChange=${v => setSettings({ hideWeekends: v })} label="Masquer les week-ends" /><//>
      <${Row} label="Numéros de semaine"><${Switch} checked=${s.showWeekNumbers} onChange=${v => setSettings({ showWeekNumbers: v })} label="Numéros de semaine" /><//>
      <${Row} label="Jours fériés (France)"><${Switch} checked=${s.showHolidays} onChange=${v => setSettings({ showHolidays: v })} label="Jours fériés" /><//>
      <${Row} label="Afficher les tâches dans le calendrier" desc="Les tâches avec échéance apparaissent sur la ligne « Journée »."><${Switch} checked=${s.showTasksInCalendar} onChange=${v => setSettings({ showTasksInCalendar: v })} label="Tâches dans le calendrier" /><//>
    </div>
    <div class="set-group">
      <div class="set-group-title">Nouveaux événements</div>
      <${Row} label="Durée par défaut">
        <select class="input select" value=${s.defaultDuration} onChange=${e => setSettings({ defaultDuration: Number(e.target.value) })}>
          ${[15, 30, 45, 60, 90, 120].map(m => html`<option value=${m}>${m < 60 ? m + ' minutes' : m / 60 + ' heure' + (m > 60 ? 's' : '')}</option>`)}
        </select>
      <//>
      <${Row} label="Rappel par défaut">
        <select class="input select" value=${s.defaultReminder} onChange=${e => setSettings({ defaultReminder: Number(e.target.value) })}>
          <option value="-1">Aucun</option>
          ${[0, 5, 10, 15, 30, 60].map(m => html`<option value=${m}>${m === 0 ? "À l'heure" : m < 60 ? m + ' minutes avant' : '1 heure avant'}</option>`)}
        </select>
      <//>
    </div>`
}

function CalendarRow({ c, isDefault }) {
  const [open, setOpen] = useState(false)
  const update = patch => mutate(d => { d.calendars = d.calendars.map(x => x.id === c.id ? { ...x, ...patch } : x) })
  const del = async () => {
    const d = db()
    if (d.calendars.length <= 1) return toast('Il faut conserver au moins un agenda')
    const count = d.events.filter(e => e.calendarId === c.id).length
    const others = d.calendars.filter(x => x.id !== c.id)
    const r = await ask({
      title: 'Supprimer l\'agenda « ' + c.name + ' » ?',
      message: count ? count + ' événement(s) y sont rattachés.' : 'Cet agenda ne contient aucun événement.',
      stacked: !!count,
      actions: count ? [
        { label: 'Déplacer vers « ' + others[0].name + ' »', value: 'move', tone: 'primary' },
        { label: 'Supprimer aussi les événements', value: 'delete', tone: 'danger' },
        { label: 'Annuler', value: null }
      ] : [{ label: 'Annuler', value: null }, { label: 'Supprimer', value: 'delete', tone: 'danger' }]
    })
    if (!r) return
    withUndo('Agenda supprimé', () => mutate(x => {
      x.calendars = x.calendars.filter(k => k.id !== c.id)
      x.events = r === 'move' ? x.events.map(e => e.calendarId === c.id ? { ...e, calendarId: others[0].id } : e) : x.events.filter(e => e.calendarId !== c.id)
      if (x.settings.defaultCalendarId === c.id) x.settings = { ...x.settings, defaultCalendarId: null }
    }))
  }
  return html`<div class="cal-row">
    <button class="swatch-btn" style=${{ background: c.color }} onClick=${() => setOpen(!open)} aria-label="Couleur"></button>
    <input class="input bare" value=${c.name} onInput=${e => update({ name: e.target.value })} />
    ${isDefault ? html`<span class="chip">Par défaut</span>` : html`<button class="btn btn-ghost sm" onClick=${() => setSettings({ defaultCalendarId: c.id })}>Définir par défaut</button>`}
    <${IconButton} icon="trash" label="Supprimer" onClick=${del} />
    ${open && html`<div class="swatches full">${CAL_COLORS.map(col => html`<button class=${cx('swatch', col === c.color && 'active')} style=${{ background: col }} aria-label="Couleur" onClick=${() => { update({ color: col }); setOpen(false) }}></button>`)}</div>`}
  </div>`
}

function Appearance() {
  const s = useDb().settings
  return html`
    <div class="set-group">
      <${Row} label="Thème">
        <${Segmented} size="sm" value=${s.theme} onChange=${v => setSettings({ theme: v })}
          options=${[{ value: 'light', label: 'Clair', icon: 'sun' }, { value: 'dark', label: 'Sombre', icon: 'moon' }, { value: 'system', label: 'Système', icon: 'monitor' }]} />
      <//>
      <${Row} label="Couleur d'accent">
        <div class="swatches">${Object.entries(ACCENTS).map(([k, c]) => html`<button class=${cx('swatch', s.accent === k && 'active')} title=${k} style=${{ background: c }} onClick=${() => setSettings({ accent: k })}></button>`)}</div>
      <//>
      <${Row} label="Densité" desc="Espacement de l'interface.">
        <${Segmented} size="sm" value=${s.density} onChange=${v => setSettings({ density: v })} options=${[{ value: 'compact', label: 'Compacte' }, { value: 'comfortable', label: 'Confortable' }]} />
      <//>
      <${Row} label="Hauteur des heures" desc="Zoom de la grille horaire (aussi réglable depuis le calendrier).">
        <div class="inline"><input type="range" min="36" max="120" step="4" value=${s.hourHeight} onInput=${e => setSettings({ hourHeight: Number(e.target.value) })} /><span class="muted mono">${s.hourHeight}px</span></div>
      <//>
    </div>`
}

function Notifications() {
  const s = useDb().settings
  return html`
    <div class="set-group">
      <${Row} label="Notifications de bureau" desc="Rappels d'événements, échéances de tâches et fin des sessions de concentration."><${Switch} checked=${s.notifications} onChange=${v => setSettings({ notifications: v })} label="Notifications" /><//>
      <${Row} label="Signal sonore"><${Switch} checked=${s.sound} onChange=${v => setSettings({ sound: v })} label="Son" /><//>
      <${Row} label="Tester"><button class="btn btn-secondary sm" onClick=${() => { try { new Notification('ZR Agenda', { body: 'Les notifications fonctionnent.' }) } catch {} }}>Envoyer une notification</button><//>
    </div>
    <div class="set-group">
      <div class="set-group-title">Concentration</div>
      <${Row} label="Durée d'une session">
        <select class="input select" value=${s.focusMinutes} onChange=${e => setSettings({ focusMinutes: Number(e.target.value) })}>${[15, 20, 25, 30, 45, 50, 60, 90].map(m => html`<option value=${m}>${m} minutes</option>`)}</select>
      <//>
      <${Row} label="Durée d'une pause">
        <select class="input select" value=${s.breakMinutes} onChange=${e => setSettings({ breakMinutes: Number(e.target.value) })}>${[3, 5, 10, 15, 20].map(m => html`<option value=${m}>${m} minutes</option>`)}</select>
      <//>
    </div>`
}

function Security() {
  const s = useDb().settings
  const [mode, setMode] = useState(null)
  const [cur, setCur] = useState(''), [pw, setPw] = useState(''), [pw2, setPw2] = useState(''), [err, setErr] = useState('')
  useEffect(() => { window.zr.vaultStatus().then(v => setMode(v.mode)) }, [])
  const submit = async remove => {
    setErr('')
    if (!remove) {
      if (pw.length < 6) return setErr('Le mot de passe doit contenir au moins 6 caractères.')
      if (pw !== pw2) return setErr('Les deux mots de passe ne correspondent pas.')
    }
    const r = await window.zr.setPassword(cur, remove ? null : pw)
    if (!r.ok) return setErr(r.error === 'wrong' ? 'Mot de passe actuel incorrect.' : 'Opération impossible.')
    setMode(remove ? 'keyfile' : 'password'); setCur(''); setPw(''); setPw2('')
    toast(remove ? 'Mot de passe supprimé' : 'Mot de passe défini')
  }
  const strength = pw.length === 0 ? 0 : Math.min(4, (pw.length >= 8) + (pw.length >= 12) + (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) + (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)))
  return html`
    <div class="set-callout"><${Icon} name="shield" size=${18} />
      <div>Vos données sont chiffrées sur ce poste en <b>AES-256-GCM</b>. Avec un mot de passe, la clé est dérivée par <b>scrypt</b> et n'est jamais écrite sur le disque : sans le mot de passe, les données sont illisibles.</div>
    </div>
    <div class="set-group">
      <div class="set-group-title">${mode === 'password' ? 'Mot de passe actif' : 'Définir un mot de passe'}</div>
      ${mode === 'password' && html`<${Row} label="Mot de passe actuel"><input class="input" type="password" value=${cur} onInput=${e => setCur(e.target.value)} /><//>`}
      <${Row} label=${mode === 'password' ? 'Nouveau mot de passe' : 'Mot de passe'}>
        <div class="pw-field"><input class="input" type="password" value=${pw} onInput=${e => setPw(e.target.value)} />
          <div class=${'pw-strength s' + strength}><span></span><span></span><span></span><span></span></div></div>
      <//>
      <${Row} label="Confirmation"><input class="input" type="password" value=${pw2} onInput=${e => setPw2(e.target.value)} /><//>
      ${err && html`<div class="form-error">${err}</div>`}
      <div class="set-actions">
        ${mode === 'password' && html`<button class="btn btn-ghost danger sm" onClick=${() => submit(true)}>Supprimer le mot de passe</button>`}
        <button class="btn btn-primary sm" onClick=${() => submit(false)}>${mode === 'password' ? 'Changer le mot de passe' : 'Activer le mot de passe'}</button>
      </div>
      <div class="set-warning"><${Icon} name="info" size=${14} />Aucune récupération n'est possible en cas d'oubli du mot de passe.</div>
    </div>
    <div class="set-group">
      <${Row} label="Verrouillage automatique" desc="Après une période d'inactivité (mot de passe requis).">
        <select class="input select" value=${s.autoLockMin} disabled=${mode !== 'password'} onChange=${e => setSettings({ autoLockMin: Number(e.target.value) })}>
          <option value="0">Jamais</option>${[1, 5, 10, 15, 30, 60].map(m => html`<option value=${m}>${m} minute${m > 1 ? 's' : ''}</option>`)}
        </select>
      <//>
    </div>`
}

function Data() {
  const d = useDb()
  const [info, setInfo] = useState(null)
  useEffect(() => { window.zr.info().then(setInfo) }, [])
  const stamp = new Date().toISOString().slice(0, 10)

  const exportCal = async () => {
    const p = await window.zr.saveFile({ defaultPath: 'zr-agenda-' + stamp + '.ics', filters: [{ name: 'iCalendar', extensions: ['ics'] }], content: exportIcs(d.events, d.calendars) })
    if (p) toast(d.events.length + ' événement(s) exporté(s)')
  }
  const importCal = async () => {
    const f = await window.zr.openFile({ filters: [{ name: 'iCalendar', extensions: ['ics', 'ical'] }] })
    if (!f) return
    const list = importIcs(f.content)
    if (!list.length) return toast('Aucun événement trouvé dans ce fichier')
    const name = f.path.split(/[\\/]/).pop().replace(/\.(ics|ical)$/i, '')
    const snap = snapshot()
    const existing = new Set(d.events.map(e => e.importUid).filter(Boolean))
    const fresh = list.filter(e => !e.uid || !existing.has(e.uid))
    mutate(x => {
      const cal = { id: uid(), name: name.slice(0, 40) || 'Importé', color: CAL_COLORS[x.calendars.length % CAL_COLORS.length], visible: true }
      x.calendars = [...x.calendars, cal]
      const now = new Date().toISOString()
      x.events = [...x.events, ...fresh.map(e => {
        const { uid: u, ...rest } = e
        return { id: uid(), ...rest, importUid: u, calendarId: cal.id, createdAt: now, updatedAt: now }
      })]
    })
    toast(fresh.length + ' événement(s) importé(s) dans « ' + name + ' »', { action: 'Annuler', onAction: () => restore(snap) })
  }
  const exportJson = async () => {
    const p = await window.zr.saveFile({ defaultPath: 'zr-agenda-sauvegarde-' + stamp + '.json', filters: [{ name: 'JSON', extensions: ['json'] }], content: JSON.stringify(d, null, 2) })
    if (p) toast('Sauvegarde exportée (non chiffrée)')
  }
  const importJson = async () => {
    const f = await window.zr.openFile({ filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (!f) return
    let data
    try { data = JSON.parse(f.content) } catch { return toast('Fichier illisible') }
    if (!data || data.version !== 2 || !Array.isArray(data.events)) return toast('Ce fichier n\'est pas une sauvegarde ZR Agenda')
    const r = await ask({ title: 'Restaurer cette sauvegarde ?', message: 'Toutes les données actuelles seront remplacées par celles du fichier (' + data.events.length + ' événements, ' + (data.tasks || []).length + ' tâches, ' + (data.notes || []).length + ' notes).',
      actions: [{ label: 'Annuler', value: false }, { label: 'Restaurer', value: true, tone: 'danger' }] })
    if (!r) return
    const snap = snapshot()
    restore({ ...data, settings: { ...d.settings, ...data.settings } })
    toast('Sauvegarde restaurée', { action: 'Annuler', onAction: () => restore(snap) })
  }
  return html`
    <div class="set-group">
      <div class="set-group-title">Calendrier (.ics)</div>
      <${Row} label="Exporter" desc="Compatible Google Agenda, Outlook et Apple Calendrier."><button class="btn btn-secondary sm" onClick=${exportCal}><${Icon} name="download" size=${14} />Exporter</button><//>
      <${Row} label="Importer" desc="Les événements sont ajoutés dans un nouvel agenda."><button class="btn btn-secondary sm" onClick=${importCal}><${Icon} name="upload" size=${14} />Importer</button><//>
    </div>
    <div class="set-group">
      <div class="set-group-title">Sauvegarde complète</div>
      <${Row} label="Exporter toutes les données" desc="Événements, tâches, notes et réglages au format JSON (fichier non chiffré)."><button class="btn btn-secondary sm" onClick=${exportJson}><${Icon} name="download" size=${14} />Exporter</button><//>
      <${Row} label="Restaurer une sauvegarde"><button class="btn btn-secondary sm" onClick=${importJson}><${Icon} name="upload" size=${14} />Restaurer</button><//>
    </div>
    <div class="set-group">
      <div class="set-group-title">Stockage local</div>
      <${Row} label="Dossier des données" desc=${info ? info.dataDir : '…'}><button class="btn btn-secondary sm" onClick=${() => window.zr.openDataDir()}><${Icon} name="folder" size=${14} />Ouvrir</button><//>
      <${Row} label="Sauvegardes automatiques" desc="Une copie chiffrée par jour, 30 jours conservés."><span class="chip">${info ? info.backups : '…'} disponible${info && info.backups > 1 ? 's' : ''}</span><//>
      <div class="data-counts">
        <span><b>${d.events.length}</b> événements</span><span><b>${d.tasks.length}</b> tâches</span><span><b>${d.notes.length}</b> notes</span><span><b>${d.calendars.length}</b> agendas</span>
      </div>
    </div>`
}

function About() {
  const [info, setInfo] = useState(null)
  useEffect(() => { window.zr.info().then(setInfo) }, [])
  return html`<div class="about">
    <${Logo} size=${56} />
    <div class="about-name">ZR Agenda</div>
    <div class="about-version">Version ${info ? info.version : '…'} · Electron ${info ? info.electron : '…'}</div>
    <p class="about-text">Agenda, tâches et notes, chiffrés localement. Une suite ZYRHA OS par BMM Systems.</p>
  </div>`
}

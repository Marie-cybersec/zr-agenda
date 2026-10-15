// Test de fumée de l'interface : lance l'application sur un dossier de données temporaire (jamais vos données),
// avec un jeu d'essai, parcourt chaque section, relève les erreurs de console et enregistre des captures.
// Usage : npx electron scripts/smoke.cjs [dossier-captures]

const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const { app } = require('electron')
const storage = require('../storage')

const outDir = process.argv.find(a => a.startsWith('--out='))?.slice(6) || path.join(os.tmpdir(), 'zr-smoke-shots')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zr-smoke-'))
fs.mkdirSync(outDir, { recursive: true })
process.env.ZR_DATA_DIR = dataDir
app.setPath('userData', path.join(dataDir, 'userData'))

// ─── Jeu d'essai (format v2 : la migration est aussi vérifiée) ───────────────
const pad = n => String(n).padStart(2, '0')
const day = (offset, hh = null, mm = 0) => {
  const d = new Date(); d.setDate(d.getDate() + offset)
  const ymd = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  return hh == null ? ymd : ymd + 'T' + pad(hh) + ':' + pad(mm)
}
const id = () => crypto.randomUUID()
const cal = id(), uni = id()
const now = new Date().toISOString()
const seed = {
  version: 2,
  calendars: [{ id: cal, name: 'Personnel', color: '#5E6AD2', visible: true }, { id: uni, name: 'Université', color: '#2F80ED', visible: true }],
  events: [
    { id: id(), title: 'Cours de réseaux', calendarId: uni, allDay: false, start: day(0, 9), end: day(0, 11), location: 'Amphi B', description: '', recurrence: { freq: 'weekly', interval: 1 }, exdates: [], reminders: [10], createdAt: now, updatedAt: now },
    { id: id(), title: 'Rendez-vous banque', calendarId: cal, allDay: false, start: day(0, 15), end: day(0, 16), location: '', description: '', recurrence: null, exdates: [], reminders: [], createdAt: now, updatedAt: now },
    { id: id(), title: 'TP sécurité', calendarId: uni, allDay: false, start: day(0, 15, 30), end: day(0, 17), location: 'Salle 12', description: '', recurrence: null, exdates: [], reminders: [], createdAt: now, updatedAt: now },
    { id: id(), title: 'Partiel', calendarId: uni, allDay: false, start: day(2, 8), end: day(2, 10), location: '', description: '', recurrence: null, exdates: [], reminders: [1440], createdAt: now, updatedAt: now }
  ],
  tasks: [
    { id: id(), title: 'Rendre le rapport de stage', notes: '', due: day(-2), dueTime: null, priority: 3, done: false, doneAt: null, subtasks: [], repeat: null, createdAt: now },
    { id: id(), title: 'Réviser le chapitre 3', notes: '', due: day(0), dueTime: '18:00', priority: 2, done: false, doneAt: null, subtasks: [], repeat: null, createdAt: now },
    { id: id(), title: 'Acheter un adaptateur', notes: '', due: day(0), dueTime: null, priority: 0, done: false, doneAt: null, subtasks: [], repeat: null, createdAt: now }
  ],
  notes: [{ id: id(), title: 'Idées projet', content: '<p>Application de suivi</p>', notebookId: null, pinned: false, createdAt: now, updatedAt: now }],
  notebooks: [],
  settings: { userName: 'Test', notifications: false }
}

const key = crypto.randomBytes(32)
fs.writeFileSync(path.join(dataDir, 'key.dat'), key)
storage.writeDb(path.join(dataDir, 'data.enc'), key, seed)

// ─── Parcours ────────────────────────────────────────────────────────────────
const errors = []
const sleep = ms => new Promise(r => setTimeout(r, ms))

app.on('browser-window-created', (_, win) => {
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) errors.push(message + ' (' + path.basename(source || '') + ':' + line + ')')
  })
  win.webContents.on('render-process-gone', (_e, d) => errors.push('Processus de rendu arrêté : ' + d.reason))
  win.webContents.once('did-finish-load', async () => {
    try {
      win.setSize(1440, 900)
      await sleep(1500)
      const run = js => win.webContents.executeJavaScript(js, true)
      const shot = async name => fs.writeFileSync(path.join(outDir, name + '.png'), (await win.webContents.capturePage()).toPNG())
      const sections = ['today', 'calendar', 'tasks', 'habits', 'journal', 'goals', 'trips', 'notes', 'insights']
      for (let i = 0; i < sections.length; i++) {
        await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '${i + 1}', altKey: true, bubbles: true }))`)
        await sleep(500)
        const empty = await run(`!document.querySelector('.main') || document.querySelector('.main').children.length === 0`)
        if (empty) errors.push('Section vide : ' + sections[i])
        await shot(pad(i + 1) + '-' + sections[i])
      }
      // Paramètres : nouveaux onglets
      for (const tab of ['categories', 'schedule', 'notifications', 'data']) {
        await run(`document.querySelectorAll('.settings-tab').length || window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true }))`)
        await sleep(300)
        await run(`[...document.querySelectorAll('.settings-tab')].find(b => b.textContent.includes(${JSON.stringify({ categories: 'Catégories', schedule: 'Horaires', notifications: 'Notifications', data: 'Données' }[tab])}))?.click()`)
        await sleep(300)
        await shot('settings-' + tab)
      }
      await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
      await sleep(300)

      // Interactions : créer et pointer une habitude, écrire le journal, créer un objectif et un trajet
      const go = n => run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '${n}', altKey: true, bubbles: true }))`)
      const click = (sel, text) => run(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(b => !${JSON.stringify(text || '')} || b.textContent.includes(${JSON.stringify(text || '')})); if (!el) return false; el.click(); return true })()`)
      const type = (sel, value) => run(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.focus(); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
      const expect = async (ok, what) => { if (!(await ok)) errors.push('Interaction impossible : ' + what) }

      await go(4); await sleep(300)
      await expect(click('button', 'Nouvelle habitude'), 'nouvelle habitude')
      await sleep(300)
      await expect(type('.split-side .td-title', 'Lire 20 pages'), "nom de l'habitude")
      await expect(click('.ht-cell:not(.off):not([disabled])'), "pointage d'un jour")
      await sleep(300)
      await shot('i1-habitude')
      await expect(click('.segmented .seg', 'Routines'), 'onglet routines')
      await sleep(200)
      await expect(click('button', 'Nouvelle routine'), 'nouvelle routine')
      await sleep(200)
      await expect(click('.segmented .seg', 'Rappels'), 'onglet rappels')
      await sleep(200)
      await expect(type('.reminder-form input.grow', 'Appeler la scolarité'), 'titre du rappel')
      await expect(click('.reminder-form button', 'Ajouter'), 'ajout du rappel')
      await sleep(200)

      await go(5); await sleep(300)
      await expect(click('.toolbar button', "aujourd'hui"), "entrée du jour")
      await sleep(300)
      await expect(type('.journal-text', 'Journée productive : révision du mémoire.'), 'texte du journal')
      await sleep(300)
      await shot('i2-journal')

      await go(6); await sleep(300)
      await expect(click('.toolbar button', 'Nouvel objectif'), 'nouvel objectif')
      await sleep(300)
      await expect(type('.modal input.input', 'Terminer 3 tâches'), "intitulé de l'objectif")
      await expect(click('.modal .btn-primary', 'Enregistrer'), "enregistrement de l'objectif")
      await sleep(300)
      await shot('i3-objectifs')

      await go(7); await sleep(300)
      await expect(click('.toolbar button', 'Nouveau déplacement'), 'nouveau déplacement')
      await sleep(300)
      await expect(click('.split-side button', 'Ajouter un trajet'), 'ajout de trajet')
      await sleep(400)
      await shot('i4-deplacement')

      // Recherche globale dans le journal
      await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`)
      await sleep(300)
      await expect(type('.pal-input input', 'memoire'), 'saisie de recherche')
      await sleep(300)
      const found = await run(`[...document.querySelectorAll('.pal-group')].some(g => g.textContent === 'Journal')`)
      if (!found) errors.push('La recherche « memoire » ne trouve pas l\'entrée de journal')
      await shot('i5-recherche')
      await run(`document.querySelector('.pal-input input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)

      await go(1); await sleep(500)
      await shot('i6-accueil')

      // Persistance : la base relue doit être en v3
      await sleep(800)
      const saved = storage.readDb(path.join(dataDir, 'data.enc'), key)
      if (saved.version !== 3) errors.push('Base non migrée en v3 (version ' + saved.version + ')')
      if (!Array.isArray(saved.habits) || !saved.categories.length) errors.push('Collections v3 absentes après migration')
      for (const k of ['habits', 'routines', 'reminders', 'journal', 'goals', 'trips']) if (!(saved[k] || []).length) errors.push('Non enregistré : ' + k)
      if (!Object.keys(saved.habitLogs || {}).length) errors.push("Pointage d'habitude non enregistré")
      if (!(saved.journal[0] || {}).content) errors.push('Texte du journal non enregistré')
    } catch (e) {
      errors.push('Exception du test : ' + e.message)
    }
    console.log(JSON.stringify({ errors, outDir }, null, 2))
    app.exit(errors.length ? 1 : 0)
  })
})

require('../main.js')

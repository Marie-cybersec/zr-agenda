/**
 * deploy_zr_agenda.js
 * Run from any folder with: node deploy_zr_agenda.js
 * Copies all ZR-AGENDA files to D:\BMM-Systems\ZYRHA-OS\ZR-AGENDA\
 */

const fs   = require('fs')
const path = require('path')

const DEST = 'D:\\BMM-Systems\\ZYRHA-OS\\ZR-AGENDA'

function mkdir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

function write(relPath, content) {
  const full = path.join(DEST, relPath)
  mkdir(path.dirname(full))
  fs.writeFileSync(full, content, { encoding: 'utf8' })
  console.log('  [OK] ' + relPath)
}

mkdir(DEST)
mkdir(path.join(DEST, 'renderer'))

// ─── package.json ─────────────────────────────────────────────────────────────
write('package.json', JSON.stringify({
  name: 'zr-agenda',
  version: '1.0.0',
  description: 'ZR-AGENDA -- Agenda & Notes personnels chiffres BMM Systems',
  main: 'main.js',
  scripts: { start: 'electron .' },
  build: {
    appId: 'com.bmmsystems.zr-agenda',
    productName: 'ZR-AGENDA',
    win: { target: 'nsis', icon: 'assets/icon.ico' }
  },
  devDependencies: {
    electron: '^28.0.0',
    'electron-builder': '^24.0.0'
  }
}, null, 2))

// ─── main.js ──────────────────────────────────────────────────────────────────
write('main.js', `const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs   = require('fs')
const crypto = require('crypto')
const os   = require('os')

const DATA_DIR  = path.join(os.homedir(), '.zr_agenda')
const DATA_FILE = path.join(DATA_DIR, 'data.enc')
const KEY_FILE  = path.join(DATA_DIR, 'key.dat')

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

function getOrCreateKey() {
  if (fs.existsSync(KEY_FILE)) return fs.readFileSync(KEY_FILE)
  const key = crypto.randomBytes(32)
  fs.writeFileSync(KEY_FILE, key, { mode: 0o600 })
  return key
}

function encryptData(obj) {
  const key = getOrCreateKey()
  const iv  = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct  = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct])
}

function decryptData(buf) {
  const key = getOrCreateKey()
  const iv  = buf.slice(0, 12)
  const tag = buf.slice(12, 28)
  const ct  = buf.slice(28)
  const dec = crypto.createDecipheriv('aes-256-gcm', key, iv)
  dec.setAuthTag(tag)
  return JSON.parse(Buffer.concat([dec.update(ct), dec.final()]).toString('utf8'))
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { events: [], notes: [], notebooks: [] }
  try { return decryptData(fs.readFileSync(DATA_FILE)) }
  catch { return { events: [], notes: [], notebooks: [] } }
}

function saveData(d) {
  fs.writeFileSync(DATA_FILE, encryptData(d))
}

let db = loadData()

let win
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800,
    minWidth: 960, minHeight: 640,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0D1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.loadFile('renderer/index.html')
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

ipcMain.on('win-minimize', () => win.minimize())
ipcMain.on('win-maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize())
ipcMain.on('win-close',    () => win.close())

ipcMain.handle('events-get',    () => db.events)
ipcMain.handle('event-add',     (_, ev) => { ev.id = crypto.randomUUID(); ev.createdAt = new Date().toISOString(); db.events.push(ev); saveData(db); return { ok: true, event: ev } })
ipcMain.handle('event-update',  (_, id, upd) => { const i = db.events.findIndex(e => e.id === id); if (i < 0) return { ok: false }; db.events[i] = { ...db.events[i], ...upd }; saveData(db); return { ok: true, event: db.events[i] } })
ipcMain.handle('event-delete',  (_, id) => { db.events = db.events.filter(e => e.id !== id); saveData(db); return { ok: true } })

ipcMain.handle('notes-get',     () => db.notes)
ipcMain.handle('note-add',      (_, n) => { n.id = crypto.randomUUID(); n.createdAt = new Date().toISOString(); n.updatedAt = n.createdAt; db.notes.push(n); saveData(db); return { ok: true, note: n } })
ipcMain.handle('note-update',   (_, id, upd) => { const i = db.notes.findIndex(n => n.id === id); if (i < 0) return { ok: false }; db.notes[i] = { ...db.notes[i], ...upd, updatedAt: new Date().toISOString() }; saveData(db); return { ok: true, note: db.notes[i] } })
ipcMain.handle('note-delete',   (_, id) => { db.notes = db.notes.filter(n => n.id !== id); saveData(db); return { ok: true } })

ipcMain.handle('notebooks-get',    () => db.notebooks)
ipcMain.handle('notebook-add',     (_, nb) => { nb.id = crypto.randomUUID(); db.notebooks.push(nb); saveData(db); return { ok: true, notebook: nb } })
ipcMain.handle('notebook-delete',  (_, id) => { db.notebooks = db.notebooks.filter(n => n.id !== id); db.notes = db.notes.filter(n => n.notebookId !== id); saveData(db); return { ok: true } })
`)

// ─── preload.js ───────────────────────────────────────────────────────────────
write('preload.js', `const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('zrAgenda', {
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close:    () => ipcRenderer.send('win-close'),

  eventsGet:    () => ipcRenderer.invoke('events-get'),
  eventAdd:     ev  => ipcRenderer.invoke('event-add', ev),
  eventUpdate:  (id, upd) => ipcRenderer.invoke('event-update', id, upd),
  eventDelete:  id  => ipcRenderer.invoke('event-delete', id),

  notesGet:     () => ipcRenderer.invoke('notes-get'),
  noteAdd:      n   => ipcRenderer.invoke('note-add', n),
  noteUpdate:   (id, upd) => ipcRenderer.invoke('note-update', id, upd),
  noteDelete:   id  => ipcRenderer.invoke('note-delete', id),

  notebooksGet:    () => ipcRenderer.invoke('notebooks-get'),
  notebookAdd:     nb  => ipcRenderer.invoke('notebook-add', nb),
  notebookDelete:  id  => ipcRenderer.invoke('notebook-delete', id),
})
`)

// ─── renderer/index.html ──────────────────────────────────────────────────────
write('renderer/index.html', `<!DOCTYPE html>
<html lang="fr" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ZR-AGENDA</title>
<link rel="stylesheet" href="style.css">
</head>
<body>

<div id="app" class="app">

  <!-- Titlebar -->
  <div class="titlebar">
    <div class="titlebar-drag">
      <svg width="18" height="18" viewBox="0 0 40 40" fill="none">
        <rect width="40" height="40" rx="8" fill="#635BFF"/>
        <path d="M12 8h16v3H12zM10 13h20v2H10zM8 17h24v16H8zm4 3v10h4V20zm6 0v10h4V20zm6 0v10h4V20z" fill="white" opacity=".9"/>
      </svg>
      <span class="titlebar-name">ZR-AGENDA</span>
      <span class="titlebar-badge">BMM Systems</span>
    </div>
    <div class="titlebar-controls">
      <button class="tb-btn" onclick="window.zrAgenda.minimize()">
        <svg width="10" height="2" viewBox="0 0 10 2"><rect width="10" height="2" fill="currentColor"/></svg>
      </button>
      <button class="tb-btn" onclick="window.zrAgenda.maximize()">
        <svg width="10" height="10" viewBox="0 0 10 10"><rect width="9" height="9" x=".5" y=".5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
      </button>
      <button class="tb-btn tb-close" onclick="window.zrAgenda.close()">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>
  </div>

  <!-- Body -->
  <div class="body">

    <!-- Sidebar -->
    <nav class="sidebar">
      <div class="sidebar-nav">
        <button class="nav-item active" data-view="dashboard" onclick="switchView('dashboard',this)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          <span>Tableau de bord</span>
        </button>
        <button class="nav-item" data-view="calendar" onclick="switchView('calendar',this)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span>Calendrier</span>
        </button>
        <button class="nav-item" data-view="notes" onclick="switchView('notes',this)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          <span>Notes</span>
        </button>
      </div>

      <div class="sidebar-section-label">CARNETS</div>
      <div id="notebooks-list" class="notebooks-list"></div>
      <button class="sidebar-add-nb" onclick="openAddNotebook()">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nouveau carnet
      </button>

      <div class="sidebar-bottom">
        <button class="sidebar-action" onclick="toggleTheme()">
          <svg id="theme-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
          Mode <span id="theme-label">clair</span>
        </button>
      </div>
    </nav>

    <!-- Main content -->
    <main class="content">

      <!-- DASHBOARD -->
      <div id="view-dashboard" class="view active">
        <div class="view-header">
          <div>
            <h2 class="view-title" id="dash-greeting">Bonjour</h2>
            <p class="view-sub" id="dash-date"></p>
          </div>
          <button class="btn-primary" onclick="openAddEvent()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nouvel evenement
          </button>
        </div>

        <div class="dash-grid">
          <div class="dash-card">
            <div class="dash-card-header">
              <span class="dash-card-title">Aujourd'hui</span>
              <span class="dash-badge" id="badge-today">0</span>
            </div>
            <div id="today-events" class="event-mini-list"></div>
          </div>
          <div class="dash-card">
            <div class="dash-card-header">
              <span class="dash-card-title">Cette semaine</span>
              <span class="dash-badge" id="badge-week">0</span>
            </div>
            <div id="week-events" class="event-mini-list"></div>
          </div>
          <div class="dash-card full-width">
            <div class="dash-card-header">
              <span class="dash-card-title">Notes recentes</span>
            </div>
            <div id="recent-notes" class="notes-mini-list"></div>
          </div>
        </div>
      </div>

      <!-- CALENDRIER -->
      <div id="view-calendar" class="view">
        <div class="view-header">
          <div class="cal-nav">
            <button class="cal-nav-btn" onclick="calPrev()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <h2 class="view-title" id="cal-title"></h2>
            <button class="cal-nav-btn" onclick="calNext()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <button class="btn-ghost" onclick="calToday()">Aujourd'hui</button>
          </div>
          <button class="btn-primary" onclick="openAddEvent()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nouvel evenement
          </button>
        </div>
        <div id="calendar-grid" class="calendar-grid"></div>
        <div id="day-events-panel" class="day-panel hidden">
          <div class="day-panel-header">
            <span id="day-panel-title"></span>
            <button class="modal-close" onclick="closeDayPanel()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div id="day-panel-events"></div>
          <button class="btn-primary" style="margin-top:12px;width:100%" onclick="openAddEvent(selectedDay)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Ajouter un evenement ce jour
          </button>
        </div>
      </div>

      <!-- NOTES -->
      <div id="view-notes" class="view">
        <div class="view-header">
          <h2 class="view-title" id="notes-view-title">Toutes les notes</h2>
          <button class="btn-primary" onclick="openAddNote()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nouvelle note
          </button>
        </div>
        <div class="notes-layout">
          <div id="notes-list-panel" class="notes-list-panel"></div>
          <div id="note-editor" class="note-editor hidden">
            <div class="note-editor-header">
              <input type="text" id="note-title-input" class="note-title-input" placeholder="Titre de la note..." />
              <div class="note-editor-actions">
                <button class="btn-ghost" onclick="saveCurrentNote()">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  Sauvegarder
                </button>
                <button class="btn-ghost danger" onclick="deleteCurrentNote()">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                  Supprimer
                </button>
              </div>
            </div>
            <div class="note-toolbar">
              <button class="tool-btn" onclick="fmt('bold')" title="Gras"><b>B</b></button>
              <button class="tool-btn" onclick="fmt('italic')" title="Italique"><i>I</i></button>
              <button class="tool-btn" onclick="fmt('underline')" title="Souligne"><u>U</u></button>
              <div class="tool-sep"></div>
              <button class="tool-btn" onclick="fmtBlock('h2')" title="Titre">H</button>
              <button class="tool-btn" onclick="fmtBlock('insertUnorderedList')" title="Liste">*</button>
              <button class="tool-btn" onclick="fmtBlock('insertOrderedList')" title="Liste num.">1.</button>
              <div class="tool-sep"></div>
              <select class="tool-select" id="nb-select" onchange="changeNoteNotebook(this.value)">
                <option value="">Sans carnet</option>
              </select>
            </div>
            <div id="note-content" class="note-content" contenteditable="true" spellcheck="true" data-placeholder="Commencez a ecrire..."></div>
            <div class="note-status" id="note-status"></div>
          </div>
          <div id="note-empty" class="note-empty">
            <div style="font-size:40px;margin-bottom:12px">&#128221;</div>
            <p>Selectionnez une note ou creez-en une nouvelle</p>
          </div>
        </div>
      </div>

    </main>
  </div>
</div>

<!-- Modal -->
<div id="modal-overlay" class="modal-overlay hidden" onclick="closeModal(event)">
  <div class="modal" onclick="event.stopPropagation()">
    <div class="modal-header">
      <h3 class="modal-title" id="modal-title"></h3>
      <button class="modal-close" onclick="closeModal()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="modal-body" id="modal-body"></div>
  </div>
</div>

<!-- Toast -->
<div id="toast" class="toast hidden"></div>

<script src="app.js"></script>
</body>
</html>
`)

// ─── renderer/style.css ───────────────────────────────────────────────────────
write('renderer/style.css', `/* ZR-AGENDA -- BMM Systems */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }

:root {
  --bg:        #0D1117;
  --surface:   #161B22;
  --surface2:  #1C2128;
  --border:    #30363D;
  --accent:    #635BFF;
  --accent-h:  #7B74FF;
  --text:      #E6EDF3;
  --text-sub:  #8B949E;
  --text-dim:  #484F58;
  --danger:    #F85149;
  --green:     #3FB950;
  --radius:    10px;
  --radius-sm: 6px;
}

[data-theme="light"] {
  --bg:        #F6F8FA;
  --surface:   #FFFFFF;
  --surface2:  #F0F2F5;
  --border:    #D0D7DE;
  --text:      #1C2128;
  --text-sub:  #57606A;
  --text-dim:  #B0B8C1;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  background: var(--bg);
  color: var(--text);
  height: 100vh;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
}

/* ── App shell ── */
.app { display: flex; flex-direction: column; height: 100vh }

/* ── Titlebar ── */
.titlebar {
  height: 40px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 0 0;
  -webkit-app-region: drag;
  flex-shrink: 0;
}
.titlebar-drag {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  -webkit-app-region: drag;
}
.titlebar-name { font-weight: 700; font-size: 13px; letter-spacing: .04em }
.titlebar-badge {
  background: var(--surface2);
  border: 1px solid var(--border);
  color: var(--text-sub);
  font-size: 10px;
  padding: 1px 7px;
  border-radius: 20px;
}
.titlebar-controls {
  display: flex;
  gap: 4px;
  -webkit-app-region: no-drag;
}
.tb-btn {
  width: 28px; height: 28px;
  background: none;
  border: none;
  border-radius: 6px;
  color: var(--text-sub);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .15s, color .15s;
}
.tb-btn:hover { background: var(--surface2); color: var(--text) }
.tb-btn.tb-close:hover { background: var(--danger); color: #fff }

/* ── Body layout ── */
.body { display: flex; flex: 1; overflow: hidden }

/* ── Sidebar ── */
.sidebar {
  width: 200px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 12px 0;
  flex-shrink: 0;
  overflow-y: auto;
}
.sidebar-nav { display: flex; flex-direction: column; gap: 2px; padding: 0 8px; margin-bottom: 8px }

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: none;
  border: none;
  color: var(--text-sub);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: background .15s, color .15s;
  width: 100%;
  text-align: left;
}
.nav-item:hover { background: var(--surface2); color: var(--text) }
.nav-item.active { background: rgba(99,91,255,.15); color: var(--accent) }
.nav-item.active svg { stroke: var(--accent) }

.sidebar-section-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  color: var(--text-dim);
  padding: 12px 16px 6px;
}

.notebooks-list { display: flex; flex-direction: column; gap: 1px; padding: 0 8px }

.nb-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background .15s;
  min-height: 32px;
}
.nb-item:hover { background: var(--surface2) }
.nb-item.active { background: var(--surface2) }
.nb-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0 }
.nb-name { flex: 1; font-size: 12.5px; color: var(--text-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.nb-item.active .nb-name { color: var(--text) }
.nb-count { font-size: 11px; color: var(--text-dim); min-width: 14px; text-align: right }
.nb-delete {
  display: none;
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
}
.nb-item:hover .nb-delete { display: block }
.nb-delete:hover { color: var(--danger) }

.sidebar-add-nb {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 8px;
  padding: 6px 10px;
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: color .15s, background .15s;
}
.sidebar-add-nb:hover { color: var(--accent); background: rgba(99,91,255,.08) }

.sidebar-bottom {
  margin-top: auto;
  padding: 12px 8px 4px;
  border-top: 1px solid var(--border);
}
.sidebar-action {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  background: none;
  border: none;
  color: var(--text-sub);
  font-size: 12.5px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background .15s, color .15s;
}
.sidebar-action:hover { background: var(--surface2); color: var(--text) }

/* ── Content area ── */
.content { flex: 1; overflow: hidden; display: flex; flex-direction: column; position: relative }

.view { display: none; flex-direction: column; height: 100%; overflow: hidden }
.view.active { display: flex }

.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.view-title { font-size: 20px; font-weight: 700; line-height: 1.2 }
.view-sub { color: var(--text-sub); font-size: 13px; margin-top: 3px }

/* ── Buttons ── */
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background .15s, transform .1s;
}
.btn-primary:hover { background: var(--accent-h) }
.btn-primary:active { transform: scale(.97) }
.btn-primary.full-width { width: 100%; justify-content: center }

.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  background: var(--surface2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background .15s;
}
.btn-ghost:hover { background: var(--border) }
.btn-ghost.danger { color: var(--danger) }
.btn-ghost.danger:hover { background: rgba(248,81,73,.1) }

.icon-btn {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 15px;
  padding: 4px;
  border-radius: 4px;
  transition: color .15s, background .15s;
}
.icon-btn:hover { color: var(--text); background: var(--surface2) }
.icon-btn.danger:hover { color: var(--danger) }

/* ── Dashboard ── */
.dash-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
}
.dash-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
}
.dash-card.full-width { grid-column: 1 / -1 }

.dash-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.dash-card-title { font-size: 13px; font-weight: 600; color: var(--text-sub); text-transform: uppercase; letter-spacing: .05em }
.dash-badge {
  background: var(--accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 20px;
  min-width: 20px;
  text-align: center;
}

.event-mini-list, .notes-mini-list { display: flex; flex-direction: column; gap: 4px }

.mini-event {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background .15s;
}
.mini-event:hover { background: var(--surface2) }
.mini-event-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0 }
.mini-event-info { display: flex; gap: 6px; align-items: center; flex: 1; min-width: 0 }
.mini-event-time { color: var(--text-sub); font-size: 12px; flex-shrink: 0 }
.mini-event-title { color: var(--text); font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }

.mini-note {
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background .15s;
}
.mini-note:hover { background: var(--surface2) }
.mini-note-title {
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mini-note-preview { font-size: 12px; color: var(--text-sub); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.mini-nb-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; display: inline-block }

.mini-empty { color: var(--text-dim); font-size: 12.5px; padding: 8px 0 }

/* ── Calendar ── */
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
  background: var(--border);
  flex: 1;
  overflow-y: auto;
  align-content: start;
}

.cal-header-cell {
  background: var(--surface);
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-sub);
  letter-spacing: .06em;
  padding: 8px 4px;
  text-transform: uppercase;
}

.cal-day {
  background: var(--bg);
  padding: 6px;
  min-height: 90px;
  cursor: pointer;
  transition: background .15s;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cal-day:hover { background: var(--surface2) }
.cal-day.other-month .cal-day-num { color: var(--text-dim) }
.cal-day.other-month { background: var(--surface) }

.cal-day-num {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text-sub);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  flex-shrink: 0;
}
.cal-day.today .cal-day-num {
  background: var(--accent);
  color: #fff;
  font-weight: 700;
}

.event-pill {
  font-size: 10.5px;
  color: #fff;
  padding: 1px 6px;
  border-radius: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  line-height: 1.6;
}
.pill-more { font-size: 10px; color: var(--text-dim); padding: 0 2px }

.cal-nav { display: flex; align-items: center; gap: 8px }
.cal-nav-btn {
  width: 30px; height: 30px;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .15s;
}
.cal-nav-btn:hover { background: var(--border) }

.day-panel {
  position: absolute;
  right: 0; top: 57px;
  width: 280px;
  height: calc(100% - 57px);
  background: var(--surface);
  border-left: 1px solid var(--border);
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 10;
}
.day-panel.hidden { display: none }
.day-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 4px;
}

.day-event-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  background: var(--surface2);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}
.day-event-color { width: 3px; min-height: 36px; border-radius: 2px; flex-shrink: 0 }
.day-event-body { flex: 1; min-width: 0 }
.day-event-title { font-size: 13px; font-weight: 500 }
.day-event-time { font-size: 11.5px; color: var(--text-sub); margin-top: 2px }
.day-event-desc { font-size: 11.5px; color: var(--text-sub); margin-top: 3px }
.day-event-actions { display: flex; flex-direction: column; gap: 2px; flex-shrink: 0 }

/* ── Notes layout ── */
.notes-layout { display: flex; flex: 1; overflow: hidden }

.notes-list-panel {
  width: 240px;
  border-right: 1px solid var(--border);
  overflow-y: auto;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 8px;
  background: var(--surface);
}

.note-list-item {
  padding: 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background .15s;
  border-left: 3px solid transparent;
}
.note-list-item:hover { background: var(--surface2) }
.note-list-item.active {
  background: var(--surface2);
  border-left-color: var(--accent);
}
.note-list-title {
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.note-list-meta { font-size: 11px; color: var(--text-dim); margin: 2px 0 }
.note-list-preview { font-size: 12px; color: var(--text-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis }

.note-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.note-editor.hidden { display: none }

.note-editor-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.note-title-input {
  flex: 1;
  background: none;
  border: none;
  color: var(--text);
  font-size: 17px;
  font-weight: 700;
  outline: none;
}
.note-title-input::placeholder { color: var(--text-dim) }
.note-editor-actions { display: flex; gap: 6px; flex-shrink: 0 }

.note-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 7px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.tool-btn {
  width: 28px; height: 28px;
  background: none;
  border: 1px solid transparent;
  border-radius: 5px;
  color: var(--text-sub);
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .12s, color .12s, border-color .12s;
}
.tool-btn:hover { background: var(--surface2); color: var(--text); border-color: var(--border) }
.tool-sep { width: 1px; height: 18px; background: var(--border); margin: 0 4px }
.tool-select {
  background: var(--surface2);
  border: 1px solid var(--border);
  color: var(--text-sub);
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 5px;
  cursor: pointer;
  outline: none;
  margin-left: 4px;
}

.note-content {
  flex: 1;
  padding: 20px 24px;
  overflow-y: auto;
  outline: none;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text);
  user-select: text;
  -webkit-user-select: text;
}
.note-content[data-placeholder]:empty::before {
  content: attr(data-placeholder);
  color: var(--text-dim);
}
.note-content h2 { font-size: 17px; font-weight: 700; margin: 16px 0 8px }
.note-content ul, .note-content ol { padding-left: 20px; margin: 6px 0 }
.note-content li { margin: 3px 0 }
.note-content b, .note-content strong { font-weight: 700 }
.note-content i, .note-content em { font-style: italic }
.note-content u { text-decoration: underline }

.note-status { font-size: 11px; color: var(--text-dim); padding: 4px 24px 8px; text-align: right; flex-shrink: 0 }

.note-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  text-align: center;
  gap: 4px;
}
.note-empty.hidden { display: none }

.nb-dot-sm { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; display: inline-block; vertical-align: middle }

/* ── Modal ── */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  backdrop-filter: blur(4px);
}
.modal-overlay.hidden { display: none }
.modal {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  width: 440px;
  max-width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 24px 80px rgba(0,0,0,.5);
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.modal-title { font-size: 15px; font-weight: 700 }
.modal-close {
  background: none;
  border: none;
  color: var(--text-sub);
  cursor: pointer;
  padding: 4px;
  border-radius: 5px;
  transition: color .12s, background .12s;
}
.modal-close:hover { color: var(--text); background: var(--surface2) }
.modal-body { padding: 16px 20px }

/* ── Forms ── */
.form-group { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px }
.form-group label { font-size: 12px; font-weight: 600; color: var(--text-sub); text-transform: uppercase; letter-spacing: .04em }
.form-input {
  background: var(--surface2);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 13.5px;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color .15s;
  width: 100%;
  font-family: inherit;
}
.form-input:focus { border-color: var(--accent) }
.form-textarea { resize: vertical; min-height: 70px }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px }

/* ── Category picker ── */
.cat-picker { display: flex; flex-wrap: wrap; gap: 6px }
.cat-opt { cursor: pointer }
.cat-opt input { display: none }
.cat-pill {
  display: block;
  padding: 4px 11px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  opacity: .5;
  transition: opacity .15s, transform .12s;
  cursor: pointer;
}
.cat-opt input:checked + .cat-pill { opacity: 1; transform: scale(1.05) }

/* ── Color picker (notebooks) ── */
.color-picker { display: flex; gap: 8px; flex-wrap: wrap }
.color-opt { cursor: pointer }
.color-opt input { display: none }
.color-dot {
  display: block;
  width: 22px; height: 22px;
  border-radius: 50%;
  opacity: .5;
  transition: opacity .15s, transform .12s;
  cursor: pointer;
  outline: 2px solid transparent;
  outline-offset: 2px;
}
.color-opt input:checked + .color-dot { opacity: 1; transform: scale(1.15); outline-color: var(--text) }

/* ── Toast ── */
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--surface2);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  padding: 10px 20px;
  border-radius: 20px;
  box-shadow: 0 8px 32px rgba(0,0,0,.4);
  z-index: 200;
  pointer-events: none;
}
.toast.hidden { display: none }
`)

// ─── renderer/app.js ──────────────────────────────────────────────────────────
const appJs = fs.readFileSync(__dirname + '/renderer/app.js', 'utf8')
write('renderer/app.js', appJs)

console.log('\n  ZR-AGENDA deploye avec succes dans ' + DEST)
console.log('\n  Pour lancer :')
console.log('  cd "' + DEST + '"')
console.log('  npm install')
console.log('  npm start')
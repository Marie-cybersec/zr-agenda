const { app, BrowserWindow, ipcMain, dialog, shell, screen, Notification, Tray, Menu, nativeImage, net, powerMonitor } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const os = require('os')
const storage = require('./storage')

const DATA_DIR = process.env.ZR_DATA_DIR || path.join(os.homedir(), '.zr_agenda')
const DATA_FILE = path.join(DATA_DIR, 'data.enc')
const KEY_FILE = path.join(DATA_DIR, 'key.dat')
const VAULT_FILE = path.join(DATA_DIR, 'vault.json')
const WINDOW_FILE = path.join(DATA_DIR, 'window.json')
const PREFS_FILE = path.join(DATA_DIR, 'prefs.json')
const BACKUP_DIR = path.join(DATA_DIR, 'backups')
const BACKUP_KEEP = 30
const ICON = path.join(__dirname, 'assets', 'icon.png')

fs.mkdirSync(BACKUP_DIR, { recursive: true })

if (!app.requestSingleInstanceLock()) app.quit()
app.setAppUserModelId('com.bmmsystems.zr-agenda')

// Préférences système non sensibles, lisibles avant le déverrouillage (démarrage, zone de notification).
let prefs = { runInBackground: true, launchAtLogin: false, ...storage.readJson(PREFS_FILE, {}) }

// ─── Chiffrement ─────────────────────────────────────────────────────────────

let key = null

const readVault = () => storage.readJson(VAULT_FILE, { mode: 'keyfile' })
const writeVault = v => fs.writeFileSync(VAULT_FILE, JSON.stringify(v, null, 2))

function initKey() {
  if (readVault().mode === 'password') return
  if (fs.existsSync(KEY_FILE)) {
    key = fs.readFileSync(KEY_FILE)
  } else {
    key = crypto.randomBytes(32)
    fs.writeFileSync(KEY_FILE, key, { mode: 0o600 })
  }
}

const readDb = () => storage.readDb(DATA_FILE, key)
const writeDb = obj => storage.writeDb(DATA_FILE, key, obj)

function dailyBackup() {
  try { storage.dailyBackup(DATA_FILE, BACKUP_DIR, BACKUP_KEEP) } catch (e) { console.error('Sauvegarde impossible :', e.message) }
}

initKey()
if (key) dailyBackup()

// ─── Fenêtre ─────────────────────────────────────────────────────────────────

let win
let tray = null
let quitting = false
let trayHintShown = false
const startHidden = process.argv.includes('--hidden')

function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(WINDOW_FILE, 'utf8'))
    const visible = screen.getAllDisplays().some(d =>
      b.x < d.bounds.x + d.bounds.width && b.x + b.width > d.bounds.x &&
      b.y < d.bounds.y + d.bounds.height && b.y + b.height > d.bounds.y)
    return visible ? b : null
  } catch { return null }
}

function showWindow() {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow() {
  const b = loadBounds()
  win = new BrowserWindow({
    width: b?.width || 1440,
    height: b?.height || 900,
    x: b?.x, y: b?.y,
    minWidth: 1024,
    minHeight: 680,
    frame: false,
    show: false,
    backgroundColor: '#0E0E10',
    title: 'ZR Agenda',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      // Les rappels sont vérifiés par une minuterie : elle ne doit pas être ralentie fenêtre masquée.
      backgroundThrottling: false
    }
  })
  if (b?.maximized) win.maximize()
  win.once('ready-to-show', () => { if (!(startHidden && prefs.runInBackground)) win.show() })
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  win.webContents.session.setSpellCheckerLanguages(['fr', 'en-US'])
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) || url.startsWith('mailto:')) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', e => e.preventDefault())

  const sendMax = () => win.webContents.send('win:maximized', win.isMaximized())
  win.on('maximize', sendMax)
  win.on('unmaximize', sendMax)
  win.on('close', e => {
    try {
      fs.writeFileSync(WINDOW_FILE, JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }))
    } catch {}
    // Rester dans la zone de notification pour que les rappels continuent de partir.
    if (!quitting && prefs.runInBackground) {
      e.preventDefault()
      win.hide()
      if (!trayHintShown && Notification.isSupported()) {
        trayHintShown = true
        new Notification({ title: 'ZR Agenda reste actif', body: 'Les rappels continuent depuis la zone de notification. Clic droit sur l\'icône pour quitter.', icon: ICON, silent: true }).show()
      }
    }
  })
  if (prefs.runInBackground) createTray()
}

function createTray() {
  if (tray || !fs.existsSync(ICON)) return
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }))
  tray.setToolTip('ZR Agenda')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir ZR Agenda', click: showWindow },
    { type: 'separator' },
    { label: 'Quitter', click: () => { quitting = true; app.quit() } }
  ]))
  tray.on('click', showWindow)
}

function destroyTray() {
  if (tray) { tray.destroy(); tray = null }
}

function applyLoginItem() {
  const args = app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden']
  try { app.setLoginItemSettings({ openAtLogin: !!prefs.launchAtLogin, args }) } catch (e) { console.error('Démarrage automatique :', e.message) }
}

app.on('second-instance', showWindow)
app.on('before-quit', () => { quitting = true })
app.whenReady().then(() => {
  createWindow()
  // Après une mise en veille, vérifier immédiatement les rappels en retard.
  powerMonitor.on('resume', () => win && win.webContents.send('system:resume'))
  powerMonitor.on('unlock-screen', () => win && win.webContents.send('system:resume'))
})
app.on('window-all-closed', () => app.quit())

// ─── IPC : fenêtre ───────────────────────────────────────────────────────────

ipcMain.on('win:minimize', () => win.minimize())
ipcMain.on('win:maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize())
ipcMain.on('win:close', () => win.close())
ipcMain.on('win:focus', showWindow)
ipcMain.handle('win:is-maximized', () => win.isMaximized())

// ─── IPC : préférences système ───────────────────────────────────────────────

ipcMain.handle('app:prefs', (_, patch) => {
  if (patch && typeof patch === 'object') {
    const next = { ...prefs }
    if ('runInBackground' in patch) next.runInBackground = !!patch.runInBackground
    if ('launchAtLogin' in patch) next.launchAtLogin = !!patch.launchAtLogin
    const loginChanged = next.launchAtLogin !== prefs.launchAtLogin
    prefs = next
    try { fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2)) } catch {}
    if (prefs.runInBackground) createTray(); else destroyTray()
    if (loginChanged) applyLoginItem()
  }
  return prefs
})

// ─── IPC : notifications Windows ─────────────────────────────────────────────
// Toasts natifs. Une alarme reste affichée jusqu'à action (timeoutType « never »).
// Windows peut les masquer (mode Ne pas déranger / Assistant de concentration) : rien ne peut le contourner.

const liveNotifications = new Set()

ipcMain.handle('notify', (_, { title, body, alarm, silent, tag }) => {
  if (!Notification.isSupported()) return false
  const n = new Notification({
    title: String(title || 'ZR Agenda').slice(0, 120),
    body: String(body || '').slice(0, 300),
    icon: fs.existsSync(ICON) ? ICON : undefined,
    silent: silent !== false,
    timeoutType: alarm ? 'never' : 'default',
    urgency: alarm ? 'critical' : 'normal'
  })
  liveNotifications.add(n)
  const release = () => liveNotifications.delete(n)
  n.on('click', () => { showWindow(); win && win.webContents.send('notify:click', tag || null); release() })
  n.on('close', release)
  n.on('failed', release)
  n.show()
  return true
})

// ─── IPC : réseau (météo) ────────────────────────────────────────────────────
// Seuls les services Open-Meteo sont joignables ; la page n'a aucun accès réseau direct (CSP).

const ALLOWED_HOSTS = new Set(['api.open-meteo.com', 'geocoding-api.open-meteo.com'])

ipcMain.handle('net:get-json', async (_, url) => {
  let u
  try { u = new URL(url) } catch { return { ok: false, error: 'url' } }
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) return { ok: false, error: 'interdit' }
  if (!net.isOnline()) return { ok: false, error: 'offline' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10000)
  try {
    const r = await net.fetch(u.toString(), { signal: ctrl.signal })
    if (!r.ok) return { ok: false, error: 'http ' + r.status }
    return { ok: true, data: await r.json() }
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'délai dépassé' : net.isOnline() ? 'réseau' : 'offline' }
  } finally {
    clearTimeout(timer)
  }
})

ipcMain.handle('net:online', () => net.isOnline())

// ─── IPC : coffre et données ─────────────────────────────────────────────────

ipcMain.handle('vault:status', () => ({ locked: !key, mode: readVault().mode }))

ipcMain.handle('vault:unlock', (_, password) => {
  const v = readVault()
  if (v.mode !== 'password') return true
  try {
    const k = storage.deriveKey(password, v.salt)
    if (fs.existsSync(DATA_FILE)) storage.decrypt(fs.readFileSync(DATA_FILE), k)
    key = k
    dailyBackup()
    return true
  } catch {
    return false
  }
})

ipcMain.handle('vault:lock', () => {
  if (readVault().mode === 'password') key = null
  return !key
})

ipcMain.handle('vault:set-password', (_, current, next) => {
  const v = readVault()
  if (!key) return { ok: false, error: 'locked' }
  if (v.mode === 'password') {
    try {
      if (!crypto.timingSafeEqual(storage.deriveKey(current || '', v.salt), key)) return { ok: false, error: 'wrong' }
    } catch { return { ok: false, error: 'wrong' } }
  }
  const data = readDb()
  if (next) {
    const salt = crypto.randomBytes(16).toString('hex')
    key = storage.deriveKey(next, salt)
    if (data) writeDb(data)
    writeVault({ mode: 'password', salt })
    if (fs.existsSync(KEY_FILE)) fs.unlinkSync(KEY_FILE)
  } else {
    key = crypto.randomBytes(32)
    fs.writeFileSync(KEY_FILE, key, { mode: 0o600 })
    if (data) writeDb(data)
    writeVault({ mode: 'keyfile' })
  }
  return { ok: true }
})

ipcMain.handle('db:load', () => {
  if (!key) return { error: 'locked' }
  try { return { data: readDb() } } catch (e) { return { error: 'corrupt', message: e.message } }
})

ipcMain.handle('db:save', (_, data) => {
  if (!key) return false
  writeDb(data)
  return true
})

ipcMain.on('db:save-sync', (e, data) => {
  try { if (key) writeDb(data) } catch {}
  e.returnValue = true
})

// ─── IPC : fichiers ──────────────────────────────────────────────────────────

ipcMain.handle('file:save', async (_, { defaultPath, filters, content }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath, filters })
  if (r.canceled || !r.filePath) return null
  fs.writeFileSync(r.filePath, content, 'utf8')
  return r.filePath
})

ipcMain.handle('file:open', async (_, { filters }) => {
  const r = await dialog.showOpenDialog(win, { filters, properties: ['openFile'] })
  if (r.canceled || !r.filePaths.length) return null
  return { path: r.filePaths[0], content: fs.readFileSync(r.filePaths[0], 'utf8') }
})

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  dataDir: DATA_DIR,
  electron: process.versions.electron,
  backups: fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('data-')).length,
  notifications: Notification.isSupported(),
  platform: process.platform
}))

ipcMain.on('app:open-data-dir', () => shell.openPath(DATA_DIR))

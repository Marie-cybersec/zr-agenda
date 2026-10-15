const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const os = require('os')

const DATA_DIR = process.env.ZR_DATA_DIR || path.join(os.homedir(), '.zr_agenda')
const DATA_FILE = path.join(DATA_DIR, 'data.enc')
const KEY_FILE = path.join(DATA_DIR, 'key.dat')
const VAULT_FILE = path.join(DATA_DIR, 'vault.json')
const WINDOW_FILE = path.join(DATA_DIR, 'window.json')
const BACKUP_DIR = path.join(DATA_DIR, 'backups')
const BACKUP_KEEP = 30

fs.mkdirSync(BACKUP_DIR, { recursive: true })

if (!app.requestSingleInstanceLock()) app.quit()
app.setAppUserModelId('com.bmmsystems.zr-agenda')

// â”€â”€â”€ Chiffrement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Format du fichier : iv (12 octets) | tag (16 octets) | contenu AES-256-GCM

let key = null

function readVault() {
  try { return JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8')) } catch { return { mode: 'keyfile' } }
}

function writeVault(v) {
  fs.writeFileSync(VAULT_FILE, JSON.stringify(v, null, 2))
}

function encrypt(obj, k) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv)
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct])
}

function decrypt(buf, k) {
  const dec = crypto.createDecipheriv('aes-256-gcm', k, buf.subarray(0, 12))
  dec.setAuthTag(buf.subarray(12, 28))
  return JSON.parse(Buffer.concat([dec.update(buf.subarray(28)), dec.final()]).toString('utf8'))
}

function deriveKey(password, saltHex) {
  return crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 })
}

function initKey() {
  if (readVault().mode === 'password') return
  if (fs.existsSync(KEY_FILE)) {
    key = fs.readFileSync(KEY_FILE)
  } else {
    key = crypto.randomBytes(32)
    fs.writeFileSync(KEY_FILE, key, { mode: 0o600 })
  }
}

function readDb() {
  if (!fs.existsSync(DATA_FILE)) return null
  return decrypt(fs.readFileSync(DATA_FILE), key)
}

function writeDb(obj) {
  const tmp = DATA_FILE + '.tmp'
  fs.writeFileSync(tmp, encrypt(obj, key))
  fs.renameSync(tmp, DATA_FILE)
}

function dailyBackup() {
  try {
    if (!fs.existsSync(DATA_FILE)) return
    const dest = path.join(BACKUP_DIR, 'data-' + new Date().toISOString().slice(0, 10) + '.enc')
    if (!fs.existsSync(dest)) fs.copyFileSync(DATA_FILE, dest)
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('data-')).sort()
    while (files.length > BACKUP_KEEP) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()))
  } catch (e) {
    console.error('Sauvegarde impossible :', e.message)
  }
}

initKey()
if (key) dailyBackup()

// â”€â”€â”€ FenÃªtre â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let win

function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(WINDOW_FILE, 'utf8'))
    const visible = screen.getAllDisplays().some(d =>
      b.x < d.bounds.x + d.bounds.width && b.x + b.width > d.bounds.x &&
      b.y < d.bounds.y + d.bounds.height && b.y + b.height > d.bounds.y)
    return visible ? b : null
  } catch { return null }
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
    icon: fs.existsSync(path.join(__dirname, 'assets', 'icon.png')) ? path.join(__dirname, 'assets', 'icon.png') : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })
  if (b?.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())
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
  win.on('close', () => {
    try {
      fs.writeFileSync(WINDOW_FILE, JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }))
    } catch {}
  })
}

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})
app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())

// â”€â”€â”€ IPC : fenÃªtre â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ipcMain.on('win:minimize', () => win.minimize())
ipcMain.on('win:maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize())
ipcMain.on('win:close', () => win.close())
ipcMain.on('win:focus', () => { if (win.isMinimized()) win.restore(); win.show(); win.focus() })
ipcMain.handle('win:is-maximized', () => win.isMaximized())

// â”€â”€â”€ IPC : coffre et donnÃ©es â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ipcMain.handle('vault:status', () => ({ locked: !key, mode: readVault().mode }))

ipcMain.handle('vault:unlock', (_, password) => {
  const v = readVault()
  if (v.mode !== 'password') return true
  try {
    const k = deriveKey(password, v.salt)
    if (fs.existsSync(DATA_FILE)) decrypt(fs.readFileSync(DATA_FILE), k)
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
      if (!crypto.timingSafeEqual(deriveKey(current || '', v.salt), key)) return { ok: false, error: 'wrong' }
    } catch { return { ok: false, error: 'wrong' } }
  }
  const data = readDb()
  if (next) {
    const salt = crypto.randomBytes(16).toString('hex')
    key = deriveKey(next, salt)
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

// â”€â”€â”€ IPC : fichiers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  backups: fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('data-')).length
}))

ipcMain.on('app:open-data-dir', () => shell.openPath(DATA_DIR))

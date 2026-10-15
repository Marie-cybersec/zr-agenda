// Stockage chiffré sur disque (processus principal). Sans dépendance à Electron : testé par tests/storage.test.cjs.
// Format du fichier : iv (12 octets) | tag (16 octets) | contenu AES-256-GCM

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function encrypt(obj, key) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct])
}

function decrypt(buf, key) {
  const dec = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12))
  dec.setAuthTag(buf.subarray(12, 28))
  return JSON.parse(Buffer.concat([dec.update(buf.subarray(28)), dec.final()]).toString('utf8'))
}

function deriveKey(password, saltHex) {
  return crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 })
}

// Écriture atomique : fichier temporaire synchronisé puis renommage.
// Une coupure pendant l'écriture laisse l'ancien fichier intact.
function writeAtomic(file, buf) {
  const tmp = file + '.tmp'
  const fd = fs.openSync(tmp, 'w')
  try { fs.writeSync(fd, buf); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, file)
}

function readDb(file, key) {
  if (!fs.existsSync(file)) return null
  return decrypt(fs.readFileSync(file), key)
}

function writeDb(file, key, obj) {
  writeAtomic(file, encrypt(obj, key))
}

// Copie quotidienne du fichier chiffré, rotation sur `keep` jours.
function dailyBackup(file, dir, keep = 30, now = new Date()) {
  if (!fs.existsSync(file)) return null
  fs.mkdirSync(dir, { recursive: true })
  const stamp = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
  const dest = path.join(dir, 'data-' + stamp + '.enc')
  if (!fs.existsSync(dest)) fs.copyFileSync(file, dest)
  const files = fs.readdirSync(dir).filter(f => /^data-\d{4}-\d{2}-\d{2}\.enc$/.test(f)).sort()
  while (files.length > keep) fs.unlinkSync(path.join(dir, files.shift()))
  return dest
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

module.exports = { encrypt, decrypt, deriveKey, writeAtomic, readDb, writeDb, dailyBackup, readJson }

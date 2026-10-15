// Persistance : chiffrement, écriture atomique, sauvegardes, migration après relecture.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { encrypt, decrypt, deriveKey, readDb, writeDb, dailyBackup } = require('../storage.js')

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zr-test-'))

test('chiffrement : aller-retour, accents et gros volume', () => {
  const key = crypto.randomBytes(32)
  const obj = { version: 3, journal: [{ content: 'Journée très réussie — été 🌞' }], big: 'x'.repeat(2_000_000) }
  assert.deepEqual(decrypt(encrypt(obj, key), key), obj)
})

test('chiffrement : mauvaise clé ou fichier altéré refusés', () => {
  const key = crypto.randomBytes(32)
  const buf = encrypt({ a: 1 }, key)
  assert.throws(() => decrypt(buf, crypto.randomBytes(32)))
  const bad = Buffer.from(buf); bad[bad.length - 1] ^= 1
  assert.throws(() => decrypt(bad, key))
})

test('mot de passe : dérivation déterministe par sel', () => {
  const salt = crypto.randomBytes(16).toString('hex')
  assert.ok(deriveKey('secret', salt).equals(deriveKey('secret', salt)))
  assert.ok(!deriveKey('secret', salt).equals(deriveKey('Secret', salt)))
})

test('écriture atomique : relecture fidèle, aucun fichier temporaire restant', () => {
  const dir = tmpDir()
  const file = path.join(dir, 'data.enc')
  const key = crypto.randomBytes(32)
  assert.equal(readDb(file, key), null)
  writeDb(file, key, { version: 3, tasks: [{ id: 't', title: 'Réviser' }] })
  writeDb(file, key, { version: 3, tasks: [{ id: 't', title: 'Réviser' }, { id: 'u', title: 'Rendre' }] })
  assert.equal(readDb(file, key).tasks.length, 2)
  assert.deepEqual(fs.readdirSync(dir), ['data.enc'])
})

test('écriture interrompue : le fichier précédent reste lisible', () => {
  const dir = tmpDir()
  const file = path.join(dir, 'data.enc')
  const key = crypto.randomBytes(32)
  writeDb(file, key, { version: 3, ok: true })
  // Simule un fichier temporaire tronqué laissé par une coupure de courant
  fs.writeFileSync(file + '.tmp', Buffer.from([1, 2, 3]))
  assert.equal(readDb(file, key).ok, true)
  writeDb(file, key, { version: 3, ok: 2 })
  assert.equal(readDb(file, key).ok, 2)
})

test('sauvegardes quotidiennes : une par jour, rotation', () => {
  const dir = tmpDir()
  const file = path.join(dir, 'data.enc')
  const backups = path.join(dir, 'backups')
  writeDb(file, crypto.randomBytes(32), { v: 1 })
  assert.equal(dailyBackup(path.join(dir, 'absent.enc'), backups), null)
  for (let i = 1; i <= 35; i++) dailyBackup(file, backups, 30, new Date(2026, 9, i))
  dailyBackup(file, backups, 30, new Date(2026, 10, 4))
  const list = fs.readdirSync(backups).sort()
  assert.equal(list.length, 30)
  assert.equal(list[list.length - 1], 'data-2026-11-04.enc')
  assert.equal(list[0], 'data-2026-10-06.enc')
})

test('persistance de bout en bout : migration puis relecture identique', async () => {
  const { migrate } = await import('../renderer/js/core/model.js')
  const dir = tmpDir()
  const file = path.join(dir, 'data.enc')
  const key = crypto.randomBytes(32)
  writeDb(file, key, { version: 2, calendars: [], events: [{ id: 'e', title: 'Cours', start: '2026-10-15T09:00', end: '2026-10-15T10:00' }], tasks: [], notes: [], notebooks: [], settings: {} })
  const d = migrate(readDb(file, key))
  d.habits.push({ id: 'h', name: 'Lire', schedule: { type: 'daily' } })
  d.habitLogs.h = { '2026-10-15': 1 }
  d.journal.push({ id: 'j', date: '2026-10-15', content: 'Première entrée' })
  writeDb(file, key, d)
  const back = migrate(readDb(file, key))
  assert.deepEqual(back, d)
  assert.equal(back.events[0].title, 'Cours')
})

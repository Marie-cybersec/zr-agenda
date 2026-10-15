// Lance la suite de tests sous plusieurs fuseaux horaires (changements d'heure opposés, demi-heures, UTC).
// Usage : npm test            → tous les fuseaux
//         npm test -- UTC     → un seul fuseau

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const zones = process.argv.slice(2).length ? process.argv.slice(2) : ['Europe/Paris', 'America/New_York', 'Pacific/Auckland', 'America/St_Johns', 'UTC']
const files = readdirSync(join(root, 'tests')).filter(f => /\.test\.(mjs|cjs)$/.test(f)).map(f => join('tests', f))

let failed = 0
for (const tz of zones) {
  const probe = spawnSync(process.execPath, ['-e', 'process.stdout.write(Intl.DateTimeFormat().resolvedOptions().timeZone)'], { env: { ...process.env, TZ: tz }, encoding: 'utf8' })
  if (probe.stdout.trim() !== new Intl.DateTimeFormat('en', { timeZone: tz }).resolvedOptions().timeZone) {
    console.error(`Fuseau ${tz} non appliqué (obtenu : ${probe.stdout.trim()})`)
    failed++
    continue
  }
  console.log(`\n━━ Fuseau ${tz} ━━`)
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=dot', ...files], { cwd: root, env: { ...process.env, TZ: tz }, stdio: 'inherit' })
  if (r.status !== 0) failed++
}
console.log(failed ? `\n${failed} fuseau(x) en échec` : `\nTous les tests passent dans ${zones.length} fuseau(x).`)
process.exit(failed ? 1 : 0)

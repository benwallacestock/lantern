#!/usr/bin/env node
// Cutting a release: `npm run release -- 0.2.0` (or patch | minor | major).
//   - the tree must be clean and on main, with something under "Unreleased" in CHANGELOG.md
//   - that section moves under "## 0.2.0 — <today>", package.json is bumped, and it is committed, tagged v0.2.0 and pushed
//   - the Release workflow then runs the tests and publishes a GitHub Release with those notes
// `node scripts/release.ts notes 0.2.0` prints the notes for a version (the workflow uses it).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim()
const die = (m: string): never => { console.error(m); process.exit(1) }
const CHANGELOG = 'CHANGELOG.md'

/** The body of one version's section (or Unreleased) in the changelog. */
function section(log: string, heading: RegExp): { body: string; start: number; end: number } | null {
  const lines = log.split('\n')
  const start = lines.findIndex((l) => heading.test(l))
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) if (/^## /.test(lines[i])) { end = i; break }
  return { body: lines.slice(start + 1, end).join('\n').trim(), start, end }
}

const [cmd, arg] = process.argv.slice(2)
const log = fs.readFileSync(CHANGELOG, 'utf8')

if (cmd === 'notes') {
  const s = section(log, new RegExp(`^## ${arg?.replace(/\./g, '\\.')}\\b`))
  if (!s) die(`no section for ${arg} in ${CHANGELOG}`)
  console.log(s!.body)
  process.exit(0)
}

const want = cmd
if (!want) die('usage: npm run release -- <version | patch | minor | major>')
if (sh('git', ['status', '--porcelain'])) die('the tree is not clean: commit or stash first')
if (sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') die('release from main')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const [ma, mi, pa] = pkg.version.split('.').map(Number)
const version = /^\d+\.\d+\.\d+$/.test(want) ? want : want === 'major' ? `${ma + 1}.0.0` : want === 'minor' ? `${ma}.${mi + 1}.0` : want === 'patch' ? `${ma}.${mi}.${pa + 1}` : die(`not a version: ${want}`)
const un = section(log, /^## Unreleased/)
if (!un) die(`${CHANGELOG} has no "## Unreleased" section`)
if (!un!.body) die('nothing under Unreleased: write the changelog first')
if (new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b`, 'm').test(log)) die(`${version} is already in the changelog`)

const today = new Date().toISOString().slice(0, 10)
const lines = log.split('\n')
lines.splice(un!.start, un!.end - un!.start, '## Unreleased', '', `## ${version} — ${today}`, '', un!.body, '')
fs.writeFileSync(CHANGELOG, lines.join('\n').replace(/\n{3,}/g, '\n\n'))
pkg.version = version
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')
try { const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8')); lock.version = version; if (lock.packages?.['']) lock.packages[''].version = version; fs.writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\n') } catch {}
sh('git', ['add', CHANGELOG, 'package.json', 'package-lock.json'])
sh('git', ['commit', '-q', '-m', `lantern ${version}`])
sh('git', ['tag', '-a', `v${version}`, '-m', `lantern ${version}`])
console.log(`lantern ${version}: committed and tagged v${version}\n\n${un!.body}\n`)
sh('git', ['push', '-q'])
sh('git', ['push', '-q', 'origin', `v${version}`])
console.log(`pushed — the Release workflow will publish https://github.com/benwallacestock/lantern/releases/tag/v${version} and lantern-browser@${version} on npm`)

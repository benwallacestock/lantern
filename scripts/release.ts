#!/usr/bin/env node
// Every push to main is a release, and the commits decide the version — no one picks a number.
//
//   feat: …                      a minor bump (0.2.1 → 0.3.0): something new
//   fix: … / perf: … / anything else that changes the program   a patch (0.2.1 → 0.2.2)
//   feat!: … or "BREAKING CHANGE" in the body   a major bump once past 1.0; a minor before it
//   docs: / chore: / ci: / test: / style: / build:   no release (nothing a user of the CLI would notice)
//
// The subjects become the release notes, grouped Added / Fixed / Changed, under the version in CHANGELOG.md ("- "
// lines in a commit's body come along as sub-points). Then package.json, package-lock.json and the Claude plugin's
// version are bumped, it is committed as "lantern x.y.z", tagged vx.y.z and pushed, and the workflow that ran this
// publishes the GitHub Release and the npm package. `node scripts/release.ts auto --dry` shows what would happen.
// `node scripts/release.ts 1.0.0` forces a version (for 1.0). `node scripts/release.ts notes 0.3.0` prints a version's notes.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

export type Commit = { subject: string; body: string }
export type Kind = 'major' | 'minor' | 'patch' | null

const SKIP = new Set(['docs', 'chore', 'ci', 'test', 'tests', 'style', 'build', 'changelog', 'release'])
const parse = (subject: string) => { const m = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/.exec(subject); return m ? { type: m[1].toLowerCase(), scope: m[2] ?? '', bang: !!m[3], text: m[4] } : { type: '', scope: '', bang: false, text: subject } }

/** What a commit asks for: a major, minor or patch bump, or nothing. */
export function kindOf(c: Commit): Kind {
  if (/^lantern \d+\.\d+\.\d+$/.test(c.subject) || /^Merge /.test(c.subject)) return null
  const { type, bang } = parse(c.subject)
  if (bang || /BREAKING[ -]CHANGE/.test(c.body)) return 'major'
  if (type === 'feat') return 'minor'
  if (SKIP.has(type)) return null
  return 'patch'
}

/** The next version after `current` for these commits, or null when none of them is a release. Before 1.0 a breaking change is a minor bump: 1.0 is chosen by hand. */
export function bump(current: string, commits: Commit[]): string | null {
  const kinds = commits.map(kindOf)
  const [ma, mi, pa] = current.split('.').map(Number)
  let kind: Kind = kinds.includes('major') ? 'major' : kinds.includes('minor') ? 'minor' : kinds.includes('patch') ? 'patch' : null
  if (kind === 'major' && ma === 0) kind = 'minor'
  return kind === 'major' ? `${ma + 1}.0.0` : kind === 'minor' ? `${ma}.${mi + 1}.0` : kind === 'patch' ? `${ma}.${mi}.${pa + 1}` : null
}

/** The notes for these commits: Added (feat), Fixed (fix), Changed (the rest), one line per commit from its subject,
 * with any "- " lines in the body under it as sub-points. */
export function notes(commits: Commit[]): string {
  const groups: Record<string, string[]> = { Added: [], Fixed: [], Changed: [] }
  for (const c of commits) {
    if (!kindOf(c)) continue
    const { type, scope, text } = parse(c.subject)
    const line = (scope ? `${scope}: ` : '') + text.replace(/\.$/, '')
    const points = c.body.split('\n').map((l) => l.trim()).filter((l) => /^[-*] /.test(l)).map((l) => `  - ${l.slice(2)}`)
    ;(type === 'feat' ? groups.Added : type === 'fix' ? groups.Fixed : groups.Changed).push([`- ${line[0].toUpperCase()}${line.slice(1)}`, ...points].join('\n'))
  }
  return Object.entries(groups).filter(([, l]) => l.length).map(([h, l]) => `### ${h}\n${l.join('\n')}`).join('\n\n')
}

// ---- the command

const CHANGELOG = 'CHANGELOG.md'
const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim()
const die = (m: string): never => { console.error(m); process.exit(1) }

/** One section of the changelog: its body and where it sits. */
function section(log: string, heading: RegExp): { body: string; start: number; end: number } | null {
  const lines = log.split('\n')
  const start = lines.findIndex((l) => heading.test(l))
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) if (/^## /.test(lines[i])) { end = i; break }
  return { body: lines.slice(start + 1, end).join('\n').trim(), start, end }
}

/** The commits since the last release tag (all of them, when there is none). */
function commitsSinceLastTag(): { since: string; commits: Commit[] } {
  let since = ''; try { since = sh('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*']) } catch {}
  const raw = sh('git', ['log', since ? `${since}..HEAD` : 'HEAD', '--no-merges', '--format=%s%x1f%b%x1e'])
  const commits = raw.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => { const [subject, body = ''] = r.split('\x1f'); return { subject: subject.trim(), body } })
  return { since, commits }
}

function setVersion(version: string) {
  const bumpJson = (file: string, set: (j: any) => void) => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); set(j); fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n') } catch {} }
  bumpJson('package.json', (j) => { j.version = version })
  bumpJson('package-lock.json', (j) => { j.version = version; if (j.packages?.['']) j.packages[''].version = version })
  bumpJson('.claude-plugin/plugin.json', (j) => { j.version = version }) // plugin users get an update only when this moves
}

function main() {
  const [cmd, ...flags] = process.argv.slice(2)
  const log = fs.readFileSync(CHANGELOG, 'utf8')
  if (cmd === 'notes') {
    const s = section(log, new RegExp(`^## ${flags[0]?.replace(/\./g, '\\.')}\\b`))
    if (!s) die(`no section for ${flags[0]} in ${CHANGELOG}`)
    console.log(s!.body); return
  }
  if (!cmd) die('usage: node scripts/release.ts auto [--dry] | <x.y.z> [--dry] | notes <x.y.z>')
  const dry = flags.includes('--dry')
  if (!dry && sh('git', ['status', '--porcelain'])) die('the tree is not clean: commit first')
  if (!dry && sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') die('release from main')
  const current = String(JSON.parse(fs.readFileSync('package.json', 'utf8')).version)
  const { since, commits } = commitsSinceLastTag()
  const version = cmd === 'auto' ? bump(current, commits) : /^\d+\.\d+\.\d+$/.test(cmd) ? cmd : die(`not a version: ${cmd}`)
  const out = (k: string, v: string) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`) }
  if (!version) { console.log(`nothing to release: ${commits.length} commit(s) since ${since || 'the start'}, none of them feat/fix or a change to the program`); out('version', ''); return }
  if (new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b`, 'm').test(log)) die(`${version} is already in ${CHANGELOG}`)
  const body = notes(commits)
  if (!body) die('no notes: no releasable commits')
  console.log(`lantern ${current} → ${version} (${commits.length} commit(s) since ${since || 'the start'})\n\n${body}\n`)
  if (dry) { console.log('(dry run: nothing written)'); return }
  const today = new Date().toISOString().slice(0, 10)
  const lines = log.split('\n')
  const first = lines.findIndex((l) => /^## /.test(l))
  lines.splice(first < 0 ? lines.length : first, 0, `## ${version} — ${today}`, '', body, '')
  fs.writeFileSync(CHANGELOG, lines.join('\n').replace(/\n{3,}/g, '\n\n'))
  fs.writeFileSync('notes.md', body + '\n') // for the GitHub Release; not committed
  setVersion(version)
  sh('git', ['add', CHANGELOG, 'package.json', 'package-lock.json', '.claude-plugin/plugin.json'])
  sh('git', ['commit', '-q', '-m', `lantern ${version}`])
  sh('git', ['tag', '-a', `v${version}`, '-m', `lantern ${version}`])
  sh('git', ['push', '-q'])
  sh('git', ['push', '-q', 'origin', `v${version}`])
  out('version', version)
  console.log(`committed, tagged v${version} and pushed`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) main()

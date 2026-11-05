// The release rules: which commits make a release, what version they make, and the notes they become. No git here.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bump, kindOf, notes, type Commit } from '../scripts/release.ts'

const c = (subject: string, body = ''): Commit => ({ subject, body })

test('what each commit asks for', () => {
  assert.equal(kindOf(c('feat: callouts beside an element')), 'minor')
  assert.equal(kindOf(c('feat(record): a banner on every video')), 'minor')
  assert.equal(kindOf(c('fix: the daemon goes 30 minutes after the last command')), 'patch')
  assert.equal(kindOf(c('perf: lighter frames while only watching')), 'patch')
  assert.equal(kindOf(c('Real-time clips, callouts placed where they cover least')), 'patch', 'a plain subject is a change to the program')
  assert.equal(kindOf(c('feat!: targets are refs only')), 'major')
  assert.equal(kindOf(c('fix: keys', 'Some words.\n\nBREAKING CHANGE: the keys bubble moved')), 'major')
  for (const s of ['docs: readme', 'chore: ignore tmp', 'ci: faster tests', 'test: the idle exit', 'style: semicolons', 'build: esbuild target', 'changelog: a stale line', 'lantern 0.2.0', 'Merge branch next']) assert.equal(kindOf(c(s)), null, s)
})

test('the version the commits make', () => {
  assert.equal(bump('0.2.1', [c('ci: x'), c('docs: y')]), null, 'nothing a user would notice: no release')
  assert.equal(bump('0.2.1', [c('fix: a'), c('chore: b')]), '0.2.2')
  assert.equal(bump('0.2.1', [c('fix: a'), c('feat: b')]), '0.3.0')
  assert.equal(bump('0.2.1', [c('feat!: a')]), '0.3.0', 'before 1.0 a breaking change is a minor bump')
  assert.equal(bump('1.4.2', [c('feat!: a')]), '2.0.0')
  assert.equal(bump('0.10.1', [c('fix: a'), c('feat: b', 'It is ready.\n\nRelease-As: 1.0.0\n')]), '1.0.0', 'a commit can ask for a version: how 1.0 is cut')
  assert.equal(bump('1.2.0', [c('fix: a', 'Release-As: 1.0.0')]), '1.2.1', 'never backwards')
  assert.equal(bump('0.10.1', [c('docs: a', 'Release-As: 1.0.0')]), null, 'and only on a commit that is a release')
  assert.equal(bump('1.4.2', [c('feat: a')]), '1.5.0')
  assert.equal(bump('1.4.2', [c('a plain change')]), '1.4.3')
})

test('the notes: grouped, one line per commit, body bullets as sub-points', () => {
  const n = notes([c('feat(record): a banner on every video.', 'Some prose that stays out.\n\n- The mark sits at the right\n- A title adds the bar above\n\nCo-Authored-By: someone'), c('fix: the daemon goes when told'), c('docs: readme'), c('lantern 0.2.0'), c('scroll top and bottom')])
  assert.equal(n, ['### Added\n- Record: a banner on every video\n  - The mark sits at the right\n  - A title adds the bar above', '### Fixed\n- The daemon goes when told', '### Changed\n- Scroll top and bottom'].join('\n\n'))
  assert.equal(notes([c('ci: x')]), '')
})

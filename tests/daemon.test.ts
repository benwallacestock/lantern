import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { execFile } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import { BIN, duration, firstLine, pause, pngSize, probe, setup, sh, type Run } from './helpers.ts'

let t: Awaited<ReturnType<typeof setup>>
let app: { url: string; close: () => void }, home = '', proj = ''
const lantern = (...a: string[]) => t.lantern(...a)
const lanternWith = (env: Record<string, string>, ...a: string[]) => t.lanternWith(env, ...a)
const ok = (...a: string[]) => t.ok(...a)
const bad = (...a: string[]) => t.bad(...a)

before(async () => { t = await setup(); ({ app, home, proj } = t) })
after(async () => { await t.teardown() })
test('help without a daemon', async () => { const out = await ok('help'); assert.match(out, /lantern open/); assert.ok(!fs.existsSync(path.join(home, 'run'))) })
test('status when not running', async () => { assert.match(await ok('status'), /not running/) })
test('open needs a full URL the first time', async () => { assert.match(await bad('open', '/'), /full URL/) })

test('tmp/lantern is excluded from git', () => { assert.match(fs.readFileSync(path.join(proj, '.git/info/exclude'), 'utf8'), /tmp\/lantern/) })
test('login with a form, and the session survives a restart of the daemon', async () => {
  await ok('open', app.url + '/secret'); assert.match(await ok('url'), /\/login/)
  await ok('fill', '#email', 'dev@example.com'); await ok('fill', '#password', 'secret'); await ok('click', 'text=Log in')
  assert.match(await ok('text'), /Welcome, dev/)
  await ok('close'); await pause(500)
  assert.match(await ok('status'), /not running/)
  await ok('open', app.url + '/secret')
  assert.match(await ok('text'), /Welcome, dev/)
})
test('input keeps working after a login navigation (no back-forward cache)', async () => {
  await ok('open', '/login'); await ok('fill', '#email', 'dev@example.com'); await ok('fill', '#password', 'secret'); await ok('click', 'text=Log in')
  await ok('wait', '3000') // the old document would be parked in the cache by now
  await ok('click', 'text=Poke'); assert.equal(await ok('text', '#poked'), 'poked')
  await ok('fill', '#poked', 'x').catch(() => {}) // not a field; just must not hang
})
test('the last page comes back after Chrome dies or the socket is lost', async () => {
  await ok('open', '/about')
  const chromePid = Number(/chrome pid (\d+)/.exec(await ok('status'))?.[1]); assert.ok(chromePid > 0)
  process.kill(chromePid, 'SIGKILL'); await pause(1500)
  const t = await ok('text'); assert.match(t, /the browser had been restarted; .*\/about was opened again/); assert.match(t, /About page/)
  const sock = path.join(home, 'run', fs.readdirSync(path.join(home, 'run')).find((f) => f.endsWith('.sock'))!)
  fs.rmSync(sock)
  assert.match(await ok('status'), /socket is gone/)
  const t2 = await ok('text'); assert.match(t2, /restarted/); assert.match(t2, /About page/)
  await ok('open', '/')
})
test('watch: a live preview page streams frames and actions', async () => {
  await ok('open', '/')
  const out = await ok('watch')
  const url = firstLine(out); assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/)
  const html = await (await fetch(url)).text(); assert.match(html, /\/stream/); assert.match(html, /\/events/)
  // The stream: the first frame comes at once (the last one painted), more as the page changes.
  const ac = new AbortController()
  const res = await fetch(url + 'stream', { signal: ac.signal })
  assert.match(res.headers.get('content-type') ?? '', /multipart\/x-mixed-replace/)
  const reader = res.body!.getReader()
  let got = Buffer.alloc(0)
  const whole = () => { const a = got.indexOf(Buffer.from([0xff, 0xd8, 0xff])); return a >= 0 && got.indexOf(Buffer.from([0xff, 0xd9]), a) > a } // a JPEG, start to end
  let poke: Promise<Run> = lantern('fill', '#name', 'watched')
  const t0 = Date.now()
  while (!whole() && Date.now() - t0 < 30_000) { const { value, done } = await reader.read(); if (done) break; got = Buffer.concat([got, Buffer.from(value)]); if (!whole()) poke = poke.then(() => lantern('fill', '#name', 'watched ' + got.length)) }
  ac.abort(); await poke
  assert.ok(whole(), `a whole JPEG arrived (${got.length} bytes)`)
  assert.match(got.toString('latin1'), /--frame\r\nContent-Type: image\/jpeg/)
  // The events: what the agent did, in words.
  const ac2 = new AbortController()
  const ev = await fetch(url + 'events', { signal: ac2.signal })
  const r2 = ev.body!.getReader(); let text = ''
  const poke2 = lantern('click', 'text=Estimate time')
  while (!/clicked/.test(text)) { const { value, done } = await r2.read(); if (done) break; text += Buffer.from(value).toString() }
  ac2.abort(); await poke2
  assert.match(text, /"did":"clicked \\"Estimate time\\""/)
})
test('idle exit: a watch tab left open does not keep the daemon alive', async () => {
  // Its own project, so its short idle window doesn't take the shared daemon down with it.
  const proj2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-idle-'))
  await sh('git', ['-C', proj2, 'init', '-q'])
  const run = (...args: string[]) => new Promise<Run>((res) => execFile(process.execPath, [BIN, ...args], { cwd: proj2, env: { ...process.env, LANTERN_HOME: home, LANTERN_IDLE_MS: '4000' }, timeout: 60_000 }, (e, so, se) => res({ ok: !e, out: (so + se).trim() })))
  try {
    const r = await run('open', app.url + '/'); assert.ok(r.ok, r.out)
    const url = firstLine((await run('watch')).out)
    const ac = new AbortController()
    const res = await fetch(url + 'stream', { signal: ac.signal }) // a tab watching, as one left open overnight
    const reading = res.body!.getReader().read()
    const pid = Number(/pid (\d+)/.exec((await run('status')).out)?.[1]); assert.ok(pid, 'status gives the pid')
    const alive = () => { try { process.kill(pid, 0); return true } catch { return false } }
    const t0 = Date.now()
    while (Date.now() - t0 < 20_000 && alive()) await pause(250) // no commands now: status would count as one
    assert.ok(!alive(), 'the daemon went on its own')
    assert.match((await run('status')).out, /not running/)
    await reading.catch(() => {}); ac.abort()
    const logs = fs.readdirSync(path.join(home, 'log')).map((f) => fs.readFileSync(path.join(home, 'log', f), 'utf8'))
    assert.ok(logs.some((l) => /shutting down: no command for 0 minutes/.test(l)), 'the log says why it went')
  } finally { fs.rmSync(proj2, { recursive: true, force: true }) }
})

test('an updated lantern restarts the daemon of the old one, page and all', async () => {
  const proj2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-upd-'))
  await sh('git', ['-C', proj2, 'init', '-q'])
  const runWith = (env: Record<string, string>, ...args: string[]) => new Promise<Run>((res) => execFile(process.execPath, [BIN, ...args], { cwd: proj2, env: { ...process.env, LANTERN_HOME: home, ...env }, timeout: 60_000 }, (e, so, se) => res({ ok: !e, out: (so + se).trim() })))
  const run = (...args: string[]) => runWith({ LANTERN_RETIRE_IDLE_MS: '0' }, ...args) // restart at once, as when the daemon has been idle
  try {
    const r = await run('open', app.url + '/about'); assert.ok(r.ok, r.out)
    const before = Number(/pid (\d+)/.exec((await run('status')).out)?.[1]); assert.ok(before)
    const build = fs.readdirSync(path.join(home, 'run')).find((f) => f.endsWith('.build') && fs.readFileSync(path.join(home, 'run', f), 'utf8') === fs.readFileSync(path.join(home, 'run', f), 'utf8') && fs.existsSync(path.join(home, 'run', f.replace('.build', '.pid'))) && Number(fs.readFileSync(path.join(home, 'run', f.replace('.build', '.pid')), 'utf8')) === before)!
    fs.writeFileSync(path.join(home, 'run', build), '0.0.1@1') // as if that daemon came from an earlier install
    const busy = await runWith({}, 'status'); assert.doesNotMatch(busy.out, /restarting/, 'a daemon in use is left alone: no restart under an agent mid-task'); assert.match(busy.out, new RegExp(`pid ${before}`))
    const s = await run('status'); assert.ok(s.ok, s.out)
    assert.match(s.out, /lantern was updated to \d+\.\d+\.\d+; restarting its browser/)
    const after = Number(/pid (\d+)/.exec(s.out)?.[1]); assert.ok(after && after !== before, `a new daemon (${before} → ${after})`)
    const t = await run('text'); assert.ok(t.ok, t.out) // the page it had comes back with the next command that needs one
    const again = await run('status'); assert.match(again.out, /\/about/); assert.doesNotMatch(again.out, /restarting/)
  } finally { await run('close'); fs.rmSync(proj2, { recursive: true, force: true }) }
})

test('skills install links the package skills where Claude and Codex read them — run through a symlink, as an installed lantern is', async () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-userhome-')); fs.mkdirSync(path.join(fakeHome, '.codex'))
  const link = path.join(fakeHome, 'lantern'); fs.symlinkSync(BIN, link) // <prefix>/bin/lantern is a symlink to the bundle: the package must be found through it
  const run = (...args: string[]) => new Promise<Run>((res) => execFile(process.execPath, [link, ...args], { cwd: proj, env: { ...process.env, LANTERN_HOME: home, HOME: fakeHome, USERPROFILE: fakeHome }, timeout: 30_000 }, (e, so, se) => res({ ok: !e, out: (so + se).trim() })))
  try {
    assert.match((await run('version')).out, /^lantern \d+\.\d+\.\d+/, 'the version is read through the symlink')
    const r = await run('skills', 'install'); assert.ok(r.ok, r.out)
    assert.match(r.out, /Claude Code: lantern, lantern-demo-video, lantern-verify linked into/); assert.match(r.out, /Codex: /)
    for (const agent of ['.claude', '.codex']) for (const n of ['lantern', 'lantern-demo-video', 'lantern-verify']) {
      const link = path.join(fakeHome, agent, 'skills', n); assert.ok(fs.lstatSync(link).isSymbolicLink(), `${link} is a link`); assert.ok(fs.existsSync(path.join(link, 'SKILL.md')), `${link} resolves`)
    }
    assert.match((await run('skills')).out, /lantern → this lantern/)
    const again = await run('skills', 'install'); assert.ok(again.ok, 'installing twice is fine: ' + again.out)
  } finally { fs.rmSync(fakeHome, { recursive: true, force: true }) }
})

test('update: asks the registry, says what is out, and does not touch a checkout', async () => {
  // A registry of our own that says 9.9.9 is the latest.
  const reg = http.createServer((_q, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ version: '9.9.9' })) })
  await new Promise<void>((r) => reg.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(reg.address() as net.AddressInfo).port}`
  try {
    const r = await lanternWith({ LANTERN_REGISTRY: url }, 'update'); assert.ok(r.ok, r.out)
    assert.match(r.out, /lantern 9\.9\.9 is out \(this is \d+\.\d+\.\d+\)\. This copy is not a global npm install/)
    assert.match((await lanternWith({ LANTERN_REGISTRY: url }, 'version')).out, /^lantern \d+\.\d+\.\d+ — 9\.9\.9 is out: `lantern update`$/)
    const down = await lanternWith({ LANTERN_REGISTRY: 'http://127.0.0.1:9' }, 'update'); assert.ok(!down.ok); assert.match(down.out, /could not reach npm/)
  } finally { reg.close() }
})

test('named lanterns on one project: separate pages, pictures and status; watch --all shows them together', async () => {
  const a = await lanternWith({ LANTERN_NAME: 'alpha' }, 'open', app.url + '/about'); assert.ok(a.ok, a.out)
  const b = await lanternWith({ LANTERN_NAME: 'beta' }, 'open', app.url + '/long'); assert.ok(b.ok, b.out)
  try {
    assert.match((await lanternWith({ LANTERN_NAME: 'alpha' }, 'url')).out, /\/about/); assert.match((await lanternWith({ LANTERN_NAME: 'beta' }, 'url')).out, /\/long/)
    assert.match((await lanternWith({}, '--name', 'beta', 'url')).out, /\/long/, '--name works like LANTERN_NAME')
    const shot = firstLine((await lanternWith({ LANTERN_NAME: 'alpha' }, 'screenshot')).out); assert.ok(shot.includes(path.join('tmp', 'lantern', 'alpha') + path.sep), `pictures in the name's folder: ${shot}`)
    const st = (await lanternWith({ LANTERN_NAME: 'alpha' }, 'status')).out; assert.match(st, /lantern "alpha" is up/); assert.match(st, /also on this project: .*beta/)
    const all = (await lantern('watch', '--all')).out; const file = firstLine(all); assert.ok(fs.existsSync(file)); const html = fs.readFileSync(file, 'utf8')
    assert.ok((html.match(/<iframe /g) || []).length >= 2, 'a live view for each named lantern (and the unnamed one when it is up)'); assert.match(all, /alpha: http:\/\/127\.0\.0\.1:\d+\//); assert.match(all, /beta: http/)
  } finally { await lanternWith({ LANTERN_NAME: 'alpha' }, 'close'); await lanternWith({ LANTERN_NAME: 'beta' }, 'close') }
})

test('watch over the socket: JSON lines with frames and actions', async () => {
  const net = await import('node:net')
  const sock = path.join(home, 'run', fs.readdirSync(path.join(home, 'run')).find((f) => f.endsWith('.sock'))!)
  const lines: any[] = []
  const c = net.createConnection(sock)
  await new Promise<void>((r) => c.on('connect', r))
  c.write(JSON.stringify({ cmd: 'watch' }) + '\n')
  let buf = ''
  c.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1) } })
  await ok('fill', '#name', 'socket')
  await pause(400)
  c.destroy()
  assert.ok(lines.some((l) => l.frame && l.url), 'a frame line')
  assert.ok(lines.some((l) => l.did === 'filled "Walk name"'), `a did line: ${JSON.stringify(lines.filter((l) => l.did))}`)
})
test('settings: a .lantern/settings.json above the project applies, a nearer one wins key by key, the environment over all, and `lantern settings` says which', async () => {
  const inner = path.join(proj, 'nested', 'checkout'); fs.mkdirSync(path.join(inner, '.lantern'), { recursive: true }); await sh('git', ['-C', inner, 'init', '-q'])
  fs.mkdirSync(path.join(proj, '.lantern'), { recursive: true })
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ accent: '#000001', footer: 'for every project' })) // the person's own: the top of the walk
  fs.writeFileSync(path.join(proj, '.lantern', 'settings.json'), JSON.stringify({ note: 'FROM-ABOVE', accent: '#123456', onLoad: "document.documentElement.dataset.above = 'yes'" }))
  fs.writeFileSync(path.join(inner, '.lantern', 'settings.json'), JSON.stringify({ note: 'FROM-NEAR' }))
  const run = (env: Record<string, string>, ...args: string[]) => new Promise<Run>((res) => execFile(process.execPath, [BIN, ...args], { cwd: inner, env: { ...process.env, LANTERN_HOME: home, ...env }, timeout: 60_000 }, (e, so, se) => res({ ok: !e, out: (so + se).trim() })))
  try {
    const s = (await run({ LANTERN_URL: app.url }, 'settings')).out
    assert.match(s, /url\s+http:\/\/127\.0\.0\.1:\d+\s+environment/); assert.match(s, /note\s+FROM-NEAR\s+.*nested\/checkout\/\.lantern\/settings\.json/)
    assert.match(s, /accent\s+#123456\s+/); assert.match(s, /footer\s+for every project\s+.*settings\.json/)
    assert.ok(s.indexOf('nested/checkout/.lantern/settings.json') < s.lastIndexOf('.lantern/settings.json'), 'nearest first')
    const r = await run({ LANTERN_URL: app.url }, 'open', '/about'); assert.ok(r.ok, r.out)
    assert.equal((await run({}, 'eval', 'document.documentElement.dataset.above')).out, 'yes', 'the onLoad from the folder above ran')
  } finally { await run({}, 'close'); fs.rmSync(path.join(proj, '.lantern'), { recursive: true, force: true }); fs.rmSync(path.join(proj, 'nested'), { recursive: true, force: true }); fs.rmSync(path.join(home, 'settings.json'), { force: true }) }
})

test('settings in the project\'s own .lantern/settings.json: url, hosts, onLoad', async () => {
  await ok('close'); await pause(300)
  fs.mkdirSync(path.join(proj, '.lantern'), { recursive: true }); fs.writeFileSync(path.join(proj, '.lantern', 'settings.json'), JSON.stringify({ url: app.url, hosts: ['127.0.0.1'], note: 'TEST-1', accent: '#4cc3ff', onLoad: "document.documentElement.dataset.hook = 'ran'" }))
  try {
    assert.match(await ok('open', '/about'), /About/) // relative, with no page open before: `url` from the settings
    assert.equal(await ok('eval', 'document.documentElement.dataset.hook'), 'ran')
    assert.equal(await ok('eval', 'getComputedStyle(document.documentElement).getPropertyValue("--lantern-accent").trim()'), '#4cc3ff')
    const other = app.url.replace('127.0.0.1', 'localhost')
    assert.match(await bad('open', other + '/'), /only visits this project's app/)
    await ok('open', '/')
    await ok('eval', `document.getElementById('newtab').href = ${JSON.stringify(other + '/about')}`)
    const out = await ok('click', '#newtab'); assert.doesNotMatch(out, /now at/)
    assert.match(await ok('console'), /not one of this project's hosts/)
  } finally { fs.rmSync(path.join(proj, '.lantern'), { recursive: true, force: true }); await ok('close'); await pause(300) }
  await ok('open', app.url + '/')
})
test('close', async () => {
  assert.match(await ok('close'), /closed/)
  await pause(500)
  assert.match(await ok('status'), /not running/)
  assert.match(await ok('close'), /was not running/)
})

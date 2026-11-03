import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { duration, firstLine, pause, pngSize, probe, setup, sh, type Run } from './helpers.ts'

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
  const out = await ok('watch', '--no-open')
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
test('settings in .lantern.json: url, hosts, onLoad', async () => {
  await ok('close'); await pause(300)
  fs.writeFileSync(path.join(proj, '.lantern.json'), JSON.stringify({ url: app.url, hosts: ['127.0.0.1'], note: 'TEST-1', onLoad: "document.documentElement.dataset.hook = 'ran'" }))
  try {
    assert.match(await ok('open', '/about'), /About/) // relative, with no page open before: `url` from the settings
    assert.equal(await ok('eval', 'document.documentElement.dataset.hook'), 'ran')
    const other = app.url.replace('127.0.0.1', 'localhost')
    assert.match(await bad('open', other + '/'), /only visits this project's app/)
    await ok('open', '/')
    await ok('eval', `document.getElementById('newtab').href = ${JSON.stringify(other + '/about')}`)
    const out = await ok('click', '#newtab'); assert.doesNotMatch(out, /now at/)
    assert.match(await ok('console'), /not one of this project's hosts/)
  } finally { fs.rmSync(path.join(proj, '.lantern.json')); await ok('close'); await pause(300) }
  await ok('open', app.url + '/')
})
test('close', async () => {
  assert.match(await ok('close'), /closed/)
  await pause(500)
  assert.match(await ok('status'), /not running/)
  assert.match(await ok('close'), /was not running/)
})

// lantern, end to end: the real CLI, a real daemon and Chrome, against the fixture app. One daemon for the whole
// file (LANTERN_HOME is a temp folder, so nothing touches ~/.lantern), closed at the end.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { start } from './fixture/server.ts'

const BIN = fileURLToPath(new URL('../bin/lantern.ts', import.meta.url))
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-home-'))
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-proj-'))
let app: { url: string; close: () => void }

type Run = { ok: boolean; out: string }
const lantern = (...args: string[]): Promise<Run> => lanternWith({}, ...args)
const lanternWith = (env: Record<string, string>, ...args: string[]): Promise<Run> => new Promise((res) => execFile(process.execPath, [BIN, ...args], { cwd: proj, env: { ...process.env, LANTERN_HOME: home, ...env }, maxBuffer: 1 << 24, timeout: 180_000 }, (e, so, se) => res({ ok: !e, out: (so + se).trim() })))
const ok = async (...args: string[]) => { const r = await lantern(...args); assert.ok(r.ok, `lantern ${args.join(' ')} failed: ${r.out}`); return r.out }
const bad = async (...args: string[]) => { const r = await lantern(...args); assert.ok(!r.ok, `lantern ${args.join(' ')} should have failed: ${r.out}`); return r.out }
const pngSize = (f: string) => { const b = Buffer.alloc(24); const fd = fs.openSync(f, 'r'); fs.readSync(fd, b, 0, 24, 0); fs.closeSync(fd); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } }
const firstLine = (s: string) => s.split('\n')[0]
const sh = (cmd: string, args: string[]) => new Promise<string>((res) => execFile(cmd, args, (_e, so, se) => res(so + se)))
/** What ffprobe says about a video, or null where ffprobe isn't installed (the file's existence and size are still checked). */
const probe = async (f: string): Promise<string | null> => { const out = await sh('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,duration', '-show_entries', 'format=duration', '-of', 'default=nw=1', f]); return /ENOENT|not found/.test(out) ? null : out }
const duration = (p: string) => Math.max(...[...p.matchAll(/duration=([\d.]+)/g)].map((m) => Number(m[1])))

before(async () => {
  app = await start()
  execFile('git', ['init', '-q'], { cwd: proj })
  await new Promise((r) => setTimeout(r, 300))
})
after(async () => { await lantern('close'); app.close(); fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(proj, { recursive: true, force: true }) })

test('help without a daemon', async () => { const out = await ok('help'); assert.match(out, /lantern open/); assert.ok(!fs.existsSync(path.join(home, 'run'))) })
test('status when not running', async () => { assert.match(await ok('status'), /not running/) })
test('open needs a full URL the first time', async () => { assert.match(await bad('open', '/'), /full URL/) })

test('open starts the daemon and loads the page', async () => {
  const out = await ok('open', app.url + '/')
  assert.match(out, /Lantern fixture/)
  assert.match(await ok('status'), /page at/)
})
test('tmp/lantern is excluded from git', () => { assert.match(fs.readFileSync(path.join(proj, '.git/info/exclude'), 'utf8'), /tmp\/lantern/) })
test('paths resolve against the open page', async () => { assert.match(await ok('open', '/about'), /About/); await ok('open', '/') })
test('open a page that is not there', async () => { assert.match(await bad('open', 'http://127.0.0.1:1/'), /did not load/) })

test('snapshot lists controls with refs, headings, and clickable divs', async () => {
  await ok('open', '/')
  const s = await ok('snapshot')
  assert.match(s, /^# Room$/m)
  assert.match(s, /textbox "Name" \[e\d+\]/)
  assert.match(s, /combobox "Type[^"]*" \[e\d+\] \(value="Lounge"\)/)
  assert.match(s, /checkbox "Underfloor heating" \[e\d+\]/)
  assert.match(s, /checkbox "Fancy option" \[e\d+\]/, 'an invisible native checkbox under a drawn one is listed')
  assert.match(s, /button "Disabled" \[e\d+\] \(disabled\)/)
  assert.match(s, /clickable "A clickable div"/)
  assert.match(s, /combobox "Emitter" \[e\d+\] \(collapsed\)/)
  assert.match(s, /link "About \(new tab\)"/)
})
test('text reads the page, or one element', async () => {
  assert.match(await ok('text'), /Fill in the room and press calculate/)
  assert.equal(await ok('text', '#result'), '—')
  assert.match(await bad('text', '#nope'), /no element/)
})

test('fill, select, check, radio, click by ref, and the result', async () => {
  const s = await ok('snapshot')
  const ref = (re: RegExp) => { const m = re.exec(s); assert.ok(m, `no ${re} in snapshot`); return m![1] }
  await ok('fill', ref(/textbox "Name" \[(e\d+)\]/), 'Front', 'lounge')
  assert.equal(await ok('get', 'value', '#name'), 'Front lounge')
  assert.match(await ok('select', ref(/combobox "Type[^"]*" \[(e\d+)\]/), 'Kitchen'), /chose "Kitchen"/)
  assert.match(await ok('check', ref(/checkbox "Underfloor heating" \[(e\d+)\]/)), /checked "Underfloor heating"/)
  assert.match(await ok('check', '#ufh'), /already checked/)
  assert.match(await ok('is', 'checked', '#ufh'), /^yes/)
  await ok('check', '#first'); assert.match(await ok('is', 'checked', '#first'), /^yes/)
  assert.match(await ok('click', ref(/button "Calculate demand" \[(e\d+)\]/)), /clicked "Calculate demand"/)
  assert.equal(await ok('text', '#result'), '1.8 kW')
  assert.match(await ok('text', '#note'), /Front lounge \(Kitchen, underfloor\)/)
  assert.match(await ok('snapshot'), /\[status\] Calculated/)
})
test('text= finds a field by the name the snapshot showed: a placeholder, a label, an aria-label', async () => {
  await ok('fill', 'text=Room name', 'By placeholder'); assert.equal(await ok('get', 'value', '#name'), 'By placeholder')
  await ok('check', 'text=Fancy option'); assert.match(await ok('is', 'checked', '#fancy'), /^yes/)
  await ok('fill', 'text=Notes', 'by label'); assert.equal(await ok('get', 'value', '#notes'), 'by label')
})
test('fill replaces what was there', async () => {
  await ok('fill', '#name', 'Back bedroom')
  assert.equal(await ok('get', 'value', '#name'), 'Back bedroom')
})
test('click by text and by selector; a clickable div; a disabled button', async () => {
  assert.match(await ok('click', 'text=A clickable div'), /clicked "A clickable div"/)
  assert.equal(await ok('text', '#status'), 'Div clicked')
  assert.match(await ok('is', 'enabled', '#disabled'), /^no/)
  assert.match(await bad('click', 'text=Nothing reads this'), /nothing on the page reads/)
  assert.match(await bad('click', 'e999'), /take a new one/)
})
test('a custom dropdown: click it, then the option', async () => {
  await ok('click', '#dd')
  assert.match(await ok('snapshot'), /option "Fan coil"/)
  await ok('click', 'text=Fan coil')
  assert.equal(await ok('text', '#dd'), 'Fan coil')
})
test('press: Enter in a field, cmd+Enter, and typing into a contenteditable', async () => {
  await ok('fill', '#name', 'Kitchenette'); await ok('press', 'Enter')
  assert.match(await ok('text', '#note'), /Kitchenette/)
  await ok('press', 'cmd+Enter'); assert.equal(await ok('text', '#status'), 'cmd+Enter')
  await ok('fill', '#editor', 'new words'); assert.equal(await ok('text', '#editor'), 'new words')
  await ok('click', '#notes'); await ok('press', 'End'); await ok('type', 'typed here'); assert.match(await ok('get', 'value', '#notes'), /typed here$/)
  assert.match(await bad('press', 'Bogus'), /unknown key/)
})
test('get and is', async () => {
  assert.equal(await ok('get', 'attr', 'placeholder', '#name'), 'Room name')
  assert.equal(await ok('get', 'count', '.card'), '4')
  assert.match(await ok('get', 'box', '#calc'), /^\d+,\d+ \d+×\d+$/)
  assert.match(await ok('is', 'visible', '#ddlist'), /^no/)
  assert.match(await ok('is', 'visible', '#nope'), /^no/)
})
test('hover, drag a pointer-driven knob, scroll', async () => {
  assert.match(await ok('hover', '#knob'), /hovering/)
  await ok('drag', '#knob', '#knobx')
  assert.ok(Number(await ok('text', '#knobx')) > 50, 'the knob moved')
  assert.match(await ok('scroll', 'down', '400'), /scrolled down 400px/)
  assert.ok(Number(await ok('eval', 'scrollY')) > 300)
  await ok('scroll', 'to', '#name'); assert.ok(Number(await ok('eval', 'scrollY')) < 200)
  assert.match(await bad('scroll', 'sideways'), /usage/)
})
test('dialogs are accepted and noted', async () => {
  await ok('click', '#alert'); assert.equal(await ok('text', '#status'), 'Alert dismissed')
  await ok('click', '#confirm'); assert.equal(await ok('text', '#status'), 'Confirmed')
  assert.match(await ok('console'), /alert: An alert/)
})
test('a link to a new tab opens here instead', async () => {
  const out = await ok('click', '#open')
  assert.match(out, /opened here instead/)
  await ok('wait', '500')
  assert.match(await ok('url'), /\/about/)
  await ok('back'); assert.match(await ok('url'), /Lantern fixture/)
  const out2 = await ok('click', '#newtab')
  assert.match(out2, /now at .*about|opened here instead/)
  await ok('open', '/')
})
test('wait for text, and the slow page', async () => {
  await ok('open', '/slow')
  assert.match(await ok('wait', 'Finally loaded'), /is on the page/)
  assert.match(await bad('wait', 'Never shows'), /did not appear/)
  assert.match(await ok('wait', '100'), /waited 100ms/)
})
test('console: errors, uncaught, failed requests', async () => {
  await ok('open', '/errors'); await ok('wait', '500')
  const c = await ok('console')
  assert.match(c, /console.error: something broke/); assert.match(c, /uncaught: .*boom/); assert.match(c, /404 .*\/missing/)
  await ok('console', '--clear'); assert.match(await ok('console'), /no warnings/)
})
test('a page that asks before unloading does not block navigation', async () => {
  await ok('open', '/unload')
  assert.match(await ok('open', '/about'), /About/)
})
test('hash navigation does not hang', async () => {
  await ok('open', '/spa')
  const t0 = Date.now(); await ok('click', '#one'); assert.ok(Date.now() - t0 < 5000)
  assert.equal(await ok('text', '#view'), 'One view')
  await ok('open', '/spa#/two'); assert.equal(await ok('text', '#view'), 'Two view')
})
test('login with a form, and the session survives a restart of the daemon', async () => {
  await ok('open', '/secret'); assert.match(await ok('url'), /\/login/)
  await ok('fill', '#email', 'dev@example.com'); await ok('fill', '#password', 'secret'); await ok('click', 'text=Log in')
  assert.match(await ok('text'), /Welcome, dev/)
  await ok('close'); await new Promise((r) => setTimeout(r, 500))
  assert.match(await ok('status'), /not running/)
  await ok('open', app.url + '/secret')
  assert.match(await ok('text'), /Welcome, dev/)
})
test('upload a file through the input, and through the button in front of it', async () => {
  const f = path.join(proj, 'photo.jpg'); fs.writeFileSync(f, 'x')
  await ok('open', '/upload')
  assert.match(await ok('upload', '#file', 'photo.jpg'), /put photo.jpg/)
  assert.equal(await ok('text', '#picked'), 'picked photo.jpg')
  assert.match(await ok('upload', 'text=Choose a file', 'photo.jpg'), /put photo.jpg/)
  assert.match(await bad('upload', '#file', 'nope.jpg'), /no such file/)
})

test('screenshots: viewport, highlighted target, crop, region, full page, sizes', async () => {
  await ok('open', '/'); await ok('size', 'desktop')
  const dir = path.join(proj, 'tmp', 'lantern')
  let out = await ok('screenshot'); let f = firstLine(out); assert.ok(fs.existsSync(f)); assert.deepEqual(pngSize(f), { w: 2880, h: 1800 })
  out = await ok('screenshot', 'text=Calculate demand'); assert.match(out, /highlighted/); f = firstLine(out); assert.deepEqual(pngSize(f), { w: 2880, h: 1800 })
  out = await ok('screenshot', '#calc', '--crop'); f = firstLine(out); const c = pngSize(f); assert.ok(c.w < 600 && c.h < 200, `crop is ${c.w}×${c.h}`)
  out = await ok('screenshot', '10,10,100,50'); f = firstLine(out); assert.deepEqual(pngSize(f), { w: 200, h: 100 })
  await ok('open', '/long'); out = await ok('screenshot', '--full'); f = firstLine(out); const full = pngSize(f); assert.equal(full.w, 2880); assert.ok(full.h > 1800 * 2, `full page is ${full.h} tall`)
  await ok('size', 'phone'); out = await ok('screenshot'); f = firstLine(out); assert.deepEqual(pngSize(f), { w: 780, h: 1688 })
  await ok('size', '1000x700'); out = await ok('screenshot'); f = firstLine(out); assert.deepEqual(pngSize(f), { w: 2000, h: 1400 })
  assert.match(await bad('size', 'huge'), /size what/)
  assert.match(await bad('screenshot', '#nope'), /no element/)
  assert.ok(fs.readdirSync(dir).filter((x) => x.startsWith('shot-')).length >= 6)
  await ok('size', 'desktop')
})
test('highlight follows and goes away', async () => {
  await ok('open', '/'); await ok('click', '#dd')
  assert.match(await ok('highlight', 'text=Fan coil'), /highlighting "Fan coil"/)
  assert.equal(await ok('eval', '!!document.getElementById("__lantern_hl")'), 'true')
  await ok('click', 'text=Fan coil') // the list is hidden; so is the box
  await ok('wait', '200')
  assert.equal(await ok('eval', 'getComputedStyle(document.getElementById("__lantern_hl")).display'), 'none')
  await ok('eval', 'document.getElementById("ddlist").remove()') // the element goes; the box goes with it
  await ok('wait', '200')
  assert.equal(await ok('eval', '!!document.getElementById("__lantern_hl")'), 'false')
  await ok('highlight', '#result'); await ok('highlight', 'off')
  assert.equal(await ok('eval', '!!document.getElementById("__lantern_hl")'), 'false')
})
test('frame: one picture, a pair, options', async () => {
  await ok('open', '/')
  const a = firstLine(await ok('screenshot')); await ok('fill', '#name', 'After'); await ok('click', '#calc'); const b = firstLine(await ok('screenshot'))
  let out = await ok('frame', a, '--title', 'One picture'); let f = firstLine(out); assert.ok(fs.existsSync(f)); const one = pngSize(f); assert.ok(one.w > 2880 && one.h > 1800)
  out = await ok('frame', a, b, '--title=Before and after'); f = firstLine(out); const pair = pngSize(f); assert.ok(pair.h > one.h * 1.8, 'landscape pair stacks')
  out = await ok('frame', a, b, '--side', '--title', 'Side'); f = firstLine(out); assert.ok(pngSize(f).w > pair.w * 1.8, 'side by side is wider')
  out = await ok('frame', a, '--out', 'my.png'); assert.ok(fs.existsSync(path.join(proj, 'my.png'))); assert.match(out, /untitled/)
  assert.match(await bad('frame'), /give a screenshot/)
  assert.match(await bad('frame', 'nope.png'), /no such image/)
})
test('record a demo', async () => {
  await ok('open', '/'); await ok('size', 'desktop')
  assert.match(await ok('record', 'start'), /recording at 1440×900/)
  assert.match(await bad('record', 'start'), /already recording/)
  assert.match(await bad('size', 'phone'), /fixed while recording/)
  await ok('record', 'caption', 'Name the room')
  await ok('fill', '#name', 'Demo room')
  await ok('record', 'caption', 'Calculate')
  await ok('click', 'text=Calculate demand'); await ok('wait', '500')
  await ok('highlight', '#result'); await ok('wait', '800'); await ok('highlight', 'off')
  await ok('scroll', 'down', '300')
  const out = await ok('record', 'stop')
  const f = firstLine(out); assert.ok(f.endsWith('.mp4') && fs.existsSync(f), out)
  assert.match(out, /\(\d+s, \d+ frames/)
  assert.ok(fs.statSync(f).size > 20_000, 'the video has something in it')
  const p = await probe(f)
  if (p) { assert.match(p, /width=1920/); assert.match(p, /height=1200/); assert.ok(duration(p) >= 7.5, `captions hold: ${duration(p)}s`) } // three caption segments × 2.5s at least
  assert.ok(!fs.existsSync(path.dirname(f) + '/' + path.basename(f, '.mp4').replace('demo-', 'rec-')), 'frames folder removed')
  assert.match(await bad('record', 'stop'), /not recording/)
  assert.match(await bad('record', 'caption', 'x'), /not recording/)
})
test('record without ffmpeg: Chrome encodes the video', async () => {
  // The daemon reads its environment when it starts: restart it with ffmpeg pointed nowhere.
  await ok('close'); await new Promise((r) => setTimeout(r, 300))
  const NO = { LANTERN_FFMPEG: '/nonexistent/ffmpeg' }
  try {
    let r = await lanternWith(NO, 'open', app.url + '/'); assert.ok(r.ok, r.out)
    r = await lanternWith(NO, 'record', 'start'); assert.ok(r.ok, r.out)
    await lanternWith(NO, 'record', 'caption', 'Encoded by Chrome')
    await lanternWith(NO, 'fill', '#name', 'No ffmpeg')
    await lanternWith(NO, 'click', 'text=Calculate demand')
    r = await lanternWith(NO, 'record', 'stop'); assert.ok(r.ok, r.out)
    const f = firstLine(r.out); assert.match(f, /\.(mp4|webm)$/); assert.ok(fs.existsSync(f))
    assert.match(r.out, /encoded by Chrome/)
    assert.ok(fs.statSync(f).size > 20_000, 'the video has something in it')
    const p = await probe(f)
    if (p) { assert.match(p, /codec_name=(h264|vp9|vp8|av1)/); assert.match(p, /width=1920/); assert.ok(duration(p) >= 4, `captions hold: ${duration(p)}s in ${p}`) }
  } finally { await lanternWith(NO, 'close'); await new Promise((r) => setTimeout(r, 300)); await ok('open', app.url + '/') }
})
test('nothing recorded when nothing changes', async () => {
  await ok('record', 'start'); await ok('wait', '200')
  assert.match(await bad('record', 'stop'), /nothing was recorded|frames/)
})
test('commands sent in parallel are run one at a time', async () => {
  await ok('open', '/')
  const rs = await Promise.all([lantern('fill', '#name', 'one'), lantern('fill', '#name', 'two'), lantern('fill', '#name', 'three')])
  assert.ok(rs.every((r) => r.ok), rs.map((r) => r.out).join('\n'))
  assert.match(await ok('get', 'value', '#name'), /^(one|two|three)$/)
})
test('eval and unknown commands', async () => {
  assert.equal(await ok('eval', '1 + 1'), '2')
  assert.match(await bad('eval', 'nope()'), /not defined/)
  assert.match(await bad('bogus'), /unknown: lantern bogus/)
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
  const poke2 = lantern('click', 'text=Calculate demand')
  while (!/clicked/.test(text)) { const { value, done } = await r2.read(); if (done) break; text += Buffer.from(value).toString() }
  ac2.abort(); await poke2
  assert.match(text, /"did":"clicked \\"Calculate demand\\""/)
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
  await new Promise((r) => setTimeout(r, 400))
  c.destroy()
  assert.ok(lines.some((l) => l.frame && l.url), 'a frame line')
  assert.ok(lines.some((l) => l.did === 'filled "Room name"'), `a did line: ${JSON.stringify(lines.filter((l) => l.did))}`)
})
test('settings in .lantern.json: url, hosts, onLoad', async () => {
  await ok('close'); await new Promise((r) => setTimeout(r, 300))
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
  } finally { fs.rmSync(path.join(proj, '.lantern.json')); await ok('close'); await new Promise((r) => setTimeout(r, 300)) }
  await ok('open', app.url + '/')
})
test('close', async () => {
  assert.match(await ok('close'), /closed/)
  await new Promise((r) => setTimeout(r, 500))
  assert.match(await ok('status'), /not running/)
  assert.match(await ok('close'), /was not running/)
})

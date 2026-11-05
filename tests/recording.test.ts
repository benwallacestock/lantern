import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { duration, firstLine, pause, pixelAt, pngSize, probe, setup, sh, type Run } from './helpers.ts'

let t: Awaited<ReturnType<typeof setup>>
let app: { url: string; close: () => void }, home = '', proj = ''
const lantern = (...a: string[]) => t.lantern(...a)
const lanternWith = (env: Record<string, string>, ...a: string[]) => t.lanternWith(env, ...a)
const ok = (...a: string[]) => t.ok(...a)
const bad = (...a: string[]) => t.bad(...a)

before(async () => { t = await setup(); ({ app, home, proj } = t) })
after(async () => { await t.teardown() })
test('the app opens', async () => { assert.match(await ok('open', app.url + '/'), /Lantern fixture/) })
test('record a demo', async () => {
  await ok('open', '/'); await ok('size', 'desktop')
  assert.match(await ok('record', 'start'), /recording at 1440×900/)
  assert.match(await bad('record', 'start'), /already recording/)
  assert.match(await bad('size', 'phone'), /fixed while recording/)
  await ok('record', 'caption', 'Name the room')
  await ok('fill', '#name', 'Demo walk')
  assert.equal(await ok('eval', '!!document.getElementById("__lantern_keys")'), 'true', 'typing is shown in a bubble by the pointer')
  await ok('record', 'caption', 'Estimate')
  await ok('click', 'text=Estimate time'); await ok('wait', '500')
  await ok('highlight', '#result'); await ok('wait', '800'); await ok('highlight', 'off')
  await ok('scroll', 'down', '300')
  const out = await ok('record', 'stop')
  const f = firstLine(out); assert.ok(f.endsWith('.mp4') && fs.existsSync(f), out)
  assert.match(out, /\(\d+\.\d+s of video, from \d+ frames/)
  assert.ok(fs.statSync(f).size > 20_000, 'the video has something in it')
  const p = await probe(f)
  if (p) { const w = Number(/width=(\d+)/.exec(p)?.[1]), h = Number(/height=(\d+)/.exec(p)?.[1]); assert.ok(w > 2880 && h > 1800, `the clip at 2x in its banner: ${w}×${h}`); assert.ok(duration(p) >= 7.5, `captions hold: ${duration(p)}s`) } // three caption segments × 2.5s at least
  assert.ok(!fs.existsSync(path.dirname(f) + '/' + path.basename(f, '.mp4').replace('demo-', 'rec-')), 'frames folder removed')
  assert.match(await bad('record', 'stop'), /not recording/)
  assert.match(await bad('record', 'caption', 'x'), /not recording/)
})
test('record without ffmpeg: Chrome encodes the video', async () => {
  // The daemon reads its environment when it starts: restart it with ffmpeg pointed nowhere.
  await ok('close'); await pause(300)
  const NO = { LANTERN_FFMPEG: '/nonexistent/ffmpeg' }
  try {
    let r = await lanternWith(NO, 'open', app.url + '/'); assert.ok(r.ok, r.out)
    r = await lanternWith(NO, 'record', 'start'); assert.ok(r.ok, r.out)
    await lanternWith(NO, 'record', 'caption', 'Encoded by Chrome')
    await lanternWith(NO, 'fill', '#name', 'No ffmpeg')
    await lanternWith(NO, 'click', 'text=Estimate time')
    r = await lanternWith(NO, 'record', 'stop'); assert.ok(r.ok, r.out)
    const f = firstLine(r.out); assert.match(f, /\.(mp4|webm)$/); assert.ok(fs.existsSync(f))
    assert.match(r.out, /encoded by Chrome/)
    assert.ok(fs.statSync(f).size > 20_000, 'the video has something in it')
    const p = await probe(f)
    if (p) { assert.match(p, /codec_name=(h264|vp9|vp8|av1)/); assert.ok(Number(/width=(\d+)/.exec(p)?.[1]) > 2880, `2x: ${p}`); assert.ok(duration(p) >= 4, `captions hold: ${duration(p)}s in ${p}`) }
  } finally { await lanternWith(NO, 'close'); await pause(300); await ok('open', app.url + '/') }
})
test('while recording, the page sees the pointer travel: moves along the way, not one jump', async () => {
  await ok('open', '/moves'); await ok('click', '#a')
  const before = Number(await ok('text', '#n'))
  await ok('record', 'start'); await ok('click', '#b'); await ok('record', 'stop').catch(() => {})
  const during = Number(await ok('text', '#n')) - before
  assert.ok(during >= 4, `the page saw ${during} moves between the clicks`)
  await ok('click', '#a'); const plain = Number(await ok('text', '#n'))
  await ok('click', '#b'); assert.ok(Number(await ok('text', '#n')) - plain <= 3, 'not recording: one move, no glide')
})

test('a scroll sends the page the same wheel events on camera as off it, so a canvas zooms the same in the take as in the rehearsal', async () => {
  await ok('open', app.url + '/wheel')
  await ok('scroll', 'down', '300'); const off = Number(await ok('eval', "document.getElementById('n').textContent"))
  assert.ok(off > 0, 'wheel events arrived')
  await ok('record', 'start'); await ok('scroll', 'down', '300'); const on = Number(await ok('eval', "document.getElementById('n').textContent")) - off
  await ok('record', 'stop')
  assert.equal(on, off)
})
test('a caption can go along the top, and annotations outlive the recording for a still of the end', async () => {
  await ok('open', app.url + '/')
  await ok('record', 'start')
  assert.match(await ok('record', 'caption', '--top', 'Above the toolbar'), /caption \(along the top\): Above the toolbar/)
  assert.ok(Number(await ok('eval', "document.getElementById('__lantern_caption').getBoundingClientRect().top")) < 100, 'the caption is at the top')
  await ok('record', 'caption', 'Back at the bottom'); assert.ok(Number(await ok('eval', "document.getElementById('__lantern_caption').getBoundingClientRect().top")) > 600)
  await ok('fill', '#name', 'kept'); await ok('highlight', '#name')
  await ok('record', 'stop')
  assert.equal(await ok('eval', "!!document.getElementById('__lantern_caption')"), 'false', 'the caption goes with the recording')
  assert.equal(await ok('eval', "document.querySelectorAll('.__l-highlight, .__l-glow').length > 0"), 'true', 'the highlight is still there')
  await ok('clear')
})
test('a titled recording is framed: the video is bigger than the clip', async () => {
  await ok('open', '/')
  assert.match(await ok("record", "start", "--title", "A framed demo", "--note", "TRAIL-1"), /in a frame titled "A framed demo"/)
  await ok('record', 'caption', 'Estimate'); await ok('click', 'text=Estimate time'); await ok('callout', '#result', 'The estimate'); await ok('wait', '400')
  const out = await ok('record', 'stop'); const f = firstLine(out); assert.match(out, /; framed/); assert.ok(fs.existsSync(f))
  assert.match(out, /1 annotation is still on the page/, 'and it says a mark was left up')
  const p = await probe(f)
  if (p) { const w = Number(/width=(\d+)/.exec(p)?.[1]), h = Number(/height=(\d+)/.exec(p)?.[1]); assert.ok(w > 2880 && h > 1800 + 100, `framed video is taller than one with just the banner: ${w}×${h}`) }
  // The frame stays for the whole clip (it is a still laid over every frame, and once it went after the first one): a corner pixel well into the clip is the frame's dark, not the page's white.
  const px = await pixelAt(f, 20, 6, 6); if (px) assert.ok(px.every((c) => c < 80), `frame corner at frame 20 is dark: ${px}`)
  assert.match(await bad('record', 'start', '--bogus'), /takes --title/)
})
test('nothing recorded when nothing changes', async () => {
  await ok('clear') // the last recording's callout is still up (marks outlive a recording), and it moves
  await ok('record', 'start'); await ok('wait', '200')
  assert.match(await bad('record', 'stop'), /nothing was recorded|frames/)
})

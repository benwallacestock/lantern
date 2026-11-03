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
test('the app opens', async () => { assert.match(await ok('open', app.url + '/'), /Lantern fixture/) })
test('record a demo', async () => {
  await ok('open', '/'); await ok('size', 'desktop')
  assert.match(await ok('record', 'start'), /recording at 1440×900/)
  assert.match(await bad('record', 'start'), /already recording/)
  assert.match(await bad('size', 'phone'), /fixed while recording/)
  assert.equal(await ok('eval', '!!document.getElementById("__lantern_mark")'), 'true', 'the mark is on while recording')
  await ok('record', 'caption', 'Name the room')
  await ok('fill', '#name', 'Demo walk')
  assert.equal(await ok('eval', '!!document.getElementById("__lantern_keys")'), 'true', 'typing is shown in a bubble by the pointer')
  await ok('record', 'caption', 'Estimate')
  await ok('click', 'text=Estimate time'); await ok('wait', '500')
  await ok('highlight', '#result'); await ok('wait', '800'); await ok('highlight', 'off')
  await ok('scroll', 'down', '300')
  const out = await ok('record', 'stop')
  const f = firstLine(out); assert.ok(f.endsWith('.mp4') && fs.existsSync(f), out)
  assert.match(out, /\(\d+s of video from \d+ captured changes/)
  assert.ok(fs.statSync(f).size > 20_000, 'the video has something in it')
  const p = await probe(f)
  if (p) { assert.match(p, /width=1920/); assert.match(p, /height=1200/); assert.ok(duration(p) >= 7.5, `captions hold: ${duration(p)}s`) } // three caption segments × 2.5s at least
  assert.ok(!fs.existsSync(path.dirname(f) + '/' + path.basename(f, '.mp4').replace('demo-', 'rec-')), 'frames folder removed')
  assert.equal(await ok('eval', '!!document.getElementById("__lantern_mark")'), 'false', 'the mark goes with the recording')
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
    if (p) { assert.match(p, /codec_name=(h264|vp9|vp8|av1)/); assert.match(p, /width=1920/); assert.ok(duration(p) >= 4, `captions hold: ${duration(p)}s in ${p}`) }
  } finally { await lanternWith(NO, 'close'); await pause(300); await ok('open', app.url + '/') }
})
test('a titled recording is framed: the video is bigger than the clip', async () => {
  await ok('open', '/')
  assert.match(await ok('record', 'start', '--title', 'A framed demo', '--note', 'TRAIL-1'), /framed and titled "A framed demo"/)
  await ok('record', 'caption', 'Estimate'); await ok('click', 'text=Estimate time'); await ok('callout', '#result', 'The estimate'); await ok('wait', '400')
  const out = await ok('record', 'stop'); const f = firstLine(out); assert.match(out, /; framed/); assert.ok(fs.existsSync(f))
  const p = await probe(f)
  if (p) { const w = Number(/width=(\d+)/.exec(p)?.[1]), h = Number(/height=(\d+)/.exec(p)?.[1]); assert.ok(w > 1920 && h > 1200, `framed video is ${w}×${h}`) }
  assert.match(await bad('record', 'start', '--bogus'), /takes --title/)
})
test('nothing recorded when nothing changes', async () => {
  await ok('record', 'start'); await ok('wait', '200')
  assert.match(await bad('record', 'stop'), /nothing was recorded|frames/)
})

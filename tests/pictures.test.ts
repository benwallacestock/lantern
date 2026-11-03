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
test('screenshots: viewport, highlighted target, crop, region, full page, sizes', async () => {
  await ok('open', '/'); await ok('size', 'desktop')
  const dir = path.join(proj, 'tmp', 'lantern')
  let out = await ok('screenshot'); let f = firstLine(out); assert.ok(fs.existsSync(f)); assert.deepEqual(pngSize(f), { w: 2880, h: 1800 })
  out = await ok('screenshot', 'text=Estimate time'); assert.match(out, /highlighted/); f = firstLine(out); assert.deepEqual(pngSize(f), { w: 2880, h: 1800 })
  out = await ok('screenshot', '#estimate', '--crop'); f = firstLine(out); const c = pngSize(f); assert.ok(c.w < 600 && c.h < 200, `crop is ${c.w}×${c.h}`)
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
  assert.match(await ok('highlight', 'text=Boardwalk'), /highlighting "Boardwalk"/)
  assert.equal(await ok('eval', '!!document.getElementById("__lantern_hl")'), 'true')
  await ok('click', 'text=Boardwalk') // the list is hidden; so is the box
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
  const a = firstLine(await ok('screenshot')); await ok('fill', '#name', 'After'); await ok('click', '#estimate'); const b = firstLine(await ok('screenshot'))
  let out = await ok('frame', a, '--title', 'One picture'); let f = firstLine(out); assert.ok(fs.existsSync(f)); const one = pngSize(f); assert.ok(one.w > 2880 && one.h > 1800)
  out = await ok('frame', a, b, '--title=Before and after'); f = firstLine(out); const pair = pngSize(f); assert.ok(pair.h > one.h * 1.8, 'landscape pair stacks')
  out = await ok('frame', a, b, '--side', '--title', 'Side'); f = firstLine(out); assert.ok(pngSize(f).w > pair.w * 1.8, 'side by side is wider')
  out = await ok('frame', a, '--out', 'my.png'); assert.ok(fs.existsSync(path.join(proj, 'my.png'))); assert.match(out, /untitled/)
  out = await ok('frame', a, '--title', 'With my footer', '--footer', 'Just my words'); assert.ok(fs.existsSync(firstLine(out)))
  assert.match(await bad('frame'), /give a screenshot/)
  assert.match(await bad('frame', 'nope.png'), /no such image/)
})
test('a hover survives a screenshot', async () => {
  await ok('open', '/hoverme'); await ok('hover', '#hv')
  assert.equal(await ok('eval', 'getComputedStyle(document.querySelector("#hv .tip")).display'), 'block')
  await ok('screenshot')
  assert.equal(await ok('eval', 'getComputedStyle(document.querySelector("#hv .tip")).display'), 'block')
})
test('downloads land in the project and are reported', async () => {
  await ok('open', '/download')
  const out = await ok('click', '#dl'); assert.match(out, /downloaded .*tmp\/lantern\/downloads\/report\.txt/)
  assert.equal(fs.readFileSync(path.join(proj, 'tmp/lantern/downloads/report.txt'), 'utf8'), 'the report')
  assert.match(await ok('console'), /downloaded/)
})

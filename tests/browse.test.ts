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
test('open starts the daemon and loads the page', async () => {
  const out = await ok('open', app.url + '/')
  assert.match(out, /Lantern fixture/)
  assert.match(await ok('status'), /page at/)
})
test('paths resolve against the open page', async () => { assert.match(await ok('open', '/about'), /About/); await ok('open', '/') })
test('open a page that is not there', async () => { assert.match(await bad('open', 'http://127.0.0.1:1/'), /did not load/) })

test('snapshot lists controls with refs, headings, and clickable divs', async () => {
  await ok('open', '/')
  const s = await ok('snapshot')
  assert.match(s, /^# Walk$/m)
  assert.match(s, /textbox "Name" \[e\d+\]/)
  assert.match(s, /combobox "Type[^"]*" \[e\d+\] \(value="Forest"\)/)
  assert.match(s, /checkbox "Bring a lantern" \[e\d+\]/)
  assert.match(s, /checkbox "Fancy option" \[e\d+\]/, 'an invisible native checkbox under a drawn one is listed')
  assert.match(s, /button "Disabled" \[e\d+\] \(disabled\)/)
  assert.match(s, /clickable "A clickable div"/)
  assert.match(s, /combobox "Terrain" \[e\d+\] \(collapsed\)/)
  assert.match(s, /link "About \(new tab\)"/)
})
test('text reads the page, or one element', async () => {
  assert.match(await ok('text'), /Describe the walk and ask for an estimate/)
  assert.equal(await ok('text', '#result'), '—')
  assert.match(await bad('text', '#nope'), /no element/)
})

test('fill, select, check, radio, click by ref, and the result', async () => {
  const s = await ok('snapshot')
  const ref = (re: RegExp) => { const m = re.exec(s); assert.ok(m, `no ${re} in snapshot`); return m![1] }
  await ok('fill', ref(/textbox "Name" \[(e\d+)\]/), 'Old', 'forest')
  assert.equal(await ok('get', 'value', '#name'), 'Old forest')
  assert.match(await ok('select', ref(/combobox "Type[^"]*" \[(e\d+)\]/), 'Mountain'), /chose "Mountain"/)
  assert.match(await ok('check', ref(/checkbox "Bring a lantern" \[(e\d+)\]/)), /checked "Bring a lantern"/)
  assert.match(await ok('check', '#lamp'), /already checked/)
  assert.match(await ok('is', 'checked', '#lamp'), /^yes/)
  await ok('check', '#evening'); assert.match(await ok('is', 'checked', '#evening'), /^yes/)
  assert.match(await ok('click', ref(/button "Estimate time" \[(e\d+)\]/)), /clicked "Estimate time"/)
  assert.equal(await ok('text', '#result'), '3.5 h')
  assert.match(await ok('text', '#note'), /Old forest \(Mountain, with a lantern\)/)
  assert.match(await ok('snapshot'), /\[status\] Estimated/)
})
test('text= finds a field by the name the snapshot showed: a placeholder, a label, an aria-label', async () => {
  await ok('fill', 'text=Walk name', 'By placeholder'); assert.equal(await ok('get', 'value', '#name'), 'By placeholder')
  await ok('check', 'text=Fancy option'); assert.match(await ok('is', 'checked', '#fancy'), /^yes/)
  await ok('fill', 'text=Notes', 'by label'); assert.equal(await ok('get', 'value', '#notes'), 'by label')
})
test('fill replaces what was there', async () => {
  await ok('fill', '#name', 'Forest box')
  assert.equal(await ok('get', 'value', '#name'), 'Forest box')
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
  assert.match(await ok('snapshot'), /option "Boardwalk"/)
  await ok('click', 'text=Boardwalk')
  assert.equal(await ok('text', '#dd'), 'Boardwalk')
})
test('press: Enter in a field, cmd+Enter, and typing into a contenteditable', async () => {
  await ok('fill', '#name', 'Old forest'); await ok('press', 'Enter')
  assert.match(await ok('text', '#note'), /Old forest/)
  await ok('press', 'cmd+Enter'); assert.equal(await ok('text', '#status'), 'cmd+Enter')
  await ok('fill', '#editor', 'new words'); assert.equal(await ok('text', '#editor'), 'new words')
  await ok('click', '#notes'); await ok('press', 'End'); await ok('type', 'typed here'); assert.match(await ok('get', 'value', '#notes'), /typed here$/)
  assert.match(await bad('press', 'Bogus'), /unknown key/)
})
test('scroll top and bottom; scroll to body means the top; fill with nothing clears; get style; text without lantern\'s own overlays', async () => {
  await ok('open', '/long')
  await ok('scroll', 'bottom'); assert.ok(Number(await ok('eval', 'scrollY')) > 1000)
  await ok('scroll', 'top'); assert.equal(await ok('eval', 'scrollY'), '0')
  await ok('scroll', 'bottom'); assert.match(await ok('scroll', 'to', 'body'), /scrolled to the top/); assert.equal(await ok('eval', 'scrollY'), '0')
  await ok('open', '/')
  await ok('fill', '#name', 'Something'); assert.match(await ok('fill', '#name', ''), /cleared "Walk name"/); assert.equal(await ok('get', 'value', '#name'), '')
  assert.match(await ok('get', 'style', 'background-color', '#estimate'), /^rgb\(31, 111, 63\)$/)
  await ok('fill', '#name', 'Overlay check')
  assert.doesNotMatch(await ok('text'), /Overlay check\n\|/) // the keys bubble is lantern's, not the page's
  assert.match(await bad('wait', 'Overlay check|'), /did not appear/)
})
test('get and is', async () => {
  assert.equal(await ok('get', 'attr', 'placeholder', '#name'), 'Walk name')
  assert.equal(await ok('get', 'count', '.card'), '4')
  assert.match(await ok('get', 'box', '#estimate'), /^\d+,\d+ \d+×\d+ \(in the viewport/)
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
test('upload a file through the input, and through the button in front of it', async () => {
  const f = path.join(proj, 'photo.jpg'); fs.writeFileSync(f, 'x')
  await ok('open', '/upload')
  assert.match(await ok('upload', '#file', 'photo.jpg'), /put photo.jpg/)
  assert.equal(await ok('text', '#picked'), 'picked photo.jpg')
  assert.match(await ok('upload', 'text=Choose a file', 'photo.jpg'), /put photo.jpg/)
  assert.match(await bad('upload', '#file', 'nope.jpg'), /no such file/)
})

test('shadow DOM: the snapshot lists what is inside, and targets reach it', async () => {
  await ok('open', '/shadow')
  const s = await ok('snapshot'); assert.match(s, /textbox "Shadow name"/); assert.match(s, /button "Shadow button"/)
  await ok('fill', '#sname', 'from outside'); assert.equal(await ok('get', 'value', '#sname'), 'from outside')
  await ok('click', 'text=Shadow button'); assert.equal(await ok('text', '#out'), 'shadow clicked: from outside')
})
test('a click goes to the button it found, not to a tooltip the pointer raised that reads the same', async () => {
  await ok('open', app.url + '/tooltip')
  assert.match(await ok('click', 'text=Finish face'), /clicked "Finish face"/)
  assert.equal(await ok('eval', "document.getElementById('out').textContent"), 'finished')
  // and a button with no name at all is said by what it is beside, so the reply tells one such button from another
  assert.match(await ok('click', '#kebab'), /clicked "unnamed button by /)
})
test('a callout goes on the side asked for', async () => {
  await ok('open', app.url + '/')
  const side = async (flag: string) => { await ok('callout', '700,450', 'Here', flag); const r = await ok('eval', "(() => { const l = document.querySelector('.__l-callout-label').getBoundingClientRect(); return Math.round(l.left + l.width / 2) + ',' + Math.round(l.top + l.height / 2) })()"); await ok('clear'); return r.split(',').map(Number) }
  const [lx] = await side('--left'), [rx] = await side('--right'), [, ay] = await side('--above'), [, by] = await side('--below')
  assert.ok(lx < 700 && rx > 700 && ay < 450 && by > 450, `left ${lx}, right ${rx}, above ${ay}, below ${by}`)
})
test('marking or picturing something a tip is lying over says so, and says when the words cover something', async () => {
  await ok('open', app.url + '/tip')
  const out = await ok('callout', '#msg', 'Sending is blocked')
  assert.match(out, /⚠ about (a third|half|a fifth) of it is hidden behind "Navigation has moved[^"]*", which is on top of it/)
  assert.match(await ok('highlight', '#msg'), /hidden behind "Navigation has moved/); assert.match(await ok('screenshot', '#msg'), /hidden behind "Navigation has moved[^]*take it again/)
  await ok('clear'); await ok('click', 'text=Dismiss')
  const clear = await ok('callout', '#msg', 'Sending is blocked', '--above'); assert.doesNotMatch(clear, /hidden behind/); assert.doesNotMatch(clear, /lie over/)
  await ok('clear')
  assert.match(await ok('callout', '#msg', 'Same message as before, and sending is blocked', '--below'), /⚠ the words lie over "(Use new proposal|Settings)[^]*--left, --right, --above or --below/)
  await ok('clear')
  assert.equal(await ok('hover', '300,300'), 'hovering over "300,300"')
})
test('annotations take a place as well as an element, for what is drawn on a canvas: a spot x,y or a region x,y,w,h', async () => {
  await ok('open', app.url + '/')
  assert.match(await ok('callout', '400,300', 'Drawn here'), /callout on "the spot 400,300": Drawn here/)
  assert.match(await ok('ring', '600,200'), /a ring around "the spot 600,200"/)
  assert.match(await ok('arrow', '700,400'), /an arrow pointing at "the spot 700,400"/)
  assert.match(await ok('highlight', '100,100,200,80'), /highlighting "the region 100,100,200,80"/)
  assert.match(await ok('badge', '3', '900,300'), /badge 3 on "the spot 900,300"/)
  const box = (sel: string) => ok('eval', `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return Math.round(r.left + r.width / 2) + ',' + Math.round(r.top + r.height / 2) })()`)
  assert.equal(await box('.__l-badge'), '900,300', 'the disc sits on the spot')
  assert.equal(await box('.__l-ring'), '600,200', 'the ring is around the spot')
  assert.equal(await ok('eval', 'document.querySelectorAll(".__l-anchor").length'), '5')
  await ok('clear'); assert.equal(await ok('eval', 'document.querySelectorAll(".__l-anchor, .__l-ring, .__l-badge, .__l-callout").length'), '0', 'cleared, and nothing left behind')
})
test('a callout: label, line and glow, numbered, following the element, off again', async () => {
  await ok('open', '/')
  const out = await ok('callout', '2', '#result', 'The time, once estimated'); assert.match(out, /callout 2 on "—": The time, once estimated/)
  assert.equal(await ok('eval', '!!document.querySelector(".__l-callout") && !!document.querySelector(".__l-callout-line")'), 'true')
  assert.match(await ok('eval', 'document.querySelector(".__l-callout-label").textContent'), /2.*The time, once estimated/)
  assert.match(await ok('eval', 'document.querySelector(".__l-callout-line path").getAttribute("d")'), /^M[\d.]+ [\d.]+ Q/)
  await ok('click', 'text=Estimate time') // the element changes; the callout stays with it
  assert.equal(await ok('eval', '!!document.querySelector(".__l-callout")'), 'true')
  await ok('callout', 'off'); assert.equal(await ok('eval', '!!document.querySelector(".__l-callout")'), 'false')
  assert.match(await bad('callout', '#result'), /needs the words/)
  // Two callouts on neighbours keep off each other's labels.
  await ok('callout', '#name', 'The name of the walk, which is a longer label so it needs room')
  await ok('callout', '#notes', 'Notes for the walk, also a longer label so it needs room'); await ok('wait', '150')
  assert.equal(await ok('eval', '(() => { const [a, b] = [...document.querySelectorAll(".__l-callout-label")].map((n) => n.getBoundingClientRect()); return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top })()'), 'false', 'the labels do not overlap')
  await ok('clear')
})

test('a card below the fold of a smoothly scrolling drawer is clicked where it ends up, not where it was', async () => {
  await ok('open', '/smooth')
  assert.match(await ok('click', 'text=Card 10'), /clicked "Card 10/)
  assert.equal(await ok('text', '#picked2'), 'Card 10')
  assert.match(await ok('click', 'text=Card 3'), /clicked "Card 3/)
  assert.equal(await ok('text', '#picked2'), 'Card 3')
})

test('wait sees text typed into a field; scroll bottom and top move an inner scrolling container', async () => {
  await ok('open', '/'); await ok('fill', '#name', 'Ridge loop at dawn')
  assert.match(await ok('wait', 'Ridge loop at dawn'), /is on the page/) // in the field's value, not the page's text
  assert.match(await ok('wait', 'Walk name'), /is on the page/) // a placeholder
  await ok('open', '/smooth')
  await ok('scroll', 'bottom'); assert.ok(Number(await ok('eval', 'document.getElementById("drawer").scrollTop')) > 100, 'the drawer scrolled, since the window has nowhere to go')
  await ok('scroll', 'top'); assert.equal(await ok('eval', 'document.getElementById("drawer").scrollTop'), '0')
})

test('a modifier click: --shift, --alt, --ctrl, --cmd ahead of the target', async () => {
  await ok('open', '/mods')
  await ok('click', '#mod'); assert.equal(await ok('text', '#held'), 'none')
  await ok('click', '--shift', '#mod'); assert.equal(await ok('text', '#held'), 'shift')
  await ok('click', '--alt', '--cmd', 'text=Click me'); assert.equal(await ok('text', '#held'), 'alt+meta')
})

test('badge, ring, arrow and blur: drawn, following, cleared by kind or all at once', async () => {
  await ok('open', '/')
  assert.match(await ok('badge', '1', '#name'), /badge 1 on "Walk name"/)
  assert.match(await ok('badge', '2', 'text=Estimate time'), /badge 2 on/)
  assert.match(await ok('ring', '#fancy'), /a ring around/)
  assert.match(await ok('arrow', '#result'), /an arrow pointing at/)
  assert.match(await ok('blur', '#notes'), /a blur over/)
  assert.equal(await ok('eval', '[".__l-badge", ".__l-ring", ".__l-arrow", ".__l-blur"].map((c) => document.querySelectorAll(c).length).join()'), '2,1,1,1')
  assert.match(await ok('eval', 'document.querySelector(".__l-arrow path.shaft").getAttribute("d")'), /^M[-\d.]+ [-\d.]+ L/)
  assert.equal(await ok('text'), (await ok('text')).replace(/\b1\b2\b/, ''), 'the badges are not in the page text') // reads hide the overlays
  await ok('eval', 'document.getElementById("result").remove()') // the element goes; the arrow goes with it
  await ok('wait', '200'); assert.equal(await ok('eval', 'document.querySelectorAll(".__l-arrow").length'), '0')
  assert.match(await ok('clear', 'badge'), /badge annotations cleared/); assert.equal(await ok('eval', 'document.querySelectorAll(".__l-badge").length'), '0')
  assert.match(await bad('clear', 'sparkles'), /clear what/)
  assert.match(await ok('clear'), /annotations cleared/); assert.equal(await ok('eval', 'document.querySelectorAll(".__lantern:not(#__lantern_cursor)").length'), '0')
  assert.match(await bad('badge', '#name'), /usage: lantern badge <n> <target>/)
})
test('a covered button is refused, not "clicked"', async () => {
  await ok('open', '/overlay')
  assert.match(await bad('click', 'text=Covered button'), /covered by div#veil/)
  assert.equal(await ok('text', '#o'), 'nothing')
})
test('an open dialog comes first in the snapshot', async () => {
  await ok('open', '/dialog'); await ok('click', '#open')
  const s = await ok('snapshot'); const lines = s.split('\n')
  assert.match(lines[1], /a dialog is open/); assert.match(s, /\[dialog "Confirm it"\]/)
  assert.ok(s.indexOf('Yes, sure') < s.indexOf('Behind'), 'dialog controls before the page')
  assert.match(await bad('click', '#behind'), /covered/)
  await ok('click', 'text=Yes, sure'); assert.equal(await ok('text', '#open'), 'Confirmed')
})
test('fill sets date, range and colour inputs; select picks several; fill refuses a button', async () => {
  await ok('open', '/inputs')
  assert.match(await ok('fill', '#d', '2026-01-15'), /set "Date" to 2026-01-15/); assert.equal(await ok('get', 'value', '#d'), '2026-01-15')
  assert.match(await bad('fill', '#d', 'not a date'), /would not take/)
  await ok('fill', '#r', '80'); assert.equal(await ok('get', 'value', '#r'), '80')
  await ok('fill', '#c', '#00ff00'); assert.equal(await ok('get', 'value', '#c'), '#00ff00')
  assert.match(await ok('select', '#multi', 'Banana', 'Cherry'), /chose "Banana", "Cherry"/); assert.match(await ok('text', '#vals'), /multi=Banana\+Cherry/)
  assert.match(await ok('snapshot'), /listbox "Fruit" \[e\d+\] \(chosen: Banana, Cherry\)/)
  await ok('open', '/'); assert.match(await bad('fill', '#estimate', 'x'), /not a field/); assert.match(await bad('fill', '#type', 'x'), /is a <select>/)
})
test('fill says when focus was stolen while typing', async () => {
  await ok('open', '/focus')
  assert.match(await bad('fill', '#victim', 'hello victim'), /focus moved to input#thief/)
})
test('an error page is a page; a cap on waits is said; text= also counts; version', async () => {
  assert.match(await ok('open', '/empty404'), /HTTP 404/)
  await ok('open', '/')
  assert.equal(await ok('get', 'count', 'text=Estimate time'), '1')
  assert.match(await ok('text', '.card'), /^\(4 elements match/)
  assert.match(await ok('press', 'cmd+='), /pressed/); assert.equal(await ok('text', '#status'), 'code Equal')
  assert.match(await ok('version'), /^lantern \d+\.\d+\.\d+$/)
  assert.match(await bad('click', 'text=Estimate'), /reads exactly "Estimate"; "Estimate time" does/)
  assert.match(await bad('click', '"text=x"'), /not a valid CSS selector/)
  assert.match(await bad('scroll', 'down', 'abc'), /not a number/)
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

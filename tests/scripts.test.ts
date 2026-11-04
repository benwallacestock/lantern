// Every script lantern runs inside a page must at least parse: a quote out of place in one of these strings takes
// the click rings, keycaps and pills out of every recording without a word said. No browser needed here.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as scripts from '../src/pageScripts.ts'
import * as ui from '../src/overlay.ts'

const samples: Record<string, string> = {
  SNAPSHOT_JS: scripts.SNAPSHOT_JS, FOCUS_JS: scripts.FOCUS_JS,
  locateJs: scripts.locateJs('text=Save changes'), locateJsNoScroll: scripts.locateJs('#x', false),
  UI_JS: ui.UI_JS,
  CAPTION_JS: ui.CAPTION_JS('A caption with "quotes" and \'apostrophes\''), CAPTION_OFF: ui.CAPTION_JS(''),
  CURSOR_JS: ui.CURSOR_JS(10, 20, 600), CLICK_JS: ui.CLICK_JS(1, 2, '#4cc3ff'), HUD_JS: ui.HUD_JS("key(['⌘', 'S'])"),
  HIGHLIGHT: ui.ANNOTATE_JS('highlight'), CALLOUT: ui.ANNOTATE_JS('callout', { text: 'The new total, with "quotes"', n: 2 }), BADGE: ui.ANNOTATE_JS('badge', { n: 3 }),
  REMOVE: ui.REMOVE_JS(4), CLEAR_ALL: ui.CLEAR_JS(), CLEAR_ONE: ui.CLEAR_JS('arrow'),
  FX_HIDE: ui.FX_JS(true), FX_SHOW: ui.FX_JS(false), ACCENT_JS: ui.ACCENT_JS('#123456'), WITHOUT: ui.WITHOUT_OVERLAYS('document.body.innerText'),
}
for (const [name, js] of Object.entries(samples)) test(`${name} parses`, () => { assert.doesNotThrow(() => new Function(js), `${name} does not parse`) })
test('the runtime has every call the daemon makes', () => { for (const call of ['caption(', 'cursor(', 'typed(', 'key(', 'ripple(', 'mouse(', 'hold(', 'move(', 'release(', 'wheel(', 'add(', 'remove(', 'clear(', 'hide(']) assert.ok(ui.UI_JS.includes(call), call) })
test('the runtime draws every annotation', () => { for (const kind of ui.ANNOTATIONS) assert.ok(ui.UI_JS.includes(`${kind}: (el`), kind) })

// Every script lantern runs inside a page must at least parse: a quote out of place in one of these strings takes
// the click rings, keycaps and pills out of every recording without a word said. No browser needed here.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as scripts from '../src/pageScripts.ts'

const samples: Record<string, string> = {
  SNAPSHOT_JS: scripts.SNAPSHOT_JS, FOCUS_JS: scripts.FOCUS_JS, HUD_JS: scripts.HUD_JS,
  locateJs: scripts.locateJs('text=Save changes'), locateJsNoScroll: scripts.locateJs('#x', false),
  CAPTION_JS: scripts.CAPTION_JS('A caption with "quotes" and \'apostrophes\''), CAPTION_OFF: scripts.CAPTION_JS(''),
  CURSOR_JS: scripts.CURSOR_JS(10, 20, 600), HIGHLIGHT_ON: scripts.HIGHLIGHT_JS(true), HIGHLIGHT_OFF: scripts.HIGHLIGHT_JS(false),
  CLICK_JS: scripts.CLICK_JS(1, 2, '#4cc3ff'),
  CALLOUT: scripts.CALLOUT_JS('The new total, with "quotes"', 2), CALLOUT_OFF: scripts.CALLOUT_JS(''),
  FX_HIDE: scripts.FX_JS(true), FX_SHOW: scripts.FX_JS(false), ACCENT_JS: scripts.ACCENT_JS('#123456'),
}
for (const [name, js] of Object.entries(samples)) test(`${name} parses`, () => { assert.doesNotThrow(() => new Function(js), `${name} does not parse`) })
test('the HUD has every call the page makes', () => { for (const call of ['typed(', 'key(', 'ripple(', 'mouse(', 'hold(', 'move(', 'release(', 'wheel(']) assert.ok(scripts.HUD_JS.includes(call), call) })

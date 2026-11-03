// Scripts lantern runs inside the page it is driving. They are strings, not functions: what runs in the page must be
// exactly what is written here, whatever a bundler might do to the code around it.

/**
 * What is on the page that an agent can act on, in reading order: every control (native ones, ARIA roles, and
 * the clickable <div>s a React app is full of), plus headings, dialogs and alerts for orientation. Each control
 * gets a ref (e1, e2…) that click and fill accept; the elements are kept on window.__lantern until the next
 * snapshot. Returns { url, title, lines, more }.
 */
export const SNAPSHOT_JS = String.raw`
(() => {
  const MAX = 300
  const refs = new Map(); window.__lantern = Object.assign(window.__lantern || {}, { refs })
  const lines = []; let n = 0, more = 0
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const cut = (s, m = 80) => (s.length > m ? s.slice(0, m - 1) + '…' : s)
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.01 }
  const NATIVE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[contenteditable=""],[contenteditable=true]'
  const ROLES = ['button','link','textbox','searchbox','combobox','checkbox','radio','switch','slider','spinbutton','tab','menuitem','menuitemcheckbox','menuitemradio','option','treeitem']
  const CONTROL = NATIVE + ',' + ROLES.map((r) => '[role=' + r + ']').join(',')
  const roleOf = (el) => {
    const r = el.getAttribute('role'); if (r && ROLES.includes(r)) return r
    const t = el.tagName.toLowerCase()
    if (t === 'a' && el.hasAttribute('href')) return 'link'
    if (t === 'button' || t === 'summary') return 'button'
    if (t === 'select') return 'combobox'
    if (t === 'textarea') return 'textbox'
    if (t === 'input') { const ty = (el.getAttribute('type') || 'text').toLowerCase(); return ty === 'hidden' ? null : ty === 'checkbox' ? 'checkbox' : ty === 'radio' ? 'radio' : ty === 'range' ? 'slider' : (ty === 'button' || ty === 'submit' || ty === 'reset') ? 'button' : ty === 'search' ? 'searchbox' : 'textbox' }
    if (el.isContentEditable && !(el.parentElement && el.parentElement.isContentEditable)) return 'textbox'
    return null
  }
  const nameOf = (el) => {
    const lab = el.getAttribute('aria-label'); if (lab) return clean(lab)
    const by = el.getAttribute('aria-labelledby')
    if (by) { const t = clean(by.split(/\s+/).map((id) => (document.getElementById(id) || {}).innerText || '').join(' ')); if (t) return t }
    if (el.labels && el.labels.length) { const t = clean([...el.labels].map((l) => l.innerText).join(' ')); if (t) return t }
    const tag = el.tagName.toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return clean(el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('title') || '')
    const t = clean(el.innerText); if (t) return t
    const img = el.querySelector('img[alt]'); const svg = el.querySelector('svg title')
    return clean(el.getAttribute('title') || (img && img.getAttribute('alt')) || (svg && svg.textContent) || '')
  }
  const states = (el, role) => {
    const s = []
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') s.push('disabled')
    if (el.checked === true || el.getAttribute('aria-checked') === 'true') s.push('checked')
    if (el.getAttribute('aria-selected') === 'true') s.push('selected')
    if (el.hasAttribute('aria-expanded')) s.push(el.getAttribute('aria-expanded') === 'true' ? 'expanded' : 'collapsed')
    if ((role === 'textbox' || role === 'searchbox' || role === 'combobox') && 'value' in el && el.value) s.push('value="' + cut(String(el.value), 40) + '"')
    return s.length ? ' (' + s.join(', ') + ')' : ''
  }
  const add = (el, role) => {
    if (n >= MAX) { more++; return }
    const ref = 'e' + (++n); refs.set(ref, el)
    lines.push('- ' + role + ' "' + cut(nameOf(el)) + '" [' + ref + ']' + states(el, role))
  }
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
  for (let el = walk.nextNode(); el; el = walk.nextNode()) {
    if (el.id && el.id.startsWith('__lantern')) continue
    if (el.closest('[aria-hidden=true],[inert]') || !vis(el)) continue
    const tag = el.tagName.toLowerCase(); const r = el.getAttribute('role')
    if (/^h[1-6]$/.test(tag) || r === 'heading') { const t = clean(el.innerText); if (t) lines.push('# ' + cut(t, 100)); continue }
    if ((tag === 'dialog' && el.open) || r === 'dialog' || r === 'alertdialog') { lines.push('[dialog' + (nameOf(el) && el.getAttribute('aria-label') ? ' "' + cut(nameOf(el)) + '"' : '') + ']'); continue }
    if (r === 'alert' || r === 'status') { const t = clean(el.innerText); if (t) lines.push('[' + r + '] ' + cut(t, 160)); continue }
    const role = roleOf(el)
    if (role) { add(el, role); continue }
    // A <div onClick>: the pointer cursor is the one thing such an element reliably has. Take the outermost
    // element of a pointer region, and only when it holds no real control of its own (that one is listed instead).
    if (getComputedStyle(el).cursor === 'pointer' && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') && !el.querySelector(CONTROL) && nameOf(el)) add(el, 'clickable')
  }
  return { url: location.href, title: document.title, lines, more }
})()`

/**
 * Find what a click or fill is aimed at — a ref from the last snapshot, "text=Exact label", or a CSS selector —
 * scroll it into view, and say where its middle is. Returns { x, y, rect, name } or { error }.
 */
export const locateJs = (target: string, scroll = true) => String.raw`
(() => {
  const t = ${JSON.stringify(target)}, scroll = ${scroll}
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
  let el = null
  try {
    if (/^e\d+$/.test(t)) { el = (window.__lantern && window.__lantern.refs && window.__lantern.refs.get(t)) || null; if (!el) return { error: 'no element ' + t + ' — refs come from the last snapshot; take a new one' } }
    else if (t.startsWith('text=')) {
      const want = clean(t.slice(5)).toLowerCase()
      const hits = [...document.body.querySelectorAll('*')].filter((e) => !(e.id && e.id.startsWith('__lantern')) && clean(e.innerText).toLowerCase() === want && e.getBoundingClientRect().width > 0)
      const inner = hits.filter((e) => !hits.some((o) => o !== e && e.contains(o))) // the innermost elements with exactly that text
      // A page title and a tab can read the same. Prefer the one that is something you'd press.
      const pressable = (e) => e.closest('a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=radio],[role=switch]') || getComputedStyle(e).cursor === 'pointer'
      el = inner.find(pressable) || inner[0] || null
      if (!el) return { error: 'nothing on the page reads "' + t.slice(5) + '"' }
    } else { el = document.querySelector(t); if (!el) return { error: 'no element matches ' + t } }
  } catch (e) { return { error: String(e && e.message || e) } }
  if (!el.isConnected) return { error: t + ' is no longer on the page — take a new snapshot' }
  if (scroll) el.scrollIntoView({ block: 'center', inline: 'center' })
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return { error: t + ' is not visible' }
  window.__lantern = window.__lantern || { refs: new Map() }; window.__lantern.last = el
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, rect: { x: r.left, y: r.top, width: r.width, height: r.height }, name: clean(el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || (el.labels && el.labels.length && [...el.labels].map((l) => l.innerText).join(' ')) || el.tagName.toLowerCase()).slice(0, 60) }
})()`

/** Focus the element the last locate found and select what is in it, ready for typing to replace it. */
export const FOCUS_JS = String.raw`
(() => {
  const el = window.__lantern && window.__lantern.last
  if (!el) return false
  el.focus()
  if (typeof el.select === 'function') el.select()
  else if (el.isContentEditable) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r) }
  return document.activeElement === el || el.contains(document.activeElement)
})()`

/** Key names `lantern press` accepts, as the fields CDP's Input.dispatchKeyEvent wants. */
export const KEYS: Record<string, { key: string; code: string; vk: number; text?: string }> = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' }, Tab: { key: 'Tab', code: 'Tab', vk: 9 }, Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 }, Delete: { key: 'Delete', code: 'Delete', vk: 46 }, Space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 }, ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 }, ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 }, ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  Home: { key: 'Home', code: 'Home', vk: 36 }, End: { key: 'End', code: 'End', vk: 35 }, PageUp: { key: 'PageUp', code: 'PageUp', vk: 33 }, PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 },
}
export const KEY_GLYPH: Record<string, string> = { cmd: '⌘', meta: '⌘', command: '⌘', ctrl: '⌃', control: '⌃', alt: '⌥', option: '⌥', shift: '⇧', Enter: '↩ enter', Escape: 'esc', Tab: '⇥ tab', Backspace: '⌫', Delete: '⌦', Space: '␣ space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Home: 'home', End: 'end', PageUp: 'page ↑', PageDown: 'page ↓' }

// ---- Drawn into the page, so they are in screenshots and recordings. ----

/** Lantern's colours: an ember orange on dark, and a cool blue for the right button. */
export const ORANGE = '#ff7a2f'
export const BLUE = '#4cc3ff'
const DARK = 'rgba(22,22,26,.9)'
const GLOW = 'rgba(255,122,47,.38)'

/** A caption along the bottom of the page: what the viewer is about to see. */
export const CAPTION_JS = (text: string) => `(() => { let c = document.getElementById('__lantern_caption'); if (!${JSON.stringify(!!text)}) { c?.remove(); return } if (!c) { c = document.createElement('div'); c.id = '__lantern_caption'; c.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;padding:10px 18px;border-radius:12px;background:${DARK};color:#fff;font:600 16px/1.3 -apple-system,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);pointer-events:none;max-width:80vw;text-align:center'; document.body.appendChild(c) } c.textContent = ${JSON.stringify(text)} })()`

/** The pointer: a classic arrow that glides to each target and stays, so the viewer can follow the hand. Hidden for screenshots. */
export const CURSOR_JS = (x: number, y: number, ms = 250) => `(() => { let c = document.getElementById('__lantern_cursor'); if (!c) { c = document.createElement('div'); c.id = '__lantern_cursor'; c.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transition:transform ${ms}ms cubic-bezier(.2,.8,.2,1);filter:drop-shadow(0 1.5px 2px rgba(0,0,0,.35)) drop-shadow(0 4px 10px rgba(0,0,0,.18))'; c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 3 L5 19 L9.3 15.4 L12.3 21.6 L15.1 20.3 L12.1 14.2 L17.6 14 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'; document.body.appendChild(c); c.style.transform = 'translate(' + (innerWidth / 2) + 'px,' + (innerHeight * 0.8) + 'px)'; c.getBoundingClientRect() } c.style.transition = 'transform ${ms}ms cubic-bezier(.2,.8,.2,1)'; c.style.transform = 'translate(' + (${x} - 5.5) + 'px,' + (${y} - 3) + 'px)' })()`

/**
 * A glowing box around the element being talked about (the one the last locate found). It follows the element —
 * scrolls, re-layouts — and goes when the element does. No pulse: an animation repaints the page a dozen times a
 * second, and the recorder, which keeps every repaint, could no longer tell a pause from action.
 */
export const HIGHLIGHT_JS = (on: boolean) => `(() => { const old = window.__lantern_hl; if (old) { cancelAnimationFrame(old.raf); old.box.remove(); window.__lantern_hl = null } if (!${on}) return; const el = window.__lantern && window.__lantern.last; if (!el) return; const box = document.createElement('div'); box.id = '__lantern_hl'; box.style.cssText = 'position:fixed;border-radius:14px;border:3px solid ${ORANGE};box-shadow:0 0 0 4px ${GLOW},0 0 28px 8px ${GLOW};z-index:2147483646;pointer-events:none'; document.body.appendChild(box); const pad = 12; const st = { box, raf: 0 }; const tick = () => { if (!el.isConnected) { box.remove(); window.__lantern_hl = null; return } const r = el.getBoundingClientRect(), cs = getComputedStyle(el); if (!r.width || !r.height || cs.visibility === 'hidden') box.style.display = 'none'; else { box.style.display = ''; box.style.left = (r.left - pad) + 'px'; box.style.top = (r.top - pad) + 'px'; box.style.width = (r.width + 2 * pad) + 'px'; box.style.height = (r.height + 2 * pad) + 'px' } st.raf = requestAnimationFrame(tick) }; tick(); window.__lantern_hl = st })()`

/**
 * What a viewer can't otherwise see: the keys being pressed (a keycap strip that fades when the typing stops) and
 * what the mouse is doing (a little mouse by the pointer: click, right click, double click, drag, scroll). Installed
 * once per page, idempotent, drawn only while recording.
 */
export const HUD_JS = `(() => { if (window.__lanternHud) return; const Z = 2147483647; const mk = (css, html) => { const d = document.createElement('div'); d.className = '__lantern_fx'; d.style.cssText = css; if (html) d.innerHTML = html; document.body.appendChild(d); return d }; if (!document.getElementById('__lantern_hud_css')) { const st = document.createElement('style'); st.id = '__lantern_hud_css'; st.textContent = '@keyframes __lpop{0%{transform:scale(.6);opacity:0}100%{transform:scale(1);opacity:1}} @keyframes __lripple{0%{transform:scale(.3);opacity:.9}100%{transform:scale(2.2);opacity:0}} @keyframes __lwheel{0%{transform:translateY(-5px);opacity:0}30%{opacity:1}70%{opacity:1}100%{transform:translateY(5px);opacity:0}} @keyframes __lwheelup{0%{transform:translateY(5px);opacity:0}30%{opacity:1}70%{opacity:1}100%{transform:translateY(-5px);opacity:0}} @keyframes __lfade{to{opacity:0;transform:translateY(-4px) scale(.9)}}'; document.head.appendChild(st) } let keys = null, keysT = 0, typed = ''; const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;'); const show = () => { if (!keys || !keys.isConnected) keys = mk('position:fixed;left:50%;transform:translateX(-50%);bottom:84px;z-index:' + Z + ';display:flex;gap:6px;align-items:center;padding:8px 12px;border-radius:10px;background:${DARK};color:#fff;font:600 15px/1.2 -apple-system,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);pointer-events:none;transition:opacity .3s'); keys.style.opacity = '1'; clearTimeout(keysT); keysT = setTimeout(() => { if (keys) keys.style.opacity = '0'; typed = '' }, 1400) }; const cap = (t) => '<span style="display:inline-block;padding:3px 8px;border-radius:6px;background:#fff;color:#16161a;font-weight:700;font-size:13px;box-shadow:0 2px 0 #b8b8c0;animation:__lpop .18s ease-out">' + esc(t) + '</span>'; const MOUSE = (lit, color) => '<svg viewBox="0 0 24 32" width="22" height="30" style="display:block;overflow:visible"><rect x="3" y="2" width="18" height="28" rx="9" fill="#fff" stroke="#16161a" stroke-width="1.5"/>' + (lit === 'left' ? '<path d="M12 3 C7.2 3 4 6.6 4 11 V13 H12 Z" fill="' + color + '"/>' : lit === 'right' ? '<path d="M12 3 C16.8 3 20 6.6 20 11 V13 H12 Z" fill="' + color + '"/>' : '') + '<path d="M12 3 V13 M4 13 H20" stroke="#16161a" stroke-width="1.2" fill="none"/><rect x="11" y="6" width="2" height="4.5" rx="1" fill="#16161a"/></svg>'; let held = null; window.__lanternHud = { typed(ch) { typed = (typed + ch).slice(-36); show(); keys.innerHTML = '<svg viewBox=\'0 0 24 16\' width=\'18\' height=\'12\' style=\'display:block;opacity:.75\'><rect x=\'1\' y=\'1\' width=\'22\' height=\'14\' rx=\'3\' fill=\'none\' stroke=\'#fff\' stroke-width=\'1.5\'/><path d=\'M5 5h2M9 5h2M13 5h2M17 5h2M5 8h2M9 8h2M13 8h2M17 8h2M7 11h10\' stroke=\'#fff\' stroke-width=\'1.5\' stroke-linecap=\'round\'/></svg><span style="font-family:ui-monospace,Menlo,monospace;font-size:14px;white-space:pre">' + esc(typed) + '</span><span style="opacity:.7">|</span>' }, key(parts) { typed = ''; show(); keys.innerHTML = '<svg viewBox=\'0 0 24 16\' width=\'18\' height=\'12\' style=\'display:block;opacity:.75\'><rect x=\'1\' y=\'1\' width=\'22\' height=\'14\' rx=\'3\' fill=\'none\' stroke=\'#fff\' stroke-width=\'1.5\'/><path d=\'M5 5h2M9 5h2M13 5h2M17 5h2M5 8h2M9 8h2M13 8h2M17 8h2M7 11h10\' stroke=\'#fff\' stroke-width=\'1.5\' stroke-linecap=\'round\'/></svg>' + parts.map(cap).join('<span style="opacity:.6;margin:0 1px">+</span>') }, ripple(x, y, color) { for (const delay of [0, 160]) { const d = mk('position:fixed;left:' + x + 'px;top:' + y + 'px;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;border:2.5px solid ' + color + ';z-index:' + (Z - 1) + ';pointer-events:none;animation:__lripple .65s ease-out ' + delay + 'ms both'); setTimeout(() => d.remove(), 900) } }, mouse(x, y, lit, color, times) { const d = mk('position:fixed;left:' + (x + 16) + 'px;top:' + (y + 14) + 'px;z-index:' + Z + ';pointer-events:none;filter:drop-shadow(0 3px 8px rgba(0,0,0,.3));animation:__lpop .18s ease-out', MOUSE(lit, color) + (times > 1 ? '<span style="position:absolute;left:16px;top:-6px;padding:1px 5px;border-radius:999px;background:' + color + ';color:#16161a;font:800 10px/1.4 -apple-system,system-ui,sans-serif">×' + times + '</span>' : '')); setTimeout(() => { d.style.animation = '__lfade .35s ease-in both' }, 750); setTimeout(() => d.remove(), 1150) }, hold(x, y, color) { this.release(); held = mk('position:fixed;left:' + (x + 16) + 'px;top:' + (y + 14) + 'px;z-index:' + Z + ';pointer-events:none;filter:drop-shadow(0 3px 8px rgba(0,0,0,.3));animation:__lpop .18s ease-out;transition:left .08s linear,top .08s linear', MOUSE('left', color)) }, move(x, y) { if (held) { held.style.left = (x + 16) + 'px'; held.style.top = (y + 14) + 'px' } }, release() { if (held) { const h = held; held = null; h.style.animation = '__lfade .35s ease-in both'; setTimeout(() => h.remove(), 400) } }, wheel(x, y, dir) { const up = dir === 'up', horiz = dir === 'left' || dir === 'right'; const d = mk('position:fixed;left:' + (x + 16) + 'px;top:' + (y + 14) + 'px;z-index:' + Z + ';pointer-events:none;filter:drop-shadow(0 3px 8px rgba(0,0,0,.3));animation:__lpop .18s ease-out', MOUSE('', '') + '<div style="position:absolute;left:0;top:0;width:22px;height:30px;overflow:hidden"><div style="position:absolute;left:0;right:0;top:14px;text-align:center;color:${ORANGE};font:900 16px/1 -apple-system,system-ui,sans-serif;animation:' + (up ? '__lwheelup' : '__lwheel') + ' .55s linear infinite' + (horiz ? ';transform:rotate(-90deg)' : '') + '">' + (horiz ? (dir === 'left' ? '⌃⌃' : '⌄⌄') : (up ? '⌃' : '⌄')) + '</div></div>'); setTimeout(() => { d.style.animation = '__lfade .35s ease-in both' }, 1100); setTimeout(() => d.remove(), 1500) } } })()`

/** The ring and the word, as a click lands. */
export const CLICK_JS = (x: number, y: number, color = ORANGE) => `${HUD_JS}; window.__lanternHud.ripple(${x}, ${y}, ${JSON.stringify(color)})`

/** Hide (or show again) everything lantern drew: the pointer and any click/key effects stay out of screenshots. */
export const FX_JS = (hidden: boolean) => `document.querySelectorAll('#__lantern_cursor, .__lantern_fx').forEach((e) => { e.style.visibility = ${JSON.stringify(hidden ? 'hidden' : '')} })`

// Scripts lantern runs inside the page it is driving. They are strings, not functions: what runs in the page must be
// exactly what is written here, whatever a bundler might do to the code around it.

/**
 * What is on the page that an agent can act on, in reading order: every control (native ones, ARIA roles, and
 * the clickable <div>s a React app is full of), plus headings, dialogs and alerts for orientation. Open shadow
 * roots are walked too. An open dialog is listed first, since it is what the person sees. Each control gets a
 * ref (e1, e2…) that click and fill accept; the elements are kept on window.__lantern until the next snapshot.
 * Returns { url, title, lines, more }.
 */
export const SNAPSHOT_JS = String.raw`
(() => {
  const MAX = 300
  const refs = new Map(); window.__lantern = Object.assign(window.__lantern || {}, { refs })
  const lines = [], dialogLines = []; let n = 0, more = 0
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const cut = (s, m = 80) => (s.length > m ? s.slice(0, m - 1) + '…' : s)
  // An invisible native control (a checkbox at opacity 0 under a drawn one, a file input behind a button) still takes the click.
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && (Number(s.opacity) > 0.01 || /^(input|select|textarea|button)$/i.test(el.tagName)) }
  const NATIVE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[contenteditable=""],[contenteditable=true]'
  const ROLES = ['button','link','textbox','searchbox','combobox','checkbox','radio','switch','slider','spinbutton','tab','menuitem','menuitemcheckbox','menuitemradio','option','treeitem']
  const CONTROL = NATIVE + ',' + ROLES.map((r) => '[role=' + r + ']').join(',')
  const DIALOG = 'dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]'
  const roleOf = (el) => {
    const r = el.getAttribute('role'); if (r && ROLES.includes(r)) return r
    const t = el.tagName.toLowerCase()
    if (t === 'a' && el.hasAttribute('href')) return 'link'
    if (t === 'button' || t === 'summary') return 'button'
    if (t === 'select') return el.multiple ? 'listbox' : 'combobox'
    if (t === 'textarea') return 'textbox'
    if (t === 'input') { const ty = (el.getAttribute('type') || 'text').toLowerCase(); return ty === 'hidden' ? null : ty === 'checkbox' ? 'checkbox' : ty === 'radio' ? 'radio' : ty === 'range' ? 'slider' : (ty === 'button' || ty === 'submit' || ty === 'reset') ? 'button' : ty === 'search' ? 'searchbox' : ty === 'file' ? 'file' : ['date','time','datetime-local','month','week','color','number'].includes(ty) ? ty : 'textbox' }
    if (el.isContentEditable && !(el.parentElement && el.parentElement.isContentEditable)) return 'textbox'
    return null
  }
  const nameOf = (el) => {
    const lab = el.getAttribute('aria-label'); if (lab) return clean(lab)
    const by = el.getAttribute('aria-labelledby')
    if (by) { const t = clean(by.split(/\s+/).map((id) => (document.getElementById(id) || {}).innerText || '').join(' ')); if (t) return t }
    if (el.labels && el.labels.length) { const t = clean([...el.labels].map((l) => [...l.childNodes].filter((n) => n !== el && !(n.contains && n.contains(el))).map((n) => n.textContent).join(' ')).join(' ')); if (t) return t }
    const tag = el.tagName.toLowerCase()
    if (tag === 'input') { const ty = (el.getAttribute('type') || 'text').toLowerCase(); if (ty === 'submit' || ty === 'button' || ty === 'reset') return clean(el.value || (ty === 'submit' ? 'Submit' : '')); const t = clean(el.getAttribute('placeholder') || el.getAttribute('title') || ''); if (t) return t; const beside = el.nextSibling && el.nextSibling.nodeType === 3 ? clean(el.nextSibling.textContent) : ''; if (beside) return beside; if ((ty === 'radio' || ty === 'checkbox') && el.value && el.value !== 'on') return clean((el.getAttribute('name') ? el.getAttribute('name') + ': ' : '') + el.value); return clean(el.getAttribute('name') || '') }
    if (tag === 'textarea') return clean(el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('title') || '')
    if (tag === 'select') return clean(el.getAttribute('name') || el.getAttribute('title') || el.id || (el.options[0] && el.options[0].text) || '')
    const t = clean(el.innerText); if (t) return t
    const img = el.querySelector('img[alt]'); const svg = el.querySelector('svg title')
    const beside = el.nextSibling && el.nextSibling.nodeType === 3 ? clean(el.nextSibling.textContent) : ''
    const href = tag === 'a' && el.getAttribute('href') ? clean(el.getAttribute('href').replace(/[?#].*$/, '').split('/').filter(Boolean).pop() || '') : ''
    return clean(el.getAttribute('title') || (img && img.getAttribute('alt')) || (svg && svg.textContent) || beside || el.getAttribute('aria-describedby') && clean((document.getElementById(el.getAttribute('aria-describedby')) || {}).innerText || '') || href || '')
  }
  const states = (el, role) => {
    const s = []
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') s.push('disabled')
    if (el.checked === true || el.getAttribute('aria-checked') === 'true') s.push('checked')
    if (el.getAttribute('aria-selected') === 'true') s.push('selected')
    if (el.hasAttribute('aria-expanded')) s.push(el.getAttribute('aria-expanded') === 'true' ? 'expanded' : 'collapsed')
    if ((role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'number' || role === 'date' || role === 'time' || role === 'slider' || role === 'color') && 'value' in el && el.value) s.push('value="' + cut(String(el.value), 40) + '"')
    if (role === 'listbox' && el.selectedOptions) s.push('chosen: ' + cut([...el.selectedOptions].map((o) => o.text.trim()).join(', '), 60))
    return s.length ? ' (' + s.join(', ') + ')' : ''
  }
  const add = (out, el, role) => {
    if (n >= MAX) { more++; return }
    const ref = 'e' + (++n); refs.set(ref, el)
    out.push('- ' + role + ' "' + cut(nameOf(el)) + '" [' + ref + ']' + states(el, role))
  }
  // The document, then every open shadow root inside it, in order.
  const walk = (root, inDialog) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    for (let el = w.nextNode(); el; el = w.nextNode()) {
      if (el.id && String(el.id).startsWith('__lantern')) continue
      if (el.closest('[aria-hidden=true],[inert]')) continue
      const dialog = inDialog || !!el.closest(DIALOG)
      const out = dialog ? dialogLines : lines
      if (el.shadowRoot) walk(el.shadowRoot, dialog)
      if (!vis(el)) continue
      const tag = el.tagName.toLowerCase(); const r = el.getAttribute('role')
      if (/^h[1-6]$/.test(tag) || r === 'heading') { const t = clean(el.innerText); if (t) out.push('# ' + cut(t, 100)); continue }
      if (el.matches(DIALOG)) { out.push('[dialog' + (el.getAttribute('aria-label') ? ' "' + cut(clean(el.getAttribute('aria-label'))) + '"' : '') + ']'); continue }
      if (r === 'alert' || r === 'status') { const t = clean(el.innerText); if (t) out.push('[' + r + '] ' + cut(t, 160)); continue }
      if (tag === 'iframe' || tag === 'frame') { out.push('- ' + tag + ' "' + cut(clean(el.getAttribute('title') || el.getAttribute('name') || el.getAttribute('src') || '')) + '" (not looked inside: click it and type, or eval)'); continue }
      if (tag === 'label' && el.control) continue // the control it labels is listed, under this label's text
      const role = roleOf(el)
      if (role) { add(out, el, role); continue }
      // A <div onClick>: the pointer cursor is the one thing such an element reliably has. Take the outermost
      // element of a pointer region, and only when it holds no real control of its own (that one is listed instead).
      if (getComputedStyle(el).cursor === 'pointer' && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') && !el.querySelector(CONTROL) && nameOf(el)) add(out, el, 'clickable')
    }
  }
  walk(document.body, false)
  const all = dialogLines.length ? ['[a dialog is open — this is it; the page below is behind it]', ...dialogLines, '', '[behind the dialog]', ...lines] : lines
  return { url: location.href, title: document.title, lines: all, more }
})()`

/**
 * Find what a click or fill is aimed at — a ref from the last snapshot, "text=Exact label", or a CSS selector —
 * scroll it into view, and say where its middle is. Open shadow roots are searched too. Returns
 * { x, y, rect, name, matches, scroll } or { error }, and { covered } when something else would take the click.
 */
export const locateJs = (target: string, scroll = true) => String.raw`
(() => {
  const t = ${JSON.stringify(target)}, scroll = ${scroll}
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const isMine = (e) => e.id && String(e.id).startsWith('__lantern')
  // Every element in the document and in every open shadow root, in order.
  const deep = (root, out) => { for (const e of root.querySelectorAll('*')) { if (isMine(e)) continue; out.push(e); if (e.shadowRoot) deep(e.shadowRoot, out) } return out }
  const q = (root, sel) => { const hit = root.querySelector(sel); if (hit) return hit; for (const e of root.querySelectorAll('*')) if (e.shadowRoot) { const h = q(e.shadowRoot, sel); if (h) return h } return null }
  let el = null, matches = 1
  try {
    if (/^e\d+$/.test(t)) { el = (window.__lantern && window.__lantern.refs && window.__lantern.refs.get(t)) || null; if (!el) return { error: 'no element ' + t + ' — refs come from the last snapshot; take a new one' } }
    else if (t.startsWith('text=')) {
      const want = clean(t.slice(5)).toLowerCase()
      const all = deep(document.body, []).filter((e) => e.getBoundingClientRect().width > 0)
      const hits = all.filter((e) => clean(e.innerText).toLowerCase() === want)
      const inner = hits.filter((e) => !hits.some((o) => o !== e && e.contains(o))) // the innermost elements with exactly that text
      // A page title and a tab can read the same. Prefer the one that is something you'd press.
      const pressable = (e) => e.closest('a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=radio],[role=switch]') || getComputedStyle(e).cursor === 'pointer'
      el = inner.find(pressable) || inner[0] || null
      matches = inner.length
      // Nothing reads that: an element named by its label, placeholder, aria-label, title or button value — the name the snapshot showed.
      if (!el) { const names = (e) => [e.getAttribute('aria-label'), e.getAttribute('placeholder'), e.getAttribute('title'), e.labels && [...e.labels].map((l) => l.innerText).join(' '), e.tagName === 'INPUT' && /^(submit|button|reset)$/i.test(e.type) && e.value]; const named = all.filter((e) => names(e).some((v) => v && clean(v).toLowerCase() === want)); el = named[0] || null; matches = named.length }
      if (!el) { const near = all.filter((e) => { const x = clean(e.innerText); return x && x.length <= 80 && x.toLowerCase().includes(want) && !e.querySelector('*') }); return { error: near.length ? 'nothing on the page reads exactly "' + t.slice(5) + '"; "' + clean(near[0].innerText) + '" does — use that, or a selector' : 'nothing on the page reads "' + t.slice(5) + '"' } }
    } else { try { el = q(document, t) } catch (e) { return { error: 'not a valid CSS selector: ' + t + ' (to find something by its text, use "text=…" in quotes)' } }; if (!el) return { error: 'no element matches ' + t } }
  } catch (e) { return { error: String(e && e.message || e) } }
  if (!el.isConnected) return { error: t + ' is no longer on the page — take a new snapshot' }
  if (scroll) el.scrollIntoView({ block: 'center', inline: 'center' })
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return { error: t + ' is not visible' }
  window.__lantern = window.__lantern || { refs: new Map() }; window.__lantern.last = el
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2
  // What is really at that point: if it is neither the element nor part of it, a click there goes somewhere else.
  let covered = null
  if (scroll && cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight) {
    const root = el.getRootNode(); let at = (root.elementFromPoint ? root : document).elementFromPoint(cx, cy)
    while (at && at.shadowRoot && at.shadowRoot.elementFromPoint) { const inner = at.shadowRoot.elementFromPoint(cx, cy); if (!inner || inner === at) break; at = inner }
    const lab = at && at.closest && at.closest('label')
    const related = (a, b) => a === b || a.contains(b) || b.contains(a) || (a.shadowRoot && a.shadowRoot.contains(b)) || (b.shadowRoot && b.shadowRoot.contains(a)) || (lab && (lab.control === b || lab.contains(b)))
    if (at && !isMine(at) && !related(at, el)) covered = at.tagName.toLowerCase() + (at.id ? '#' + at.id : '') + (at.className && typeof at.className === 'string' ? '.' + at.className.trim().split(/\s+/).slice(0, 2).join('.') : '')
  }
  const name = clean(el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || (el.labels && el.labels.length && [...el.labels].map((l) => l.innerText).join(' ')) || (el.tagName === 'INPUT' && /^(submit|button|reset)$/i.test(el.type) && el.value) || el.getAttribute('title') || el.tagName.toLowerCase()).slice(0, 60)
  return { x: cx, y: cy, rect: { x: r.left, y: r.top, width: r.width, height: r.height }, name, matches, covered, scroll: { x: scrollX, y: scrollY } }
})()`

/** Focus the element the last locate found and select what is in it, ready for typing to replace it. */
export const FOCUS_JS = String.raw`
(() => {
  const el = window.__lantern && window.__lantern.last
  if (!el) return false
  el.focus()
  if (typeof el.select === 'function') el.select()
  else if (el.isContentEditable) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r) }
  const active = el.getRootNode().activeElement || document.activeElement // inside a shadow root, the root knows
  return active === el || el.contains(active)
})()`

/** Key names `lantern press` accepts, as the fields CDP's Input.dispatchKeyEvent wants. */
export const KEYS: Record<string, { key: string; code: string; vk: number; text?: string }> = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' }, Tab: { key: 'Tab', code: 'Tab', vk: 9 }, Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 }, Delete: { key: 'Delete', code: 'Delete', vk: 46 }, Space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 }, ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 }, ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 }, ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  Home: { key: 'Home', code: 'Home', vk: 36 }, End: { key: 'End', code: 'End', vk: 35 }, PageUp: { key: 'PageUp', code: 'PageUp', vk: 33 }, PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 },
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, { key: `F${i + 1}`, code: `F${i + 1}`, vk: 112 + i }])),
}
export const KEY_GLYPH: Record<string, string> = { cmd: '⌘', meta: '⌘', command: '⌘', ctrl: '⌃', control: '⌃', alt: '⌥', option: '⌥', shift: '⇧', Enter: '↩ enter', Escape: 'esc', Tab: '⇥ tab', Backspace: '⌫', Delete: '⌦', Space: '␣ space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Home: 'home', End: 'end', PageUp: 'page ↑', PageDown: 'page ↓' }

// ---- Drawn into the page, so they are in screenshots and recordings. ----

/** Lantern's colours: an ember orange on dark, and a cool blue for the right button. */
export const ORANGE = '#ff7a2f'
export const BLUE = '#4cc3ff'
const DARK = 'rgba(22,22,26,.9)'
/** The accent, as the page's --lantern-accent variable (set from the settings) with the default behind it. */
const ACCENT = `var(--lantern-accent, ${ORANGE})`
const GLOW = `color-mix(in srgb, ${ACCENT} 38%, transparent)`
/** Give the page its accent colour, once per document. */
export const ACCENT_JS = (accent: string) => `document.documentElement.style.setProperty('--lantern-accent', ${JSON.stringify(accent)})`

/** A caption along the bottom of the page: what the viewer is about to see. */
export const CAPTION_JS = (text: string) => `(() => { let c = document.getElementById('__lantern_caption'); if (!${JSON.stringify(!!text)}) { c?.remove(); return } if (!c) { c = document.createElement('div'); c.id = '__lantern_caption'; c.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;padding:10px 18px;border-radius:12px;background:${DARK};color:#fff;font:600 16px/1.3 -apple-system,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);pointer-events:none;max-width:80vw;text-align:center'; document.body.appendChild(c) } c.textContent = ${JSON.stringify(text)} })()`

/** The pointer: a classic arrow that glides to each target and stays, so the viewer can follow the hand. Hidden for screenshots. */
export const CURSOR_JS = (x: number, y: number, ms = 250) => `(() => { window.__lantern_at = { x: ${x}, y: ${y} }; const k = document.getElementById('__lantern_keys'); if (k) { k.style.transition = 'left ${ms}ms cubic-bezier(.2,.8,.2,1), top ${ms}ms cubic-bezier(.2,.8,.2,1)'; k.style.left = (${x} + 22) + 'px'; k.style.top = (${y} + 52) + 'px' } let c = document.getElementById('__lantern_cursor'); if (!c) { c = document.createElement('div'); c.id = '__lantern_cursor'; c.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transition:transform ${ms}ms cubic-bezier(.2,.8,.2,1);filter:drop-shadow(0 1.5px 2px rgba(0,0,0,.35)) drop-shadow(0 4px 10px rgba(0,0,0,.18))'; c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 3 L5 19 L9.3 15.4 L12.3 21.6 L15.1 20.3 L12.1 14.2 L17.6 14 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'; document.body.appendChild(c); c.style.transform = 'translate(' + (innerWidth / 2) + 'px,' + (innerHeight * 0.8) + 'px)'; c.getBoundingClientRect() } c.style.transition = 'transform ${ms}ms cubic-bezier(.2,.8,.2,1)'; c.style.transform = 'translate(' + (${x} - 5.5) + 'px,' + (${y} - 3) + 'px)' })()`

/**
 * A glowing box around the element being talked about (the one the last locate found). It follows the element —
 * scrolls, re-layouts — and goes when the element does. No pulse: an animation repaints the page a dozen times a
 * second, and the recorder, which keeps every repaint, could no longer tell a pause from action.
 */
export const HIGHLIGHT_JS = (on: boolean) => `(() => { const old = window.__lantern_hl; if (old) { cancelAnimationFrame(old.raf); old.box.remove(); window.__lantern_hl = null } if (!${on}) return; const el = window.__lantern && window.__lantern.last; if (!el) return; const box = document.createElement('div'); box.id = '__lantern_hl'; box.style.cssText = 'position:fixed;border-radius:14px;border:3px solid ${ACCENT};box-shadow:0 0 0 4px ${GLOW},0 0 28px 8px ${GLOW};z-index:2147483646;pointer-events:none'; document.body.appendChild(box); const pad = 12; const st = { box, raf: 0 }; const tick = () => { if (!el.isConnected) { box.remove(); window.__lantern_hl = null; return } const r = el.getBoundingClientRect(), cs = getComputedStyle(el); if (!r.width || !r.height || cs.visibility === 'hidden') box.style.display = 'none'; else { box.style.display = ''; box.style.left = (r.left - pad) + 'px'; box.style.top = (r.top - pad) + 'px'; box.style.width = (r.width + 2 * pad) + 'px'; box.style.height = (r.height + 2 * pad) + 'px' } st.raf = requestAnimationFrame(tick) }; tick(); window.__lantern_hl = st })()`

/**
 * What a viewer can't otherwise see: the keys being pressed (a keycap strip that fades when the typing stops) and
 * what the mouse is doing (a little mouse by the pointer: click, right click, double click, drag, scroll). Installed
 * once per page, idempotent, drawn only while recording.
 */
export const HUD_JS = `(() => { if (window.__lanternHud) return; const Z = 2147483647; const mk = (css, html) => { const d = document.createElement('div'); d.className = '__lantern_fx'; d.style.cssText = css; if (html) d.innerHTML = html; document.body.appendChild(d); return d }; if (!document.getElementById('__lantern_hud_css')) { const st = document.createElement('style'); st.id = '__lantern_hud_css'; st.textContent = '@keyframes __lpop{0%{transform:scale(.6);opacity:0}100%{transform:scale(1);opacity:1}} @keyframes __lripple{0%{transform:scale(.3);opacity:.9}100%{transform:scale(2.2);opacity:0}} @keyframes __lwheel{0%{transform:translateY(-5px);opacity:0}30%{opacity:1}70%{opacity:1}100%{transform:translateY(5px);opacity:0}} @keyframes __lwheelup{0%{transform:translateY(5px);opacity:0}30%{opacity:1}70%{opacity:1}100%{transform:translateY(-5px);opacity:0}} @keyframes __lfade{to{opacity:0;transform:translateY(-4px) scale(.9)}} @keyframes __lkey{0%{transform:translateY(6px) scale(1.6);opacity:0}100%{transform:none;opacity:1}} @keyframes __lblink{50%{opacity:0}}'; document.head.appendChild(st) } let keys = null, keysT = 0, typed = ''; const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;'); const show = () => { const at = window.__lantern_at; if (!keys || !keys.isConnected) { keys = mk('position:fixed;z-index:' + Z + ';display:flex;gap:6px;align-items:center;padding:7px 11px;border-radius:10px;background:${DARK};color:#fff;font:600 15px/1.2 -apple-system,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);pointer-events:none;transition:opacity .3s;animation:__lpop .18s ease-out'); keys.id = '__lantern_keys' } if (at) { keys.style.left = Math.min(at.x + 22, innerWidth - 260) + 'px'; keys.style.top = Math.min(at.y + 52, innerHeight - 60) + 'px'; keys.style.bottom = ''; keys.style.transform = '' } else { keys.style.left = '50%'; keys.style.transform = 'translateX(-50%)'; keys.style.bottom = '84px'; keys.style.top = '' } keys.style.opacity = '1'; clearTimeout(keysT); keysT = setTimeout(() => { if (keys) { keys.style.opacity = '0'; const k = keys; setTimeout(() => { if (keys === k) { k.remove(); keys = null } }, 350) } typed = '' }, 1400) }; const cap = (t) => '<span style="display:inline-block;padding:3px 8px;border-radius:6px;background:#fff;color:#16161a;font-weight:700;font-size:13px;box-shadow:0 2px 0 #b8b8c0;animation:__lpop .18s ease-out">' + esc(t) + '</span>'; const MOUSE = (lit, color) => '<svg viewBox="0 0 24 32" width="22" height="30" style="display:block;overflow:visible"><rect x="3" y="2" width="18" height="28" rx="9" fill="#fff" stroke="#16161a" stroke-width="1.5"/>' + (lit === 'left' ? '<path d="M12 3 C7.2 3 4 6.6 4 11 V13 H12 Z" fill="' + color + '"/>' : lit === 'right' ? '<path d="M12 3 C16.8 3 20 6.6 20 11 V13 H12 Z" fill="' + color + '"/>' : '') + '<path d="M12 3 V13 M4 13 H20" stroke="#16161a" stroke-width="1.2" fill="none"/><rect x="11" y="6" width="2" height="4.5" rx="1" fill="#16161a"/></svg>'; let held = null; window.__lanternHud = { typed(ch) { typed = (typed + ch).slice(-28); show(); const shown = esc(typed.slice(0, -1)) + '<span style="display:inline-block;animation:__lkey .22s cubic-bezier(.2,1.4,.4,1)">' + esc(typed.slice(-1) === ' ' ? '␣' : typed.slice(-1)) + '</span>'; keys.innerHTML = '<svg viewBox="0 0 24 16" width="18" height="12" style="display:block;opacity:.75"><rect x="1" y="1" width="22" height="14" rx="3" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M5 5h2M9 5h2M13 5h2M17 5h2M5 8h2M9 8h2M13 8h2M17 8h2M7 11h10" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg><span style="font-family:ui-monospace,Menlo,monospace;font-size:14px;white-space:pre">' + shown + '</span><span style="opacity:.7;animation:__lblink 1s steps(2) infinite">|</span>' }, key(parts) { typed = ''; show(); keys.innerHTML = '<svg viewBox="0 0 24 16" width="18" height="12" style="display:block;opacity:.75"><rect x="1" y="1" width="22" height="14" rx="3" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M5 5h2M9 5h2M13 5h2M17 5h2M5 8h2M9 8h2M13 8h2M17 8h2M7 11h10" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>' + parts.map(cap).join('<span style="opacity:.6;margin:0 1px">+</span>') }, ripple(x, y, color) { for (const delay of [0, 160]) { const d = mk('position:fixed;left:' + x + 'px;top:' + y + 'px;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;border:2.5px solid ' + color + ';z-index:' + (Z - 1) + ';pointer-events:none;animation:__lripple .65s ease-out ' + delay + 'ms both'); setTimeout(() => d.remove(), 900) } }, mouse(x, y, lit, color, times) { const d = mk('position:fixed;left:' + (x + 16) + 'px;top:' + (y + 14) + 'px;z-index:' + Z + ';pointer-events:none;filter:drop-shadow(0 3px 8px rgba(0,0,0,.3));animation:__lpop .18s ease-out', MOUSE(lit, color) + (times > 1 ? '<span style="position:absolute;left:16px;top:-6px;padding:1px 5px;border-radius:999px;background:' + color + ';color:#16161a;font:800 10px/1.4 -apple-system,system-ui,sans-serif">×' + times + '</span>' : '')); setTimeout(() => { d.style.animation = '__lfade .35s ease-in both' }, 750); setTimeout(() => d.remove(), 1150) }, hold(x, y, color) { this.release(); held = mk('position:fixed;left:' + (x + 16) + 'px;top:' + (y + 14) + 'px;z-index:' + Z + ';pointer-events:none;filter:drop-shadow(0 3px 8px rgba(0,0,0,.3));animation:__lpop .18s ease-out;transition:left .08s linear,top .08s linear', MOUSE('left', color)) }, move(x, y) { if (held) { held.style.left = (x + 16) + 'px'; held.style.top = (y + 14) + 'px' } }, release() { if (held) { const h = held; held = null; h.style.animation = '__lfade .35s ease-in both'; setTimeout(() => h.remove(), 400) } }, wheel(x, y, dir) { const up = dir === 'up', horiz = dir === 'left' || dir === 'right'; const d = mk('position:fixed;left:' + (x + 16) + 'px;top:' + (y + 14) + 'px;z-index:' + Z + ';pointer-events:none;filter:drop-shadow(0 3px 8px rgba(0,0,0,.3));animation:__lpop .18s ease-out', MOUSE('', '') + '<div style="position:absolute;left:0;top:0;width:22px;height:30px;overflow:hidden"><div style="position:absolute;left:0;right:0;top:14px;text-align:center;color:${ACCENT};font:900 16px/1 -apple-system,system-ui,sans-serif;animation:' + (up ? '__lwheelup' : '__lwheel') + ' .55s linear infinite' + (horiz ? ';transform:rotate(-90deg)' : '') + '">' + (horiz ? (dir === 'left' ? '⌃⌃' : '⌄⌄') : (up ? '⌃' : '⌄')) + '</div></div>'); setTimeout(() => { d.style.animation = '__lfade .35s ease-in both' }, 1100); setTimeout(() => d.remove(), 1500) } } })()`

/** The ring and the word, as a click lands. */
export const CLICK_JS = (x: number, y: number, color = ORANGE) => `${HUD_JS}; window.__lanternHud.ripple(${x}, ${y}, ${JSON.stringify(color)})`

/**
 * A callout: the words about an element, in a label beside it, joined to it by a line, with the element lit. For
 * "this is the new total", "the error appears here". Follows the element and goes when it does, like the highlight.
 * Placed where there is room: right of the element, else left, else below, else above.
 */
export const CALLOUT_JS = (text: string, n?: number) => `(() => { const old = window.__lantern_co; if (old) { cancelAnimationFrame(old.raf); old.box.remove(); old.label.remove(); old.line.remove(); window.__lantern_co = null } if (!${JSON.stringify(!!text)}) return; const el = window.__lantern && window.__lantern.last; if (!el) return; const Z = 2147483646; const mk = (tag, css) => { const d = document.createElementNS(tag === 'svg' ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml', tag); d.setAttribute('style', css); d.id = '__lantern_co_' + tag; document.body.appendChild(d); return d }; const box = mk('div', 'position:fixed;border-radius:12px;border:3px solid ${ACCENT};box-shadow:0 0 0 4px ${GLOW},0 0 24px 6px ${GLOW};z-index:' + Z + ';pointer-events:none'); const label = mk('div', 'position:fixed;z-index:' + (Z + 1) + ';max-width:300px;padding:9px 13px;border-radius:12px;background:${DARK};color:#fff;font:600 14px/1.35 -apple-system,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);pointer-events:none;animation:__lpop .22s ease-out'); label.innerHTML = ${JSON.stringify(n != null ? `<span style="display:inline-grid;place-items:center;width:22px;height:22px;margin-right:8px;border-radius:50%;background:var(--lantern-accent, ${ORANGE});color:#16161a;font-weight:800;font-size:13px;vertical-align:-5px">${n}</span>` : '')} + ${JSON.stringify(text.replace(/&/g, '&amp;').replace(/</g, '&lt;'))}; const line = mk('svg', 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:' + Z + ';pointer-events:none;overflow:visible'); const accent = getComputedStyle(document.documentElement).getPropertyValue('--lantern-accent').trim() || '${ORANGE}'; line.innerHTML = '<path fill="none" stroke="' + accent + '" stroke-width="3" stroke-linecap="round"/><circle r="5" fill="' + accent + '"/>'; const pathEl = line.firstChild, dot = line.lastChild; if (!document.getElementById('__lantern_hud_css')) { const st = document.createElement('style'); st.id = '__lantern_hud_css'; st.textContent = '@keyframes __lpop{0%{transform:scale(.6);opacity:0}100%{transform:scale(1);opacity:1}}'; document.head.appendChild(st) } const pad = 10, gap = 28; const st = { box, label, line, raf: 0 }; const tick = () => { if (!el.isConnected) { box.remove(); label.remove(); line.remove(); window.__lantern_co = null; return } const r = el.getBoundingClientRect(), cs = getComputedStyle(el); const hidden = !r.width || !r.height || cs.visibility === 'hidden'; box.style.display = label.style.display = line.style.display = hidden ? 'none' : ''; if (!hidden) { box.style.left = (r.left - pad) + 'px'; box.style.top = (r.top - pad) + 'px'; box.style.width = (r.width + 2 * pad) + 'px'; box.style.height = (r.height + 2 * pad) + 'px'; const lw = label.offsetWidth, lh = label.offsetHeight; const edge = pad + 6; const mid = (v, max) => Math.max(8, Math.min(max, v)); const spots = [ { lx: r.right + edge + gap, ly: mid(r.top + r.height / 2 - lh / 2, innerHeight - lh - 8), ax: r.right + edge, ay: r.top + r.height / 2 }, { lx: r.left - edge - gap - lw, ly: mid(r.top + r.height / 2 - lh / 2, innerHeight - lh - 8), ax: r.left - edge, ay: r.top + r.height / 2 }, { lx: mid(r.left + r.width / 2 - lw / 2, innerWidth - lw - 8), ly: r.bottom + edge + gap, ax: r.left + r.width / 2, ay: r.bottom + edge }, { lx: mid(r.left + r.width / 2 - lw / 2, innerWidth - lw - 8), ly: r.top - edge - gap - lh, ax: r.left + r.width / 2, ay: r.top - edge } ]; const fits = (s) => s.lx >= 4 && s.ly >= 4 && s.lx + lw <= innerWidth - 4 && s.ly + lh <= innerHeight - 4; const cost = (s) => { let c = 0; for (const [fx, fy] of [[.1, .5], [.5, .5], [.9, .5], [.5, .1], [.5, .9]]) { const hit = document.elementFromPoint(s.lx + lw * fx, s.ly + lh * fy); if (hit && hit !== document.body && hit !== document.documentElement && !(hit.id && hit.id.startsWith('__lantern')) && (hit.innerText || '').trim()) c++ } return c }; if (!st.spot || !fits(st.spot(r)) || Math.abs(st.at - (r.left + r.top)) > 2) { let best = null, bestCost = 99; for (const s of spots) { if (!fits(s)) continue; const c = cost(s); if (c < bestCost) { bestCost = c; best = s } } st.chosen = best || spots.find(fits) || spots[2]; st.at = r.left + r.top; st.spot = () => st.chosen } const { lx, ly, ax, ay } = st.chosen; label.style.left = lx + 'px'; label.style.top = ly + 'px'; const bx = Math.max(lx, Math.min(lx + lw, ax)), by = Math.max(ly, Math.min(ly + lh, ay)); const mx = (bx + ax) / 2, my = (by + ay) / 2; pathEl.setAttribute('d', 'M' + bx + ' ' + by + ' Q' + mx + ' ' + (my + (Math.abs(ax - bx) > Math.abs(ay - by) ? 14 : 0)) + ' ' + ax + ' ' + ay); dot.setAttribute('cx', ax); dot.setAttribute('cy', ay) } st.raf = requestAnimationFrame(tick) }; tick(); window.__lantern_co = st })()`

/** A small "made with lantern" in the corner of a recording: the glyph and the word, quiet, bottom right. */
export const MARK_JS = (on: boolean) => `(() => { let m = document.getElementById('__lantern_mark'); if (!${on}) { m?.remove(); return } if (m) return; m = document.createElement('div'); m.id = '__lantern_mark'; m.style.cssText = 'position:fixed;right:14px;bottom:12px;z-index:2147483646;display:flex;align-items:center;gap:6px;padding:5px 9px 5px 7px;border-radius:999px;background:rgba(22,22,26,.55);color:rgba(255,255,255,.85);font:600 11px/1 -apple-system,system-ui,sans-serif;letter-spacing:.01em;pointer-events:none;backdrop-filter:blur(6px)'; m.innerHTML = '<svg viewBox="0 0 256 256" width="13" height="13" aria-hidden="true"><path d="M100 66 C100 38, 156 38, 156 66" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round"/><rect x="84" y="70" width="88" height="16" rx="6" fill="#fff"/><rect x="92" y="86" width="72" height="92" rx="12" style="fill:${ACCENT}" stroke="#fff" stroke-width="12"/><rect x="84" y="178" width="88" height="16" rx="6" fill="#fff"/></svg><span>made with lantern</span>'; document.body.appendChild(m) })()`

/** `expr`, read with everything lantern drew hidden, so the page's own text comes back without a caption or keys bubble in it. */
export const WITHOUT_OVERLAYS = (expr: string) => `(() => { const mine = [...document.querySelectorAll('[id^="__lantern"], .__lantern_fx')]; const was = mine.map((e) => e.style.visibility); mine.forEach((e) => { e.style.visibility = 'hidden' }); try { return (${expr}) } finally { mine.forEach((e, i) => { e.style.visibility = was[i] }) } })()`

/** Hide (or show again) everything lantern drew: the pointer and any click/key effects stay out of screenshots. */
export const FX_JS = (hidden: boolean) => `document.querySelectorAll('#__lantern_cursor, #__lantern_caption, #__lantern_mark, #__lantern_keys, .__lantern_fx').forEach((e) => { e.style.visibility = ${JSON.stringify(hidden ? 'hidden' : '')} })`

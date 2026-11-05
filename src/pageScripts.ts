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
 * `same`: measure the element the last locate found, if it is still on the page, instead of looking for the target again.
 */
export const locateJs = (target: string, scroll = true, same = false) => String.raw`
(() => {
  const t = ${JSON.stringify(target)}, scroll = ${scroll}, same = ${same}
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const isMine = (e) => e.id && String(e.id).startsWith('__lantern')
  // Every element in the document and in every open shadow root, in order.
  const deep = (root, out) => { for (const e of root.querySelectorAll('*')) { if (isMine(e)) continue; out.push(e); if (e.shadowRoot) deep(e.shadowRoot, out) } return out }
  const q = (root, sel) => { const hit = root.querySelector(sel); if (hit) return hit; for (const e of root.querySelectorAll('*')) if (e.shadowRoot) { const h = q(e.shadowRoot, sel); if (h) return h } return null }
  let el = null, matches = 1
  // Measuring again the element already found (while a scroll settles, or once the pointer has arrived): the same one,
  // not whatever now reads those words — the pointer arriving can raise a tooltip that says exactly what the button does.
  const before = same && window.__lantern && window.__lantern.last
  try {
    if (before && before.isConnected) el = before
    else if (/^e\d+$/.test(t)) { el = (window.__lantern && window.__lantern.refs && window.__lantern.refs.get(t)) || null; if (!el) return { error: 'no element ' + t + ' — refs come from the last snapshot; take a new one' } }
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
  if (cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight) {
    const root = el.getRootNode(); let at = (root.elementFromPoint ? root : document).elementFromPoint(cx, cy)
    while (at && at.shadowRoot && at.shadowRoot.elementFromPoint) { const inner = at.shadowRoot.elementFromPoint(cx, cy); if (!inner || inner === at) break; at = inner }
    const lab = at && at.closest && at.closest('label')
    const related = (a, b) => a === b || a.contains(b) || b.contains(a) || (a.shadowRoot && a.shadowRoot.contains(b)) || (b.shadowRoot && b.shadowRoot.contains(a)) || (lab && (lab.control === b || lab.contains(b)))
    if (at && !isMine(at) && !related(at, el)) covered = at.tagName.toLowerCase() + (at.id ? '#' + at.id : '') + (at.className && typeof at.className === 'string' ? '.' + at.className.trim().split(/\s+/).slice(0, 2).join('.') : '')
  }
  // How much of it can be seen: a tip, a popover or a banner lying over part of it hides it from whoever looks at the picture,
  // though a click on its middle may still land. Fifteen points across it are asked what is on top.
  let blocked = null
  { const x0 = Math.max(r.left, 0), x1 = Math.min(r.right, innerWidth), y0 = Math.max(r.top, 0), y1 = Math.min(r.bottom, innerHeight)
    if (x1 > x0 && y1 > y0) {
      const root = el.getRootNode(); let hid = 0, n = 0, by = null
      for (const fx of [.06, .28, .5, .72, .94]) for (const fy of [.2, .5, .8]) {
        n++; const px = x0 + (x1 - x0) * fx, py = y0 + (y1 - y0) * fy
        let at = (root.elementFromPoint ? root : document).elementFromPoint(px, py)
        while (at && at.shadowRoot && at.shadowRoot.elementFromPoint) { const inner = at.shadowRoot.elementFromPoint(px, py); if (!inner || inner === at) break; at = inner }
        if (!at || isMine(at) || (at.closest && at.closest('.__lantern'))) continue
        const lab = at.closest && at.closest('label')
        if (at === el || at.contains(el) || el.contains(at) || (lab && (lab.control === el || lab.contains(el)))) continue
        hid++; by = by || at
      }
      if (hid) { let top = by; for (let p = by; p && p !== document.body && p !== document.documentElement; p = p.parentElement) { const pos = getComputedStyle(p).position; if (pos === 'fixed' || pos === 'absolute' || pos === 'sticky') { top = p; break } } blocked = { part: hid / n, by: clean(top.innerText).slice(0, 48) || top.tagName.toLowerCase() + (top.id ? '#' + top.id : '') } }
    } }
  const name = clean(el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || (el.labels && el.labels.length && [...el.labels].map((l) => l.innerText).join(' ')) || (el.tagName === 'INPUT' && /^(submit|button|reset)$/i.test(el.type) && el.value) || el.getAttribute('title') || (() => { let p = el.parentElement, near = ''; for (let i = 0; i < 4 && p && !near; i++, p = p.parentElement) near = clean(p.innerText); return 'unnamed ' + el.tagName.toLowerCase() + (near ? ' by ' + near.slice(0, 36) : '') })()).slice(0, 60)
  return { x: cx, y: cy, rect: { x: r.left, y: r.top, width: r.width, height: r.height }, name, matches, covered, blocked, scroll: { x: scrollX, y: scrollY } }
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

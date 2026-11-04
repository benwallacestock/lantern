// Everything lantern draws in the page, in one runtime: the caption along the bottom, the pointer, the click
// rings and the little mouse, the keys bubble, and the annotations that follow an element — highlight, callout,
// badge, ring, arrow, blur. One stylesheet gives them the same look (the accent, the dark pill, the glow), one
// loop keeps the annotations on their elements, and one `hide` keeps the transient ones out of a screenshot.
// Installed once per document by UI_JS; the other exports are the calls the daemon makes into it.
import { ORANGE } from './pageScripts.ts'

export const UI_JS = String.raw`(() => {
  if (window.__lantern_ui) return
  const Z = 2147483646
  const ACCENT = 'var(--lantern-accent, ${ORANGE})'
  const GLOW = 'color-mix(in srgb, ' + ACCENT + ' 38%, transparent)'
  const FONT = '-apple-system, system-ui, sans-serif'
  const CURVE = 'cubic-bezier(.2,.8,.2,1)'

  // The look, once. Every node lantern adds has the class __lantern (fixed, on top, no pointer events).
  const style = document.createElement('style')
  style.id = '__lantern_css'
  style.textContent = [
    '.__lantern { position: fixed; z-index: ' + Z + '; pointer-events: none; box-sizing: border-box; font-family: ' + FONT + '; margin: 0; }',
    '.__lantern.__l-top { z-index: ' + (Z + 1) + '; }',
    '.__l-dark { background: rgba(22,22,26,.9); color: #fff; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.35); }',
    '.__l-glow { border-radius: 12px; border: 3px solid ' + ACCENT + '; box-shadow: 0 0 0 4px ' + GLOW + ', 0 0 24px 6px ' + GLOW + '; }',
    '.__l-ring { border-radius: 50%; border: 3px solid ' + ACCENT + '; box-shadow: 0 0 0 4px ' + GLOW + ', 0 0 24px 6px ' + GLOW + '; animation: __l-pop .25s ease-out; }',
    '.__l-badge { width: 26px; height: 26px; border-radius: 50%; background: ' + ACCENT + '; color: #16161a; font: 800 14px/26px ' + FONT + '; text-align: center; box-shadow: 0 0 0 3px #fff, 0 3px 10px rgba(0,0,0,.35); animation: __l-pop .22s ease-out; }',
    '.__l-blur { backdrop-filter: blur(14px) saturate(.5); -webkit-backdrop-filter: blur(14px) saturate(.5); background: rgba(128,128,128,.22); border-radius: 8px; }',
    '.__l-caption { left: 50%; bottom: 28px; transform: translateX(-50%); padding: 10px 18px; font: 600 16px/1.3 ' + FONT + '; max-width: 80vw; text-align: center; }',
    '.__l-label { max-width: 300px; padding: 9px 13px; font: 600 14px/1.35 ' + FONT + '; display: flex; align-items: flex-start; gap: 8px; animation: __l-pop .22s ease-out; }',
    '.__l-label .__l-n { flex: none; width: 22px; height: 22px; border-radius: 50%; background: ' + ACCENT + '; color: #16161a; font-weight: 800; font-size: 13px; line-height: 22px; text-align: center; }',
    '.__l-line { left: 0; top: 0; width: 100vw; height: 100vh; overflow: visible; }',
    '.__l-keys { display: flex; gap: 6px; align-items: center; padding: 7px 11px; border-radius: 10px; font: 600 15px/1.2 ' + FONT + '; transition: opacity .3s; animation: __l-pop .18s ease-out; }',
    '.__l-cap { display: inline-block; padding: 3px 8px; border-radius: 6px; background: #fff; color: #16161a; font-weight: 700; font-size: 13px; box-shadow: 0 2px 0 #b8b8c0; animation: __l-pop .18s ease-out; }',
    '.__l-cursor { left: 0; top: 0; width: 26px; height: 26px; filter: drop-shadow(0 1.5px 2px rgba(0,0,0,.35)) drop-shadow(0 4px 10px rgba(0,0,0,.18)); }',
    '.__l-fx { filter: drop-shadow(0 3px 8px rgba(0,0,0,.3)); animation: __l-pop .18s ease-out; }',
    '@keyframes __l-pop { 0% { transform: scale(.6); opacity: 0 } 100% { transform: scale(1); opacity: 1 } }',
    '@keyframes __l-ripple { 0% { transform: scale(.3); opacity: .9 } 100% { transform: scale(2.2); opacity: 0 } }',
    '@keyframes __l-wheel { 0% { transform: translateY(-5px); opacity: 0 } 30% { opacity: 1 } 70% { opacity: 1 } 100% { transform: translateY(5px); opacity: 0 } }',
    '@keyframes __l-wheelup { 0% { transform: translateY(5px); opacity: 0 } 30% { opacity: 1 } 70% { opacity: 1 } 100% { transform: translateY(-5px); opacity: 0 } }',
    '@keyframes __l-fade { to { opacity: 0; transform: translateY(-4px) scale(.9) } }',
    '@keyframes __l-key { 0% { transform: translateY(6px) scale(1.6); opacity: 0 } 100% { transform: none; opacity: 1 } }',
    '@keyframes __l-blink { 50% { opacity: 0 } }',
    '@keyframes __l-draw { to { stroke-dashoffset: 0 } }',
  ].join('\n')
  ;(document.head || document.documentElement).appendChild(style)

  const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--lantern-accent').trim() || '${ORANGE}'
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const mk = (tag, cls, html) => {
    const el = tag === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : document.createElement(tag)
    el.setAttribute('class', '__lantern ' + cls)
    if (html) el.innerHTML = html
    document.body.appendChild(el)
    return el
  }
  const place = (el, x, y, w, h) => { el.style.left = x + 'px'; el.style.top = y + 'px'; if (w != null) { el.style.width = w + 'px'; el.style.height = h + 'px' } }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

  // ---- transient: the caption, the pointer, the keys bubble, clicks and wheels (hidden for a screenshot)
  let caption = null, cursor = null, keys = null, keysT = 0, typed = '', held = null
  const CURSOR_SVG = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 3 L5 19 L9.3 15.4 L12.3 21.6 L15.1 20.3 L12.1 14.2 L17.6 14 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  const KEYBOARD = '<svg viewBox="0 0 24 16" width="18" height="12" style="display:block;opacity:.75"><rect x="1" y="1" width="22" height="14" rx="3" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M5 5h2M9 5h2M13 5h2M17 5h2M5 8h2M9 8h2M13 8h2M17 8h2M7 11h10" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>'
  const MOUSE = (lit, color) => '<svg viewBox="0 0 24 32" width="22" height="30" style="display:block;overflow:visible"><rect x="3" y="2" width="18" height="28" rx="9" fill="#fff" stroke="#16161a" stroke-width="1.5"/>' + (lit === 'left' ? '<path d="M12 3 C7.2 3 4 6.6 4 11 V13 H12 Z" fill="' + color + '"/>' : lit === 'right' ? '<path d="M12 3 C16.8 3 20 6.6 20 11 V13 H12 Z" fill="' + color + '"/>' : '') + '<path d="M12 3 V13 M4 13 H20" stroke="#16161a" stroke-width="1.2" fill="none"/><rect x="11" y="6" width="2" height="4.5" rx="1" fill="#16161a"/></svg>'
  const fx = (x, y, html) => { const d = mk('div', '__l-top __l-transient __l-fx', html); place(d, x + 16, y + 14); return d }
  const fade = (d, after, gone) => { setTimeout(() => { d.style.animation = '__l-fade .35s ease-in both' }, after); setTimeout(() => d.remove(), gone) }
  // The keys bubble sits by the pointer (or along the bottom when there is none) and fades once typing stops.
  const showKeys = () => {
    const at = window.__lantern_at
    if (!keys || !keys.isConnected) keys = mk('div', '__l-top __l-transient __l-dark __l-keys')
    keys.id = '__lantern_keys'
    if (at) { keys.style.left = Math.min(at.x + 22, innerWidth - 260) + 'px'; keys.style.top = Math.min(at.y + 52, innerHeight - 60) + 'px'; keys.style.bottom = ''; keys.style.transform = '' }
    else { keys.style.left = '50%'; keys.style.transform = 'translateX(-50%)'; keys.style.bottom = '84px'; keys.style.top = '' }
    keys.style.opacity = '1'
    clearTimeout(keysT)
    keysT = setTimeout(() => { if (keys) { keys.style.opacity = '0'; const k = keys; setTimeout(() => { if (keys === k) { k.remove(); keys = null } }, 350) } typed = '' }, 1400)
  }
  const cap = (t) => '<span class="__l-cap">' + esc(t) + '</span>'

  // ---- annotations: each follows its element until that goes, or until it is cleared
  const anns = new Map()
  let nextId = 1, raf = 0
  const PAD = 12
  const settle = (a) => {
    if (!a.el.isConnected) { drop(a); return }
    const r = a.el.getBoundingClientRect(), cs = getComputedStyle(a.el)
    const hidden = !r.width || !r.height || cs.visibility === 'hidden'
    for (const n of a.nodes) n.style.display = hidden ? 'none' : ''
    if (!hidden) a.layout(r)
  }
  const tick = () => { for (const a of [...anns.values()]) settle(a); raf = anns.size ? requestAnimationFrame(tick) : 0 }
  const drop = (a) => { for (const n of a.nodes) n.remove(); anns.delete(a.id) }
  const keep = (a) => { a.id = nextId++; anns.set(a.id, a); for (const n of a.nodes) n.dataset.lantern = a.id; settle(a); if (!raf && anns.size) raf = requestAnimationFrame(tick); return a.id }
  const glowBox = (box, r) => place(box, r.left - PAD, r.top - PAD, r.width + 2 * PAD, r.height + 2 * PAD)

  const kinds = {
    highlight: (el) => { const box = mk('div', '__l-highlight __l-glow'); return { el, nodes: [box], layout: (r) => glowBox(box, r) } },
    ring: (el) => {
      const ring = mk('div', '__l-ring')
      return { el, nodes: [ring], layout: (r) => { const pad = clamp(Math.min(r.width, r.height) * 0.3, 10, 28); place(ring, r.left - pad, r.top - pad, r.width + 2 * pad, r.height + 2 * pad) } }
    },
    badge: (el, o) => { const b = mk('div', '__l-top __l-badge', esc(o.n)); return { el, nodes: [b], layout: (r) => place(b, r.left - 13, r.top - 13) } },
    blur: (el) => { const b = mk('div', '__l-blur'); return { el, nodes: [b], layout: (r) => place(b, Math.round(r.left) - 2, Math.round(r.top) - 2, Math.round(r.width) + 4, Math.round(r.height) + 4) } },
    arrow: (el) => {
      // A bold arrow pointing at the element from the side with the most room, a white halo under it for contrast.
      const svg = mk('svg', '__l-arrow __l-line', '<path class="halo" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/><path class="shaft" fill="none" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>')
      const halo = svg.querySelector('.halo'), shaft = svg.querySelector('.shaft')
      let side = null, at = null
      return { el, nodes: [svg], layout: (r) => {
        const key = Math.round(r.left) + ':' + Math.round(r.top)
        if (key !== at) { // choose once per place the element is in, so it does not flicker between sides
          const room = { left: r.left, right: innerWidth - r.right, top: r.top, bottom: innerHeight - r.bottom }
          side = Object.keys(room).sort((a, b) => room[b] - room[a])[0]; at = key
        }
        const gap = PAD + 4, len = clamp((side === 'left' ? r.left : side === 'right' ? innerWidth - r.right : side === 'top' ? r.top : innerHeight - r.bottom) - gap - 16, 40, 110)
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2
        const tip = side === 'left' ? [r.left - gap, cy] : side === 'right' ? [r.right + gap, cy] : side === 'top' ? [cx, r.top - gap] : [cx, r.bottom + gap]
        // The tail sits off to the side a little, so the arrow comes in at an angle rather than dead straight.
        const dx = side === 'left' ? -1 : side === 'right' ? 1 : 0, dy = side === 'top' ? -1 : side === 'bottom' ? 1 : 0
        const tail = [tip[0] + dx * len + dy * len * 0.45, tip[1] + dy * len + dx * len * 0.45]
        const ang = Math.atan2(tip[1] - tail[1], tip[0] - tail[0]), h = 16
        const l = [tip[0] - h * Math.cos(ang - 0.5), tip[1] - h * Math.sin(ang - 0.5)], rr = [tip[0] - h * Math.cos(ang + 0.5), tip[1] - h * Math.sin(ang + 0.5)]
        const d = 'M' + tail[0] + ' ' + tail[1] + ' L' + tip[0] + ' ' + tip[1] + ' M' + l[0] + ' ' + l[1] + ' L' + tip[0] + ' ' + tip[1] + ' L' + rr[0] + ' ' + rr[1]
        halo.setAttribute('d', d); shaft.setAttribute('d', d); shaft.setAttribute('stroke', accent())
      } }
    },
    callout: (el, o) => {
      // The words beside the element, joined to it by a curve ending in a dot, the element lit. The label goes
      // where it covers the least: right, left, below or above, scored by what is under it.
      const box = mk('div', '__l-callout __l-glow')
      const label = mk('div', '__l-top __l-callout-label __l-dark __l-label', (o.n != null ? '<span class="__l-n">' + esc(o.n) + '</span>' : '') + '<span>' + esc(o.text) + '</span>')
      const line = mk('svg', '__l-callout-line __l-line', '<path fill="none" stroke-width="3" stroke-linecap="round"/><circle r="5"/>')
      const path = line.querySelector('path'), dot = line.querySelector('circle')
      let chosen = null, at = null
      return { el, nodes: [box, label, line], layout: (r) => {
        glowBox(box, r)
        const lw = label.offsetWidth, lh = label.offsetHeight, edge = PAD + 6, gap = 28
        const mid = (v, max) => clamp(v, 8, max)
        const spots = [
          { lx: r.right + edge + gap, ly: mid(r.top + r.height / 2 - lh / 2, innerHeight - lh - 8), ax: r.right + edge, ay: r.top + r.height / 2 },
          { lx: r.left - edge - gap - lw, ly: mid(r.top + r.height / 2 - lh / 2, innerHeight - lh - 8), ax: r.left - edge, ay: r.top + r.height / 2 },
          { lx: mid(r.left + r.width / 2 - lw / 2, innerWidth - lw - 8), ly: r.bottom + edge + gap, ax: r.left + r.width / 2, ay: r.bottom + edge },
          { lx: mid(r.left + r.width / 2 - lw / 2, innerWidth - lw - 8), ly: r.top - edge - gap - lh, ax: r.left + r.width / 2, ay: r.top - edge },
        ]
        const fits = (s) => s.lx >= 4 && s.ly >= 4 && s.lx + lw <= innerWidth - 4 && s.ly + lh <= innerHeight - 4
        const cost = (s) => { let c = 0; for (const [fx, fy] of [[.1, .5], [.5, .5], [.9, .5], [.5, .1], [.5, .9]]) { const hit = document.elementFromPoint(s.lx + lw * fx, s.ly + lh * fy); if (hit && hit !== document.body && hit !== document.documentElement && !hit.classList.contains('__lantern') && (hit.innerText || '').trim()) c++ } return c }
        const key = Math.round(r.left) + ':' + Math.round(r.top)
        if (!chosen || key !== at || !fits(chosen)) { let best = null, bestCost = 99; for (const s of spots) { if (!fits(s)) continue; const c = cost(s); if (c < bestCost) { bestCost = c; best = s } } chosen = best || spots.find(fits) || spots[2]; at = key }
        const { lx, ly, ax, ay } = chosen
        place(label, lx, ly)
        const bx = clamp(ax, lx, lx + lw), by = clamp(ay, ly, ly + lh), mx = (bx + ax) / 2, my = (by + ay) / 2
        path.setAttribute('d', 'M' + bx + ' ' + by + ' Q' + mx + ' ' + (my + (Math.abs(ax - bx) > Math.abs(ay - by) ? 14 : 0)) + ' ' + ax + ' ' + ay)
        path.setAttribute('stroke', accent()); dot.setAttribute('fill', accent()); dot.setAttribute('cx', ax); dot.setAttribute('cy', ay)
      } }
    },
  }

  window.__lantern_ui = {
    caption(text) { if (!text) { caption?.remove(); caption = null; return } if (!caption || !caption.isConnected) { caption = mk('div', '__l-top __l-transient __l-dark __l-caption'); caption.id = '__lantern_caption' } caption.textContent = text },
    cursor(x, y, ms) {
      window.__lantern_at = { x, y }
      if (keys && keys.isConnected) { keys.style.transition = 'left ' + ms + 'ms ' + CURVE + ', top ' + ms + 'ms ' + CURVE; keys.style.left = (x + 22) + 'px'; keys.style.top = (y + 52) + 'px' }
      if (!cursor || !cursor.isConnected) { cursor = mk('div', '__l-top __l-transient __l-cursor', CURSOR_SVG); cursor.id = '__lantern_cursor'; cursor.style.transform = 'translate(' + (innerWidth / 2) + 'px,' + (innerHeight * 0.8) + 'px)'; cursor.getBoundingClientRect() }
      cursor.style.transition = 'transform ' + ms + 'ms ' + CURVE
      cursor.style.transform = 'translate(' + (x - 5.5) + 'px,' + (y - 3) + 'px)'
    },
    typed(ch) {
      typed = (typed + ch).slice(-28); showKeys()
      const shown = esc(typed.slice(0, -1)) + '<span style="display:inline-block;animation:__l-key .22s cubic-bezier(.2,1.4,.4,1)">' + esc(typed.slice(-1) === ' ' ? '␣' : typed.slice(-1)) + '</span>'
      keys.innerHTML = KEYBOARD + '<span style="font-family:ui-monospace,Menlo,monospace;font-size:14px;white-space:pre">' + shown + '</span><span style="opacity:.7;animation:__l-blink 1s steps(2) infinite">|</span>'
    },
    key(parts) { typed = ''; showKeys(); keys.innerHTML = KEYBOARD + parts.map(cap).join('<span style="opacity:.6;margin:0 1px">+</span>') },
    ripple(x, y, color) { for (const delay of [0, 160]) { const d = mk('div', '__l-transient'); d.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;border:2.5px solid ' + color + ';animation:__l-ripple .65s ease-out ' + delay + 'ms both'; setTimeout(() => d.remove(), 900) } },
    mouse(x, y, lit, color, times) { const d = fx(x, y, MOUSE(lit, color) + (times > 1 ? '<span style="position:absolute;left:16px;top:-6px;padding:1px 5px;border-radius:999px;background:' + color + ';color:#16161a;font:800 10px/1.4 ' + FONT + '">×' + times + '</span>' : '')); fade(d, 750, 1150) },
    hold(x, y, color) { this.release(); held = fx(x, y, MOUSE('left', color)); held.style.transition = 'left .08s linear, top .08s linear' },
    move(x, y) { if (held) place(held, x + 16, y + 14) },
    release() { if (held) { const h = held; held = null; h.style.animation = '__l-fade .35s ease-in both'; setTimeout(() => h.remove(), 400) } },
    wheel(x, y, dir) {
      const up = dir === 'up', horiz = dir === 'left' || dir === 'right'
      const d = fx(x, y, MOUSE('', '') + '<div style="position:absolute;left:0;top:0;width:22px;height:30px;overflow:hidden"><div style="position:absolute;left:0;right:0;top:14px;text-align:center;color:' + ACCENT + ';font:900 16px/1 ' + FONT + ';animation:' + (up ? '__l-wheelup' : '__l-wheel') + ' .55s linear infinite' + (horiz ? ';transform:rotate(-90deg)' : '') + '">' + (horiz ? (dir === 'left' ? '⌃⌃' : '⌄⌄') : (up ? '⌃' : '⌄')) + '</div></div>')
      fade(d, 1100, 1500)
    },
    /** An annotation on the element the last locate found; its id, or 0 when there is none. */
    add(kind, opts) { const el = window.__lantern && window.__lantern.last; if (!el || !kinds[kind]) return 0; const a = kinds[kind](el, opts || {}); a.kind = kind; return keep(a) },
    remove(id) { const a = anns.get(id); if (a) drop(a) },
    clear(kind) { for (const a of [...anns.values()]) if (!kind || a.kind === kind) drop(a) },
    count(kind) { let n = 0; for (const a of anns.values()) if (!kind || a.kind === kind) n++; return n },
    /** The transient things out of a screenshot: the pointer, the caption, the keys, click and wheel effects. Annotations stay. */
    hide(hidden) { document.querySelectorAll('.__l-transient').forEach((e) => { e.style.visibility = hidden ? 'hidden' : '' }) },
  }
})()`

const call = (expr: string) => `${UI_JS}; window.__lantern_ui.${expr}`

/** A caption along the bottom of the page, until the next one (or '' for none). */
export const CAPTION_JS = (text: string) => call(`caption(${JSON.stringify(text)})`)
/** The pointer, gliding to x,y over ms. */
export const CURSOR_JS = (x: number, y: number, ms = 250) => call(`cursor(${x}, ${y}, ${ms})`)
/** Two rings spreading from a click. */
export const CLICK_JS = (x: number, y: number, color = ORANGE) => call(`ripple(${x}, ${y}, ${JSON.stringify(color)})`)
/** A call on the HUD: typed('a'), key(['⌘','S']), mouse(x, y, 'left', color, times), hold, move, release, wheel(x, y, 'down'). */
export const HUD_JS = (expr: string) => call(expr)
export type Annotation = 'highlight' | 'callout' | 'badge' | 'ring' | 'arrow' | 'blur'
export const ANNOTATIONS: Annotation[] = ['highlight', 'callout', 'badge', 'ring', 'arrow', 'blur']
/** An annotation on the element the last locate found; evaluates to its id (0 when there was no element). */
export const ANNOTATE_JS = (kind: Annotation, opts: { text?: string; n?: number } = {}) => call(`add(${JSON.stringify(kind)}, ${JSON.stringify(opts)})`)
export const REMOVE_JS = (id: number) => call(`remove(${id})`)
/** Every annotation, or every one of a kind, off. */
export const CLEAR_JS = (kind?: Annotation) => call(`clear(${kind ? JSON.stringify(kind) : ''})`)
/** Hide (or show again) the transient overlays, so the pointer and any click/key effects stay out of a screenshot. */
export const FX_JS = (hidden: boolean) => call(`hide(${hidden})`)
/** The accent colour for everything lantern draws, as a CSS variable the runtime reads. */
export const ACCENT_JS = (accent: string) => `document.documentElement.style.setProperty('--lantern-accent', ${JSON.stringify(accent)})`
/** `expr`, read with everything lantern drew hidden, so the page's own text comes back without a caption or a label in it. */
export const WITHOUT_OVERLAYS = (expr: string) => `(() => { const mine = [...document.querySelectorAll('.__lantern')]; const was = mine.map((e) => e.style.visibility); mine.forEach((e) => { e.style.visibility = 'hidden' }); try { return (${expr}) } finally { mine.forEach((e, i) => { e.style.visibility = was[i] }) } })()`

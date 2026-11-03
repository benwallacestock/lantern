// The page an agent drives, and every command it can run on it. One page per project, kept by the daemon.
//
// The page is a real Chrome tab with no window, rendered at 2x like a Retina screen, so screenshots and recordings
// are sharp. It is driven over the DevTools protocol: input goes in as real mouse and key events (the page sees
// mousedown, keydown, input — the lot), so what the agent does is what a person would do.
//
// Recording keeps the frames Chrome paints (Page.startScreencast) — only while a command runs and for a beat after,
// so the agent's thinking between commands is cut out — and ffmpeg assembles them when it stops. Everything the
// viewer needs is drawn into the page itself: a caption, the pointer, a ring where a click lands, the keys typed.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Chrome } from './cdp.ts'
import { AMBER, CAPTION_JS, CLICK_JS, CURSOR_JS, FOCUS_JS, FX_JS, GREEN, HIGHLIGHT_JS, HUD_JS, KEYS, KEY_GLYPH, SNAPSHOT_JS, locateJs } from './pageScripts.ts'
import { USAGE } from './usage.ts'

export type Reply = { ok: boolean; text: string }
type Rect = { x: number; y: number; width: number; height: number }
type Spot = { x: number; y: number; name: string; rect?: Rect }
/** A demo being recorded: every frame the page painted, with when it painted. Assembled by ffmpeg on stop. */
type Rec = { dir: string; frames: { file: string; t: number }[]; caption?: string; marks: number[]; wrote: number; until: number }

/** ms of recording after a command returns: the page reacting, a transition finishing. */
export const SETTLE = 1500
const SCALE = 2
const PRESETS: Record<string, [number, number]> = { phone: [390, 844], tablet: [1024, 768], laptop: [1280, 800], desktop: [1440, 900], wide: [1920, 1080] }
const [REC_W, REC_H] = [1440, 900] // every recording is this size unless the agent set one: 16:10, a reviewer's screen
const MODS: Record<string, number> = { alt: 1, option: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, shift: 8 }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')
const pngSize = (b: Buffer) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) })

export const ffmpegBin = () => process.env.GLADE_FFMPEG || [process.env.HOME + '/.local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((f) => fs.existsSync(f)) || 'ffmpeg'
const hasFfmpeg = () => new Promise<boolean>((res) => execFile(ffmpegBin(), ['-version'], (e) => res(!e)))
const tryOut = (bin: string, args: string[]) => new Promise<string>((res) => execFile(bin, args, { maxBuffer: 1 << 24 }, (e, so, se) => res(String(se || so || (e ? e.message : '')))))

export class Page {
  chrome: Chrome
  session = ''
  targetId = ''
  outDir: string
  log: string[] = []
  popups: string[] = []
  rec?: Rec
  hl = false // a highlight the agent set (as opposed to one a screenshot lit for the picture)
  at?: { x: number; y: number } // where the pointer rests
  size: [number, number] = [1280, 800]
  fixed = false // a size the agent chose, kept for recordings
  failed?: string
  private onLoad?: () => void
  private popupIds = new Set<string>()

  constructor(chrome: Chrome, outDir: string) { this.chrome = chrome; this.outDir = outDir }

  static async open(chrome: Chrome, outDir: string): Promise<Page> {
    const p = new Page(chrome, outDir)
    const { targetId } = await chrome.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await chrome.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })
    p.targetId = targetId; p.session = sessionId
    chrome.on((sid, method, params) => p.event(sid, method, params))
    await p.cdp('Page.enable'); await p.cdp('Runtime.enable'); await p.cdp('Network.enable')
    await chrome.send('Target.setDiscoverTargets', { discover: true })
    await p.setSize(...p.size)
    return p
  }

  cdp<T = any>(method: string, params: object = {}, ms = 10_000): Promise<T> { return this.chrome.send<T>(method, params, this.session, ms) }
  async evaluate<T = any>(expression: string): Promise<T> {
    const r = await this.cdp<{ result: { value: T }; exceptionDetails?: { exception?: { description?: string }; text?: string } }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'the script threw')
    return r.result.value
  }
  /** Something drawn for the viewer: never in the way of the command itself. */
  fire(js: string) { void this.evaluate(js).catch(() => {}) }
  hud(call: string) { this.fire(`${HUD_JS}; window.__gladeHud.${call}`) }
  note(line: string) { this.log.push(`${new Date().toISOString().slice(11, 19)} ${line}`); if (this.log.length > 300) this.log.splice(0, this.log.length - 300) }

  private event(sid: string | undefined, method: string, params: any) {
    if (sid === undefined) {
      // A link that opens a new tab has nowhere useful to open one: it is closed, and followed here instead.
      if (method === 'Target.targetCreated' && params.targetInfo?.type === 'page' && params.targetInfo.openerId === this.targetId) this.popup(params.targetInfo)
      else if (method === 'Target.targetInfoChanged' && this.popupIds.has(params.targetInfo?.targetId)) this.popup(params.targetInfo)
      return
    }
    if (sid !== this.session) return
    switch (method) {
      case 'Page.screencastFrame': {
        void this.cdp('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {})
        // Keep the frame (at most ~12 a second). The page only paints when something changed, so a pause in the
        // agent's thinking leaves a gap in the timestamps, not a run of identical frames.
        const r = this.rec, now = Date.now()
        if (r && now <= r.until && now - r.wrote >= 80) { r.wrote = now; const file = path.join(r.dir, `f-${String(r.frames.length).padStart(5, '0')}.jpg`); r.frames.push({ file, t: now }); fs.writeFile(file, Buffer.from(params.data, 'base64'), () => {}) }
        break
      }
      case 'Page.loadEventFired': this.onLoad?.(); this.onLoad = undefined; this.afterLoad(); break
      case 'Page.navigatedWithinDocument': this.onLoad?.(); this.onLoad = undefined; break
      // Nobody is there to answer a dialog, and an unanswered one cancels whatever caused it (a navigation, say).
      case 'Page.javascriptDialogOpening': void this.cdp('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); if (params.type !== 'beforeunload') this.note(`${params.type}: ${String(params.message).slice(0, 300)} (accepted)`); break
      case 'Runtime.consoleAPICalled': if (params.type === 'warning' || params.type === 'error') this.note(`console.${params.type === 'warning' ? 'warn' : 'error'}: ${(params.args ?? []).map((a: any) => a.value ?? a.description ?? '').join(' ').slice(0, 500)}`); break
      case 'Runtime.exceptionThrown': this.note(`uncaught: ${String(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? '').slice(0, 500)}`); break
      case 'Network.responseReceived': if (params.response?.status >= 400) this.note(`${params.response.status} ${String(params.response.url).slice(0, 200)}`); break
      case 'Network.loadingFailed': if (!params.canceled) this.note(`request failed: ${params.errorText ?? ''} ${params.type ?? ''}`); break
    }
  }
  private popup(info: { targetId: string; url: string }) {
    this.popupIds.add(info.targetId)
    if (!info.url || info.url === 'about:blank') return // not navigated yet; targetInfoChanged will say where
    this.popupIds.delete(info.targetId)
    this.popups.push(info.url)
    void this.chrome.send('Target.closeTarget', { targetId: info.targetId }).catch(() => {})
    void this.load(info.url)
  }
  private afterLoad() {
    if (this.rec?.caption) this.fire(CAPTION_JS(this.rec.caption)) // a caption outlives a navigation
    if (this.at) this.fire(CURSOR_JS(this.at.x, this.at.y)) // so does the pointer
  }

  async setSize(w: number, h: number) { this.size = [w, h]; await this.cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: SCALE, mobile: false }) }
  url() { return this.evaluate<string>('location.href') }
  async where() { return this.evaluate<string>(`location.href + (document.title ? ' — ' + document.title : '')`) }

  /** Go to a URL and wait for the page to settle. */
  async load(url: string) {
    this.failed = undefined
    const loaded = new Promise<void>((r) => { this.onLoad = r })
    const r = await this.cdp<{ errorText?: string }>('Page.navigate', { url }, 30_000)
    if (r.errorText && r.errorText !== 'net::ERR_ABORTED') { this.failed = r.errorText; this.onLoad = undefined; return }
    await Promise.race([loaded, sleep(20_000)])
    await sleep(400)
  }

  /** Where a target is: an element (a ref, text=Label, a selector), scrolled into view, or x,y in page pixels (a canvas). */
  async spot(target: string): Promise<Spot> {
    const xy = /^(\d+),(\d+)$/.exec(target.trim())
    if (xy) return { x: +xy[1], y: +xy[2], name: `${xy[1]},${xy[2]}` }
    const at = await this.evaluate<Spot & { error?: string }>(locateJs(target))
    if (at.error) throw new Error(at.error)
    await sleep(120) // let the scroll-into-view land before aiming at it
    const again = await this.evaluate<Spot & { error?: string }>(locateJs(target))
    return again.error ? at : { ...again, name: at.name }
  }
  /** Move the mouse there, for the recording's pointer and the page itself. */
  async moveMouse(x: number, y: number, opts: { buttons?: number; settle?: number } = {}) {
    // Recording: the pointer glides for 600ms and rests before anything happens, so a viewer sees it travel and arrive.
    const glide = this.rec && opts.settle === undefined ? 600 : 250
    this.at = { x, y }; this.fire(CURSOR_JS(x, y, glide))
    await this.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: opts.buttons ? 'left' : 'none', buttons: opts.buttons ?? 0 })
    await sleep(opts.settle ?? (this.rec ? 900 : 250)) // a beat so the pointer is seen arriving before the page reacts
  }
  press(x: number, y: number, type: 'mousePressed' | 'mouseReleased', clickCount = 1, button: 'left' | 'right' = 'left') {
    return this.cdp('Input.dispatchMouseEvent', { type, x, y, button, buttons: type === 'mousePressed' ? (button === 'right' ? 2 : 1) : 0, clickCount })
  }
  async click(target: string, times = 1, button: 'left' | 'right' = 'left'): Promise<string> {
    const at = await this.spot(target)
    await this.moveMouse(at.x, at.y)
    if (this.rec) { // the ring and the word, as the click lands
      const color = button === 'right' ? AMBER : GREEN
      this.fire(CLICK_JS(at.x, at.y, color))
      this.hud(`mouse(${at.x}, ${at.y}, ${JSON.stringify(button)}, ${JSON.stringify(color)}, ${times})`)
    }
    for (let n = 1; n <= times; n++) { await this.press(at.x, at.y, 'mousePressed', n, button); await this.press(at.x, at.y, 'mouseReleased', n, button) }
    if (this.rec) await sleep(500) // and the result on screen before the next step
    return at.name
  }
  /** Type like a person: one key at a time, as real key events, at a human pace while recording and fast otherwise. */
  async typeText(text: string) {
    for (const ch of text) {
      if (ch === '\n') { await this.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' }); await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }); this.hud(`key(['↩ enter'])`) }
      else {
        const vk = /^[a-z0-9]$/i.test(ch) ? ch.toUpperCase().charCodeAt(0) : ch === ' ' ? 32 : 0
        await this.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
        await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
        this.hud(`typed(${JSON.stringify(ch)})`)
      }
      await sleep(this.rec ? 45 + Math.random() * 40 + (/[\s.,!?;:]/.test(ch) ? 110 : 0) : 8)
    }
  }
  /** Press at one spot, carry to the other in steps the page (and the viewer) can follow, let go. */
  async drag(from: string, to: string): Promise<string> {
    const a = await this.spot(from), b = await this.spot(to)
    await this.moveMouse(a.x, a.y)
    this.hud(`hold(${a.x}, ${a.y}, '${GREEN}')`)
    await this.press(a.x, a.y, 'mousePressed')
    const steps = 8
    for (let i = 1; i <= steps; i++) { const x = a.x + ((b.x - a.x) * i) / steps, y = a.y + ((b.y - a.y) * i) / steps; await this.moveMouse(x, y, { buttons: 1, settle: this.rec ? 90 : 60 }); this.hud(`move(${x}, ${y})`) }
    await sleep(150)
    await this.press(b.x, b.y, 'mouseReleased')
    this.hud('release()')
    if (this.rec) this.fire(CLICK_JS(b.x, b.y))
    return `${a.name} → ${b.name}`
  }
  /** The element the last locate found, as a remote object — for CDP calls that take a node (file inputs). */
  async lastObject() { return (await this.cdp<{ result: { objectId?: string } }>('Runtime.evaluate', { expression: 'window.__glade && window.__glade.last' })).result.objectId }
  private async locate(target: string) {
    const at = await this.evaluate<{ rect?: Rect; name?: string; error?: string }>(locateJs(target))
    if (at.error || !at.rect) throw new Error(at.error ?? 'could not find that')
    await sleep(150) // it was scrolled into view; locate again so the box starts where it is
    const again = await this.evaluate<{ rect?: Rect }>(locateJs(target))
    return { rect: again.rect ?? at.rect, name: at.name ?? '' }
  }

  async run(sub: string, rest: string[], cwd: string): Promise<Reply> {
    switch (sub) {
      case 'open': {
        const cur = await this.url()
        const base = /^https?:/.test(cur) ? cur : process.env.GLADE_URL
        let url: string
        try { url = new URL(rest[0] ?? '/', base).toString() } catch { return { ok: false, text: `open what? Give a full URL the first time — \`glade open http://localhost:3000\` — then paths like /settings resolve against it` } }
        await this.load(url)
        if (this.failed) return { ok: false, text: `${url} did not load (${this.failed}). Is the app running there?` }
        return { ok: true, text: `at ${await this.where()}\nrun \`glade snapshot\` to see what's on it` }
      }
      case 'url': return { ok: true, text: await this.where() }
      case 'back': {
        const h = await this.cdp<{ currentIndex: number; entries: { id: number }[] }>('Page.getNavigationHistory')
        const prev = h.entries[h.currentIndex - 1]; if (!prev) return { ok: false, text: 'nothing to go back to' }
        await this.cdp('Page.navigateToHistoryEntry', { entryId: prev.id }); await sleep(700)
        return { ok: true, text: `at ${await this.where()}` }
      }
      case 'reload': await this.load(await this.url()); return { ok: true, text: `reloaded ${await this.where()}` }
      case 'snapshot': {
        const s = await this.evaluate<{ url: string; title: string; lines: string[]; more: number }>(SNAPSHOT_JS)
        return { ok: true, text: [`${s.url}${s.title ? ` — ${s.title}` : ''}`, ...(s.lines.length ? s.lines : ['(nothing to act on — the page may still be loading; try `glade wait 1000`, or `glade text`)']), ...(s.more ? [`… and ${s.more} more controls not listed`] : [])].join('\n') }
      }
      case 'text': {
        const t = await this.evaluate<string | null>(`(() => { const el = ${rest[0] ? `document.querySelector(${JSON.stringify(rest[0])})` : 'document.body'}; return el ? el.innerText : null })()`)
        if (t === null) return { ok: false, text: `no element matches ${rest[0]}` }
        const text = t.replace(/\n{3,}/g, '\n\n').trim()
        return { ok: true, text: text.length > 8000 ? `${text.slice(0, 8000)}\n… (${text.length - 8000} more characters; pass a selector to read one part)` : text || '(no text)' }
      }
      case 'click': {
        if (!rest[0]) return { ok: false, text: 'click what? a ref from the snapshot (e12), text=Label, or a CSS selector' }
        const before = await this.url()
        this.popups.length = 0
        const name = await this.click(rest.join(' '))
        await sleep(500)
        const tabs = this.popups.map((u) => `\nit asked to open a new tab: ${u} (opened here instead)`).join('')
        const now = await this.url()
        return { ok: true, text: `clicked "${name}"${now !== before ? ` → now at ${await this.where()}` : ''}${tabs}` }
      }
      case 'fill': {
        if (rest.length < 2) return { ok: false, text: 'usage: glade fill <target> <text>' }
        const name = await this.click(rest[0])
        if (!(await this.evaluate<boolean>(FOCUS_JS))) return { ok: false, text: `"${name}" did not take focus — is it a field?` }
        await this.evaluate(`(() => { const el = document.activeElement; if (el && el.select) el.select(); else if (el && el.isContentEditable) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r) } })()`)
        await this.typeText(rest.slice(1).join(' '))
        return { ok: true, text: `filled "${name}"` }
      }
      case 'press': {
        // cmd+a, shift+Tab, ctrl+Enter: the modifiers are a bitmask to CDP, and a modified key sends no text.
        const parts = (rest[0] ?? '').split('+')
        const k = parts.pop() ?? ''
        const modifiers = parts.reduce((m, x) => m | (MODS[x.toLowerCase()] ?? 0), 0)
        if (parts.some((x) => !MODS[x.toLowerCase()])) return { ok: false, text: `unknown modifier in ${rest[0]}: use cmd, ctrl, alt, shift` }
        const def = KEYS[k] ?? (k.length === 1 ? { key: k, code: '', vk: k.toUpperCase().charCodeAt(0), text: k } : null)
        if (!def) return { ok: false, text: `unknown key ${k}. Known: ${Object.keys(KEYS).join(', ')}, or a single character` }
        const text = modifiers & ~8 ? undefined : def.text
        await this.cdp('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: def.key, code: def.code, windowsVirtualKeyCode: def.vk, nativeVirtualKeyCode: def.vk, text, modifiers, commands: modifiers & 4 && k.length === 1 ? [{ a: 'selectAll', c: 'copy', v: 'paste', x: 'cut', z: 'undo' }[k.toLowerCase() as 'a']].filter(Boolean) : undefined })
        await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: def.key, code: def.code, windowsVirtualKeyCode: def.vk, nativeVirtualKeyCode: def.vk, modifiers })
        this.hud(`key(${JSON.stringify([...parts.map((x) => KEY_GLYPH[x.toLowerCase()] ?? x), KEY_GLYPH[k] ?? k])})`)
        await sleep(this.rec ? 700 : 300)
        return { ok: true, text: `pressed ${rest[0]}` }
      }
      case 'rightclick': {
        if (!rest[0]) return { ok: false, text: 'rightclick what? a ref, text=Label, a selector, or x,y' }
        const name = await this.click(rest.join(' '), 1, 'right'); await sleep(300)
        return { ok: true, text: `right-clicked "${name}" — snapshot to see the menu` }
      }
      case 'dblclick': {
        if (!rest[0]) return { ok: false, text: 'dblclick what? a ref, text=Label, a selector, or x,y' }
        const name = await this.click(rest.join(' '), 2); await sleep(300)
        return { ok: true, text: `double-clicked "${name}"` }
      }
      case 'highlight': {
        if (!rest[0]) return { ok: false, text: 'highlight what? a ref, text=Label, a selector — or off' }
        if (rest[0] === 'off') { this.hl = false; await this.evaluate(HIGHLIGHT_JS(false)).catch(() => {}); return { ok: true, text: 'highlight off' } }
        const { rect: r, name } = await this.locate(rest.join(' '))
        await this.evaluate(HIGHLIGHT_JS(true)).catch(() => {}); this.hl = true
        // The pointer rests where it last clicked — often on the very thing being shown. Step it out of the box.
        const c = this.at
        if (c && c.x >= r.x - 12 && c.x <= r.x + r.width + 12 && c.y >= r.y - 12 && c.y <= r.y + r.height + 12) {
          const [w, h] = this.size
          const x = r.x + r.width + 48 <= w ? r.x + r.width + 48 : Math.max(12, r.x - 48), y = Math.min(h - 12, r.y + r.height + 36)
          await this.moveMouse(x, y, { settle: 300 })
        }
        return { ok: true, text: `highlighting "${name}" — it glows in screenshots and the recording, follows the element and goes when it does; \`glade highlight off\` ends it` }
      }
      case 'hover': {
        if (!rest[0]) return { ok: false, text: 'hover what? a ref, text=Label, a selector, or x,y' }
        const at = await this.spot(rest.join(' '))
        await this.moveMouse(at.x, at.y, { settle: 400 })
        return { ok: true, text: `hovering over "${at.name}" — snapshot to see what that revealed` }
      }
      case 'drag': {
        if (rest.length < 2) return { ok: false, text: 'usage: glade drag <from> <to> — each a ref, text=Label, a selector, or x,y' }
        const name = await this.drag(rest[0], rest.slice(1).join(' ')); await sleep(300)
        return { ok: true, text: `dragged ${name}` }
      }
      case 'scroll': {
        const dir = rest[0]
        if (dir === 'to' && rest[1]) { const at = await this.spot(rest.slice(1).join(' ')); await this.moveMouse(at.x, at.y, { settle: 150 }); return { ok: true, text: `scrolled "${at.name}" into view` } }
        const d = { down: [0, 1], up: [0, -1], right: [1, 0], left: [-1, 0] }[dir ?? '']
        if (!d) return { ok: false, text: 'usage: glade scroll <down|up|left|right> [px] [at <target>], or scroll to <target>' }
        const px = /^\d+$/.test(rest[1] ?? '') ? Number(rest[1]) : 500
        const atIdx = rest.indexOf('at')
        const [cw, ch] = this.size
        const at = atIdx >= 0 && rest[atIdx + 1] ? await this.spot(rest.slice(atIdx + 1).join(' ')) : { x: cw / 2, y: ch / 2, name: 'the page' }
        await this.moveMouse(at.x, at.y, { settle: 120 })
        // A wheel, not a jump: the distance goes in ticks that ease out, so the page scrolls as it does under a finger.
        this.hud(`wheel(${at.x}, ${at.y}, ${JSON.stringify(dir)})`)
        const ticks = this.rec ? 14 : 4
        let done = 0
        for (let i = 1; i <= ticks; i++) {
          const t = i / ticks, target = Math.round(px * (1 - Math.pow(1 - t, 3))), step = target - done; done = target
          if (step) await this.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: d[0] * step, deltaY: d[1] * step })
          await sleep(this.rec ? 32 : 10)
        }
        await sleep(this.rec ? 400 : 200)
        return { ok: true, text: `scrolled ${dir} ${px}px over ${at.name}` }
      }
      case 'type': {
        if (!rest.length) return { ok: false, text: 'type what?' }
        await this.typeText(rest.join(' ')); await sleep(150)
        return { ok: true, text: `typed ${rest.join(' ').length} characters into what has focus` }
      }
      case 'select': {
        if (rest.length < 2) return { ok: false, text: 'usage: glade select <target> <option text or value>' }
        const at = await this.spot(rest[0])
        await this.moveMouse(at.x, at.y, { settle: 150 })
        const want = rest.slice(1).join(' ')
        const r = await this.evaluate<{ ok?: boolean; chosen?: string; error?: string; options?: string[] }>(`(() => { const el = window.__glade && window.__glade.last; if (!el || el.tagName !== 'SELECT') return { error: 'not a <select>' }; const want = ${JSON.stringify(want)}; const o = [...el.options].find((o) => o.text.trim() === want || o.value === want) || [...el.options].find((o) => o.text.trim().toLowerCase().includes(want.toLowerCase())); if (!o) return { error: 'no such option', options: [...el.options].map((o) => o.text.trim()) }; el.value = o.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return { ok: true, chosen: o.text.trim() } })()`)
        if (r.error) return { ok: false, text: r.options ? `${r.error} — the options are: ${r.options.join(' · ')}` : `"${at.name}" is ${r.error}; for a custom dropdown, click it and then click the option` }
        return { ok: true, text: `chose "${r.chosen}" in "${at.name}"` }
      }
      case 'check': case 'uncheck': {
        if (!rest[0]) return { ok: false, text: `${sub} what? a ref, text=Label, or a selector` }
        const at = await this.spot(rest.join(' '))
        const state = await this.evaluate<{ checked?: boolean; error?: string }>(`(() => { const el = window.__glade && window.__glade.last; if (!el) return { error: 'gone' }; const box = el.matches('input[type=checkbox],input[type=radio],[role=checkbox],[role=switch]') ? el : el.querySelector('input[type=checkbox],input[type=radio]'); if (!box) return { error: 'not a checkbox' }; return { checked: 'checked' in box ? box.checked : box.getAttribute('aria-checked') === 'true' } })()`)
        if (state.error) return { ok: false, text: `"${at.name}" is ${state.error}` }
        const want = sub === 'check'
        if (state.checked === want) return { ok: true, text: `"${at.name}" was already ${want ? 'checked' : 'unchecked'}` }
        await this.click(rest.join(' ')); await sleep(200)
        return { ok: true, text: `${want ? 'checked' : 'unchecked'} "${at.name}"` }
      }
      case 'upload': {
        if (rest.length < 2) return { ok: false, text: 'usage: glade upload <target> <file…> — a file input, or the button that opens one' }
        const files = rest.slice(1).map((f) => path.resolve(cwd, f))
        for (const f of files) if (!fs.existsSync(f)) return { ok: false, text: `no such file: ${f}` }
        const at = await this.spot(rest[0])
        await this.moveMouse(at.x, at.y, { settle: 150 })
        const found = await this.evaluate<boolean>(`(() => { const el = window.__glade && window.__glade.last; if (!el) return false; const input = el.matches('input[type=file]') ? el : el.querySelector('input[type=file]') || (el.closest('label') && el.closest('label').querySelector('input[type=file]')) || (el.parentElement && el.parentElement.querySelector('input[type=file]')) || document.querySelector('input[type=file]'); if (!input) return false; window.__glade.last = input; return true })()`)
        if (!found) return { ok: false, text: `no file input at or near "${at.name}"` }
        const objectId = await this.lastObject()
        if (!objectId) return { ok: false, text: 'could not reach the file input' }
        await this.cdp('DOM.setFileInputFiles', { files, objectId }); await sleep(400)
        return { ok: true, text: `put ${files.length === 1 ? path.basename(files[0]) : `${files.length} files`} in the file input at "${at.name}"` }
      }
      case 'get': {
        const what = rest[0], target = rest.slice(what === 'attr' ? 2 : 1).join(' ')
        if (!what || !target) return { ok: false, text: 'usage: glade get text|value|attr <name>|count|box <target>' }
        if (what === 'count') { const n = await this.evaluate<number | null>(`(() => { try { return document.querySelectorAll(${JSON.stringify(target)}).length } catch { return null } })()`); return n === null ? { ok: false, text: `${target} is not a selector` } : { ok: true, text: String(n) } }
        const at = await this.spot(target)
        if (what === 'box') return { ok: true, text: at.rect ? `${Math.round(at.rect.x)},${Math.round(at.rect.y)} ${Math.round(at.rect.width)}×${Math.round(at.rect.height)}` : `${at.x},${at.y}` }
        const v = await this.evaluate<string | null>(`(() => { const el = window.__glade && window.__glade.last; if (!el) return null; ${what === 'text' ? 'return el.innerText' : what === 'value' ? "return 'value' in el ? String(el.value) : null" : what === 'attr' ? `return el.getAttribute(${JSON.stringify(rest[1] ?? '')})` : 'return null'} })()`)
        return v === null ? { ok: false, text: `"${at.name}" has no ${what}${what === 'attr' ? ` ${rest[1]}` : ''}` } : { ok: true, text: v }
      }
      case 'is': {
        const what = rest[0], target = rest.slice(1).join(' ')
        if (!['visible', 'enabled', 'checked'].includes(what ?? '') || !target) return { ok: false, text: 'usage: glade is visible|enabled|checked <target>' }
        let at: Spot
        try { at = await this.spot(target) } catch (e) { return what === 'visible' ? { ok: true, text: 'no' } : { ok: false, text: String((e as Error).message) } }
        const v = await this.evaluate<boolean>(`(() => { const el = window.__glade && window.__glade.last; if (!el) return false; ${what === 'visible' ? "const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'" : what === 'enabled' ? "return !el.disabled && el.getAttribute('aria-disabled') !== 'true'" : "return 'checked' in el ? !!el.checked : el.getAttribute('aria-checked') === 'true'"} })()`)
        return { ok: true, text: `${v ? 'yes' : 'no'} — "${at.name}" is ${v ? '' : 'not '}${what}` }
      }
      case 'wait': {
        const a = rest.join(' ')
        if (/^\d+$/.test(a)) { await sleep(Math.min(Number(a), 30_000)); return { ok: true, text: `waited ${a}ms` } }
        for (let i = 0; i < 40; i++) { if (await this.evaluate<boolean>(`document.body.innerText.includes(${JSON.stringify(a)})`)) return { ok: true, text: `"${a}" is on the page` }; await sleep(250) }
        return { ok: false, text: `"${a}" did not appear within 10s` }
      }
      case 'eval': {
        if (!rest.length) return { ok: false, text: 'usage: glade eval <javascript>' }
        const v = await this.evaluate(rest.join(' '))
        const out = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
        return { ok: true, text: (out ?? 'undefined').slice(0, 8000) }
      }
      case 'size': {
        const a = rest[0]
        if (!a) { const [w, h] = this.size; return { ok: true, text: `${w}×${h} — presets: ${Object.entries(PRESETS).map(([k, [w2, h2]]) => `${k} ${w2}×${h2}`).join(', ')}, or WxH` } }
        const m = /^(\d{3,4})[x×](\d{3,4})$/.exec(a)
        const sz = PRESETS[a] ?? (m ? [Number(m[1]), Number(m[2])] as [number, number] : null)
        if (!sz) return { ok: false, text: `size what? a preset (${Object.keys(PRESETS).join(', ')}), or WxH like 1440x900` }
        if (this.rec) return { ok: false, text: 'the size is fixed while recording — set it before `glade record start`' }
        this.fixed = true; await this.setSize(sz[0], sz[1]); await sleep(400)
        return { ok: true, text: `${sz[0]}×${sz[1]}` }
      }
      case 'record': return this.record(rest)
      case 'screenshot': return this.screenshot(rest)
      case 'console': {
        const out = this.log.slice(-60).join('\n') || '(no warnings, errors or failed requests since the page was opened)'
        if (rest[0] === '--clear') this.log.length = 0
        return { ok: true, text: out }
      }
      default: return { ok: false, text: `unknown: glade ${sub}\n\n${USAGE}` }
    }
  }

  private async record(rest: string[]): Promise<Reply> {
    const what = rest[0]
    if (what === 'start') {
      if (this.rec) return { ok: false, text: `already recording (${this.rec.frames.length} frames so far) — \`glade record stop\` first` }
      if (!(await hasFfmpeg())) return { ok: false, text: 'recording needs ffmpeg, which is not installed: brew install ffmpeg (or apt install ffmpeg), or set GLADE_FFMPEG' }
      const dir = path.join(this.outDir, `rec-${stamp()}`); fs.mkdirSync(dir, { recursive: true })
      const [rw, rh] = this.fixed ? this.size : [REC_W, REC_H]
      await this.setSize(rw, rh)
      await sleep(400) // let the page lay out at that size before the first frame
      this.rec = { dir, frames: [], marks: [], wrote: 0, until: Infinity }
      // The opening frame, before anything happens; then every frame the page paints.
      const first = await this.cdp<{ data: string }>('Page.captureScreenshot', { format: 'jpeg', quality: 82 }, 15_000).catch(() => null)
      if (first) { const file = path.join(dir, 'f-00000.jpg'); this.rec.frames.push({ file, t: Date.now() }); this.rec.wrote = Date.now(); fs.writeFileSync(file, Buffer.from(first.data, 'base64')) }
      await this.cdp('Page.startScreencast', { format: 'jpeg', quality: 82, maxWidth: rw * SCALE, maxHeight: rh * SCALE, everyNthFrame: 1 })
      return { ok: true, text: `recording at ${rw}×${rh} — do the steps, set captions with \`glade record caption <text>\`, then \`glade record stop\`` }
    }
    if (what === 'caption') {
      if (!this.rec) return { ok: false, text: 'not recording — `glade record start` first' }
      const text = rest.slice(1).join(' ')
      this.rec.caption = text === 'off' ? undefined : text
      this.rec.marks.push(Date.now())
      await this.evaluate(CAPTION_JS(this.rec.caption ?? '')).catch(() => {})
      return { ok: true, text: this.rec.caption ? `caption: ${this.rec.caption}` : 'caption off' }
    }
    if (what === 'stop') {
      const r = this.rec; if (!r) return { ok: false, text: 'not recording' }
      this.rec = undefined
      this.hl = false
      await this.evaluate(CAPTION_JS('') + ';' + HIGHLIGHT_JS(false)).catch(() => {})
      await this.cdp('Page.stopScreencast').catch(() => {})
      await sleep(200) // the last frames are still being written
      if (r.frames.length < 2) { fs.rmSync(r.dir, { recursive: true, force: true }); return { ok: false, text: 'nothing was recorded: the page never changed while recording' } }
      // Each frame shows until the next; a long gap (the agent thinking) is cut to a beat, so the clip is the interactions, not the waiting.
      const GAP = 1.2, MIN = 0.08, HOLD = 2.5
      const durs = r.frames.map((f, i) => { const next = r.frames[i + 1]; return next ? Math.max(MIN, Math.min(GAP, (next.t - f.t) / 1000)) : 1.5 })
      // Every caption stays up for at least HOLD seconds: an agent that sets one and acts in the same breath leaves
      // nothing readable. The segment keeps its pace; its last frame holds for whatever time is missing.
      const bounds = [...r.marks, Infinity]
      for (let m = 0; m + 1 < bounds.length; m++) {
        const idx = r.frames.map((f, i) => (f.t >= bounds[m] && f.t < bounds[m + 1] ? i : -1)).filter((i) => i >= 0)
        if (!idx.length) continue
        const have = idx.reduce((n, i) => n + durs[i], 0)
        if (have < HOLD) durs[idx[idx.length - 1]] += HOLD - have
      }
      const list = r.frames.map((f, i) => `file '${f.file.replace(/'/g, "'\\''")}'\nduration ${durs[i].toFixed(3)}`).join('\n') + `\nfile '${r.frames[r.frames.length - 1].file}'\n`
      const listFile = path.join(r.dir, 'list.txt'); fs.writeFileSync(listFile, list)
      const out = path.join(this.outDir, `demo-${path.basename(r.dir).slice(4)}.mp4`)
      const log = await tryOut(ffmpegBin(), ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', "scale='min(1920,iw)':-2,format=yuv420p", '-r', '30', '-movflags', '+faststart', out])
      if (!fs.existsSync(out)) return { ok: false, text: `ffmpeg could not assemble the video${log ? `: ${log.slice(-300)}` : ''} (frames kept in ${r.dir})` }
      fs.rmSync(r.dir, { recursive: true, force: true })
      const secs = durs.reduce((n, d) => n + d, 0)
      return { ok: true, text: `${out}\n(${Math.round(secs)}s, ${r.frames.length} frames)` }
    }
    return { ok: false, text: 'usage: glade record start | caption <text> | stop' }
  }

  private async screenshot(rest: string[]): Promise<Reply> {
    // Of the page, of one element (a ref, text=Label, or a selector — with a little room around it), or of a
    // region given as x,y,w,h in page pixels. A reviewer should see the part that matters, not the whole window.
    let clip: Rect | undefined
    let what = ''
    const full = rest.includes('--full'); if (full) rest.splice(rest.indexOf('--full'), 1)
    const crop = rest.includes('--crop'); if (crop) rest.splice(rest.indexOf('--crop'), 1)
    const region = /^(\d+),(\d+),(\d+),(\d+)$/.exec(rest[0] ?? '')
    let lit = false // a target without --crop: the whole viewport, the size under test, with the target glowing
    if (region) { clip = { x: +region[1], y: +region[2], width: +region[3], height: +region[4] }; what = ` — the region ${rest[0]}` }
    else if (rest[0] && !crop) {
      const { name } = await this.locate(rest.join(' '))
      await this.evaluate(HIGHLIGHT_JS(true)).catch(() => {}); await sleep(120); lit = true
      what = ` — "${name}" highlighted`
    } else if (rest[0]) {
      const { rect: r, name } = await this.locate(rest.join(' '))
      const [cw, ch] = this.size, pad = 12
      clip = { x: Math.max(0, Math.floor(r.x - pad)), y: Math.max(0, Math.floor(r.y - pad)), width: Math.min(cw, Math.ceil(r.width + pad * 2)), height: Math.min(ch, Math.ceil(r.height + pad * 2)) }
      what = ` — "${name}"`
    }
    // --full: the whole page, however long (up to 8000px).
    if (full && !clip) { const h = await this.evaluate<number>('Math.min(document.documentElement.scrollHeight, 8000)'); clip = { x: 0, y: 0, width: this.size[0], height: Math.max(h, this.size[1]) }; what = ' — the whole page' }
    await this.evaluate(FX_JS(true)).catch(() => {}); await sleep(60) // the pointer and any click/key effects stay out of the picture
    const shot = await this.cdp<{ data: string }>('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}), captureBeyondViewport: !!(full && !region) }, 20_000).catch(() => null)
    this.fire(FX_JS(false))
    if (lit && !this.hl) this.fire(HIGHLIGHT_JS(false)) // only for the picture, unless `highlight` set it
    if (!shot) return { ok: false, text: 'the page gave no picture (it may still be loading — try again)' }
    const buf = Buffer.from(shot.data, 'base64'), { w, h } = pngSize(buf)
    if (crop && h > w * 1.5) what += ' — a tall crop; for a PR picture, `screenshot <target>` without --crop gives the page with it highlighted'
    fs.mkdirSync(this.outDir, { recursive: true })
    // Keep the last 20 screenshots (only screenshots: framed pictures and videos live here too).
    for (const old of fs.readdirSync(this.outDir).filter((f) => f.startsWith('shot-') && f.endsWith('.png')).sort().slice(0, -19)) fs.rmSync(path.join(this.outDir, old), { force: true })
    const file = path.join(this.outDir, `shot-${stamp()}.png`)
    fs.writeFileSync(file, buf)
    return { ok: true, text: `${file}\n(${w}×${h} of ${await this.where()}${what} — read the file to look at it)` }
  }
}

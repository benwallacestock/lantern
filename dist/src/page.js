// The page an agent drives, and every command it can run on it. One page per project, kept by the daemon.
//
// The page is a real Chrome tab with no window, rendered at 2x like a Retina screen, so screenshots and recordings
// are sharp. It is driven over the DevTools protocol: input goes in as real mouse and key events (the page sees
// mousedown, keydown, input — the lot), so what the agent does is what a person would do.
//
// Recording keeps the frames Chrome paints (Page.startScreencast) — only while a command runs and for a beat after,
// so the agent's thinking between commands is cut out — and ffmpeg (or Chrome itself) assembles them when it
// stops. Everything the viewer needs is drawn into the page itself: a caption, the pointer, a ring where a click
// lands, the keys typed.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BLUE, CAPTION_JS, CLICK_JS, CURSOR_JS, FOCUS_JS, FX_JS, ORANGE, HIGHLIGHT_JS, HUD_JS, KEYS, KEY_GLYPH, SNAPSHOT_JS, locateJs } from './pageScripts.js';
import { USAGE } from './usage.js';
import { encodeInChrome } from './encode.js';
import { hostAllowed } from './config.js';
/** ms of recording after a command returns: the page reacting, a transition finishing. */
export const SETTLE = 1500;
const SCALE = 2;
const PRESETS = { phone: [390, 844], tablet: [1024, 768], laptop: [1280, 800], desktop: [1440, 900], wide: [1920, 1080] };
const [REC_W, REC_H] = [1440, 900]; // the size to start at and to record at unless the agent chose one: 16:10, a reviewer's screen
const MODS = { alt: 1, option: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, shift: 8 };
/** Key names for characters, as apps that look at `event.code` (shortcuts, games) expect. */
const CODES = { '=': 'Equal', '-': 'Minus', '+': 'Equal', ',': 'Comma', '.': 'Period', '/': 'Slash', ';': 'Semicolon', "'": 'Quote', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', '`': 'Backquote', ' ': 'Space' };
const NAMED = { Equal: '=', Minus: '-', Plus: '+', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const pngSize = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
/** Commands that put input into the page, after which a navigation is checked for. */
const INPUT = new Set(['click', 'dblclick', 'rightclick', 'fill', 'press', 'type', 'check', 'uncheck', 'select', 'drag']);
/** Input types a person sets through a picker rather than by typing. */
const PICKED = new Set(['date', 'time', 'datetime-local', 'month', 'week', 'range', 'color']);
export const ffmpegBin = () => process.env.LANTERN_FFMPEG || [process.env.HOME + '/.local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((f) => fs.existsSync(f)) || 'ffmpeg';
const hasFfmpeg = () => new Promise((res) => execFile(ffmpegBin(), ['-version'], (e) => res(!e)));
const tryOut = (bin, args) => new Promise((res) => execFile(bin, args, { maxBuffer: 1 << 24 }, (e, so, se) => res(String(se || so || (e ? e.message : '')))));
export class Page {
    chrome;
    session = '';
    targetId = '';
    outDir;
    log = [];
    popups = [];
    rec;
    hl = false; // a highlight the agent set (as opposed to one a screenshot lit for the picture)
    at; // where the pointer rests
    size = [REC_W, REC_H];
    fixed = false; // a size the agent chose, kept for recordings
    failed;
    /** Where relative paths resolve: the origin of the last page that loaded. Remembered across daemons, with the page itself. */
    base;
    lastUrl;
    reopened; // set when a fresh daemon put the last page back; said once
    config = {};
    stateFile;
    /** Whoever is watching the page: each gets every frame it paints (at most ~8 a second) and a line for each action. */
    watchers = new Set();
    lastFrame;
    sentAt = 0;
    screencast = false;
    currentUrl = 'about:blank';
    onLoad;
    mainFrame = '';
    /** A navigation of the main frame is under way (a click submitted a form, a link was followed). */
    loading = false;
    docStatus = 0; // the HTTP status of the main document, for `open`
    navigated = false; // the main frame navigated during the current command
    /** Set when input dispatched to the page no longer arrives: the daemon restarts the browser. */
    dead = false;
    requests = new Map(); // requestId → url, to name a failed request
    popupIds = new Set();
    downloads = []; // files that arrived during the current command
    pending = new Map(); // download guid → suggested name
    constructor(chrome, outDir, stateFile, config = {}) {
        this.chrome = chrome;
        this.outDir = outDir;
        this.stateFile = stateFile;
        this.config = config;
        this.base = config.url;
        if (stateFile) {
            try {
                const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
                this.base ??= st.base;
                this.lastUrl = st.url;
            }
            catch { }
        }
    }
    static async open(chrome, outDir, stateFile, config = {}) {
        const p = new Page(chrome, outDir, stateFile, config);
        const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true });
        p.targetId = targetId;
        p.session = sessionId;
        chrome.on((sid, method, params) => p.event(sid, method, params));
        await p.cdp('Page.enable');
        await p.cdp('Runtime.enable');
        await p.cdp('Network.enable');
        p.mainFrame = (await p.cdp('Page.getFrameTree')).frameTree.frame.id;
        // A host list: every page-level request is looked at before it goes out, and one to anywhere else fails.
        if (config.hosts?.length)
            await p.cdp('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] });
        await chrome.send('Target.setDiscoverTargets', { discover: true });
        // Downloads go in the project, named as the server named them, and are reported — never into the person's own folders.
        fs.mkdirSync(path.join(outDir, 'downloads'), { recursive: true });
        await chrome.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: path.join(outDir, 'downloads'), eventsEnabled: true }).catch(() => { });
        await p.setSize(...p.size);
        if (stateFile) {
            try {
                const saved = JSON.parse(fs.readFileSync(path.join(path.dirname(stateFile), 'cookies.json'), 'utf8'));
                await p.cookiesIn(saved);
            }
            catch { }
        }
        return p;
    }
    cdp(method, params = {}, ms = 10_000) { return this.chrome.send(method, params, this.session, ms); }
    /** Every cookie the browser holds, and putting them back: session cookies die with Chrome, so a login would
     * otherwise last only until the daemon's next idle stop. Saved on stop, restored on start. */
    async cookiesOut() { return (await this.chrome.send('Storage.getCookies')).cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, expires: c.expires, priority: c.priority, sourceScheme: c.sourceScheme, sourcePort: c.sourcePort, ...(c.partitionKey ? { partitionKey: c.partitionKey } : {}) })); }
    async cookiesIn(cookies) { if (cookies.length)
        await this.chrome.send('Storage.setCookies', { cookies }); }
    async evaluate(expression) {
        const r = await this.cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails)
            throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'the script threw');
        return r.result.value;
    }
    /** Something drawn for the viewer: never in the way of the command itself. */
    fire(js) { void this.evaluate(js).catch(() => { }); }
    hud(call) { this.fire(`${HUD_JS}; window.__lanternHud.${call}`); }
    note(line) { this.log.push(`${new Date().toISOString().slice(11, 19)} ${line}`); if (this.log.length > 300)
        this.log.splice(0, this.log.length - 300); }
    saveState() { if (!this.stateFile)
        return; try {
        fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
        fs.writeFileSync(this.stateFile, JSON.stringify({ base: this.base, url: this.lastUrl }));
    }
    catch { } }
    event(sid, method, params) {
        if (sid === undefined) {
            if (method === 'Browser.downloadWillBegin') {
                this.pending.set(params.guid, params.suggestedFilename || 'download');
                return;
            }
            if (method === 'Browser.downloadProgress' && params.state === 'completed') {
                const name = this.pending.get(params.guid);
                this.pending.delete(params.guid);
                if (!name)
                    return;
                const dir = path.join(this.outDir, 'downloads');
                let to = path.join(dir, name);
                for (let i = 2; fs.existsSync(to); i++)
                    to = path.join(dir, `${path.parse(name).name}-${i}${path.parse(name).ext}`);
                try {
                    fs.renameSync(path.join(dir, params.guid), to);
                    this.downloads.push(to);
                    this.note(`downloaded ${to}`);
                }
                catch { }
                return;
            }
            // A link that opens a new tab has nowhere useful to open one: it is closed, and followed here instead.
            if (method === 'Target.targetCreated' && params.targetInfo?.type === 'page' && params.targetInfo.openerId === this.targetId)
                this.popup(params.targetInfo);
            else if (method === 'Target.targetInfoChanged' && this.popupIds.has(params.targetInfo?.targetId))
                this.popup(params.targetInfo);
            return;
        }
        if (sid !== this.session)
            return;
        switch (method) {
            case 'Page.screencastFrame': {
                void this.cdp('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => { });
                const jpeg = Buffer.from(params.data, 'base64'), now = Date.now();
                // Recording: keep the frame (at most ~12 a second). The page only paints when something changed, so a pause
                // in the agent's thinking leaves a gap in the timestamps, not a run of identical frames.
                const r = this.rec;
                if (r && now <= r.until && now - r.wrote >= 80) {
                    r.wrote = now;
                    const file = path.join(r.dir, `f-${String(r.frames.length).padStart(5, '0')}.jpg`);
                    r.frames.push({ file, t: now });
                    fs.writeFile(file, jpeg, () => { });
                }
                // Watching: the latest frame to everyone looking, at most ~8 a second.
                this.lastFrame = jpeg;
                if (this.watchers.size && now - this.sentAt > 120) {
                    this.sentAt = now;
                    for (const w of this.watchers)
                        w.frame?.(jpeg, this.currentUrl);
                }
                break;
            }
            case 'Fetch.requestPaused': {
                let host = '';
                try {
                    host = new URL(params.request.url).hostname;
                }
                catch { }
                if (hostAllowed(this.config.hosts, host))
                    void this.cdp('Fetch.continueRequest', { requestId: params.requestId }).catch(() => { });
                else {
                    this.note(`blocked navigation to ${params.request.url} (not one of this project's hosts)`);
                    void this.cdp('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }).catch(() => { });
                }
                break;
            }
            case 'Page.frameStartedLoading':
                if (params.frameId === this.mainFrame)
                    this.loading = true;
                break;
            case 'Page.frameNavigated':
                if (!params.frame?.parentId) {
                    this.mainFrame = params.frame.id;
                    this.currentUrl = params.frame.url;
                    this.navigated = true;
                }
                break;
            case 'Page.loadEventFired':
                this.loading = false;
                this.onLoad?.();
                this.onLoad = undefined;
                this.afterLoad();
                break;
            case 'Page.navigatedWithinDocument':
                this.loading = false;
                this.onLoad?.();
                this.onLoad = undefined;
                break;
            // Nobody is there to answer a dialog, and an unanswered one cancels whatever caused it (a navigation, say).
            case 'Page.javascriptDialogOpening':
                void this.cdp('Page.handleJavaScriptDialog', { accept: true }).catch(() => { });
                this.note(params.type === 'beforeunload' ? 'beforeunload: the page asked before leaving; left anyway' : `${params.type}: ${String(params.message).slice(0, 300)} (accepted)`);
                break;
            case 'Runtime.consoleAPICalled':
                if (params.type === 'warning' || params.type === 'error')
                    this.note(`console.${params.type === 'warning' ? 'warn' : 'error'}: ${(params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 500)}`);
                break;
            case 'Runtime.exceptionThrown':
                this.note(`uncaught: ${String(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? '').slice(0, 500)}`);
                break;
            case 'Network.requestWillBeSent':
                if (params.request?.url) {
                    this.requests.set(params.requestId, params.request.url);
                    if (this.requests.size > 500)
                        this.requests.delete(this.requests.keys().next().value);
                }
                break;
            case 'Network.responseReceived':
                if (params.type === 'Document' && params.frameId === this.mainFrame)
                    this.docStatus = params.response?.status ?? 0;
                if (params.response?.status >= 400)
                    this.note(`${params.response.status} ${String(params.response.url).slice(0, 200)}`);
                break;
            case 'Network.loadingFailed':
                if (!params.canceled)
                    this.note(`request failed: ${params.errorText ?? ''} ${params.type ?? ''} ${(this.requests.get(params.requestId) ?? '').slice(0, 200)}`.trim());
                break;
        }
    }
    popup(info) {
        this.popupIds.add(info.targetId);
        if (!info.url || info.url === 'about:blank')
            return; // not navigated yet; targetInfoChanged will say where
        this.popupIds.delete(info.targetId);
        this.popups.push(info.url);
        void this.chrome.send('Target.closeTarget', { targetId: info.targetId }).catch(() => { });
        let host = '';
        try {
            host = new URL(info.url).hostname;
        }
        catch { }
        if (this.popups.length > 1)
            return; // one is followed; the rest of a burst are only counted
        if (hostAllowed(this.config.hosts, host))
            void this.load(info.url);
        else
            this.note(`a link wanted to open ${info.url} in a new tab (not one of this project's hosts, so not followed)`);
    }
    afterLoad() {
        if (this.rec?.caption)
            this.fire(CAPTION_JS(this.rec.caption)); // a caption outlives a navigation
        if (this.at)
            this.fire(CURSOR_JS(this.at.x, this.at.y)); // so does the pointer
        if (this.config.onLoad)
            this.fire(this.config.onLoad); // the project's own after-load script: a dev login, say
    }
    /** Tell whoever is watching what just happened, in words — 'clicked "Save changes"' — not the command as typed. */
    did(text) { for (const w of this.watchers)
        w.did?.(text); }
    /** Frames flow while recording or while someone watches; the screencast is one stream shared by both. */
    async wantFrames() { if (this.screencast)
        return; this.screencast = true; await this.cdp('Page.startScreencast', { format: 'jpeg', quality: 82, maxWidth: 2880, maxHeight: 1800, everyNthFrame: 1 }); }
    async doneWithFrames() { if (!this.screencast || this.rec || this.watchers.size)
        return; this.screencast = false; await this.cdp('Page.stopScreencast').catch(() => { }); }
    /** If something set a navigation going, wait for the new page (a form's redirect, a followed link) before reading it. */
    async settle(ms = 10_000) {
        if (!this.loading)
            return;
        const loaded = new Promise((r) => { this.onLoad = r; });
        await Promise.race([loaded, sleep(ms)]);
        await sleep(300);
    }
    async setSize(w, h) { this.size = [w, h]; await this.cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: SCALE, mobile: false }); }
    url() { return this.evaluate('location.href'); }
    async where() { return this.evaluate(`location.href + (document.title ? ' — ' + document.title : '')`); }
    /** Go to a URL and wait for the page to settle. */
    async load(url) {
        this.failed = undefined;
        this.docStatus = 0;
        const loaded = new Promise((r) => { this.onLoad = r; });
        const r = await this.cdp('Page.navigate', { url }, 30_000);
        // An HTTP error page is a page: the server answered. ERR_ABORTED is a download or a navigation that gave way to another.
        if (r.errorText && !/ERR_ABORTED|ERR_HTTP_RESPONSE_CODE_FAILURE/.test(r.errorText)) {
            this.failed = r.errorText;
            this.onLoad = undefined;
            return;
        }
        await Promise.race([loaded, sleep(20_000)]);
        await sleep(400);
        if (this.config.onLoad)
            for (let i = 0; i < 20 && (await this.evaluate('!!document.querySelector("input[type=password]")').catch(() => false)); i++)
                await sleep(300); // the after-load script may be logging in
        if (/^https?:/.test(url)) {
            this.base = new URL(url).origin;
            this.lastUrl = url;
            this.saveState();
        }
    }
    /** A fresh daemon (after an idle stop, or Chrome dying) puts the last page back before the first command that needs one. */
    async restoreIfBlank() {
        if (this.lastUrl && (await this.url()) === 'about:blank') {
            await this.load(this.lastUrl);
            this.reopened = this.failed ? undefined : this.lastUrl;
        }
    }
    preface() { const r = this.reopened; this.reopened = undefined; return r ? `(the browser had been restarted; ${r} was opened again)\n` : ''; }
    /** Where a target is: an element (a ref, text=Label, a selector), scrolled into view, or x,y in page pixels (a canvas).
     * Something in front of the element is an error: the click would land on that instead. */
    async spot(target, scroll = true, allowCovered = false) {
        const xy = /^(-?\d+),(-?\d+)$/.exec(target.trim());
        if (xy)
            return { x: +xy[1], y: +xy[2], name: `${xy[1]},${xy[2]}` };
        const at = await this.evaluate(locateJs(target, scroll));
        if (at.error)
            throw new Error(at.error);
        if (!scroll)
            return at;
        await sleep(120); // let the scroll-into-view land before aiming at it
        const again = await this.evaluate(locateJs(target));
        const spot = again.error ? at : { ...again, name: at.name, matches: at.matches };
        if (spot.covered && !allowCovered)
            throw new Error(`"${spot.name}" is covered by ${spot.covered}, which would get the click instead — close what is in front of it, or scroll it clear`);
        return spot;
    }
    /** "3 elements read that": said when a text= target was ambiguous. */
    several(at) { return at.matches && at.matches > 1 ? ` (${at.matches} elements read that; the first that looked pressable was used — a selector picks another)` : ''; }
    /** Move the mouse there, for the recording's pointer and the page itself. */
    async moveMouse(x, y, opts = {}) {
        // Recording: the pointer glides for 600ms and rests before anything happens, so a viewer sees it travel and arrive.
        const glide = this.rec && opts.settle === undefined ? 600 : 250;
        this.at = { x, y };
        this.fire(CURSOR_JS(x, y, glide));
        await this.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: opts.buttons ? 'left' : 'none', buttons: opts.buttons ?? 0 });
        await sleep(opts.settle ?? (this.rec ? 900 : 250)); // a beat so the pointer is seen arriving before the page reacts
    }
    press(x, y, type, clickCount = 1, button = 'left') {
        return this.cdp('Input.dispatchMouseEvent', { type, x, y, button, buttons: type === 'mousePressed' ? (button === 'right' ? 2 : 1) : 0, clickCount });
    }
    async click(target, times = 1, button = 'left') {
        const at = await this.spot(target);
        await this.moveMouse(at.x, at.y);
        if (this.rec) { // the ring and the word, as the click lands
            const color = button === 'right' ? BLUE : ORANGE;
            this.fire(CLICK_JS(at.x, at.y, color));
            this.hud(`mouse(${at.x}, ${at.y}, ${JSON.stringify(button)}, ${JSON.stringify(color)}, ${times})`);
        }
        for (let n = 1; n <= times; n++) {
            await this.press(at.x, at.y, 'mousePressed', n, button);
            await this.press(at.x, at.y, 'mouseReleased', n, button);
        }
        if (this.rec)
            await sleep(500); // and the result on screen before the next step
        return at;
    }
    /** Type like a person: one key at a time, as real key events, at a human pace while recording and fast otherwise. */
    async typeText(text) {
        for (const ch of text) {
            if (ch === '\n') {
                await this.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
                await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
                this.hud(`key(['↩ enter'])`);
            }
            else {
                const vk = /^[a-z0-9]$/i.test(ch) ? ch.toUpperCase().charCodeAt(0) : ch === ' ' ? 32 : 0;
                const code = /^[a-z]$/i.test(ch) ? `Key${ch.toUpperCase()}` : /^[0-9]$/.test(ch) ? `Digit${ch}` : CODES[ch] ?? '';
                await this.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, text: ch, unmodifiedText: ch, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
                await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
                this.hud(`typed(${JSON.stringify(ch)})`);
            }
            await sleep(this.rec ? 45 + Math.random() * 40 + (/[\s.,!?;:]/.test(ch) ? 110 : 0) : 8);
        }
    }
    /** Press at one spot, carry to the other in steps the page (and the viewer) can follow, let go. */
    async drag(from, to) {
        await this.spot(to, true, true); // so both are known to exist…
        const a = await this.spot(from); // …then the page is left where `from` is on screen
        const b = await this.spot(to, false); // and `to` is found where it is now, without scrolling `from` away
        await this.moveMouse(a.x, a.y);
        this.hud(`hold(${a.x}, ${a.y}, '${ORANGE}')`);
        await this.press(a.x, a.y, 'mousePressed');
        const steps = 8;
        for (let i = 1; i <= steps; i++) {
            const x = a.x + ((b.x - a.x) * i) / steps, y = a.y + ((b.y - a.y) * i) / steps;
            await this.moveMouse(x, y, { buttons: 1, settle: this.rec ? 90 : 60 });
            this.hud(`move(${x}, ${y})`);
        }
        await sleep(150);
        await this.press(b.x, b.y, 'mouseReleased');
        this.hud('release()');
        if (this.rec)
            this.fire(CLICK_JS(b.x, b.y));
        return `${a.name} → ${b.name}`;
    }
    /** The element the last locate found, as a remote object — for CDP calls that take a node (file inputs). */
    async lastObject() { return (await this.cdp('Runtime.evaluate', { expression: 'window.__lantern && window.__lantern.last' })).result.objectId; }
    async locate(target) {
        const at = await this.evaluate(locateJs(target));
        if (at.error || !at.rect)
            throw new Error(at.error ?? 'could not find that');
        await sleep(150); // it was scrolled into view; locate again so the box starts where it is
        const again = await this.evaluate(locateJs(target));
        return { rect: again.rect ?? at.rect, name: at.name ?? '', scroll: again.scroll ?? at.scroll ?? { x: 0, y: 0 }, matches: at.matches };
    }
    /** What the last-located element is, for commands that need a field. */
    kind() { return this.evaluate(`(() => { let el = window.__lantern && window.__lantern.last; if (!el) return null; if (el.tagName === 'LABEL' && el.control) { el = el.control; window.__lantern.last = el } return { tag: el.tagName.toLowerCase(), type: (el.getAttribute('type') || 'text').toLowerCase(), editable: !!el.isContentEditable, multiple: !!el.multiple } })()`); }
    async run(sub, rest, cwd) {
        if (sub !== 'open' && sub !== 'size' && sub !== 'status')
            await this.restoreIfBlank();
        this.navigated = false;
        const r = await this.command(sub, rest, cwd);
        // A page that navigated while being clicked or typed into has, now and then, stopped taking input afterwards (Chrome's
        // own UI taking the focus, as far as can be told). Check, rather than report success into the void.
        if (this.navigated && INPUT.has(sub) && !(await this.takesInput())) {
            this.dead = true;
            this.note('the page stopped taking input after that navigation; the browser is being restarted');
        }
        return { ...r, text: this.preface() + r.text };
    }
    /** Does a key sent to the page arrive? A Shift press changes nothing on a page. */
    async takesInput() {
        try {
            await this.evaluate(`(() => { window.__lantern_in = 0; addEventListener('keydown', (e) => { if (e.key === 'Shift') window.__lantern_in++ }, true) })()`);
            await this.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, modifiers: 8 });
            await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
            await sleep(150);
            return (await this.evaluate('window.__lantern_in')) > 0;
        }
        catch {
            return true;
        } // can't tell: assume the best
    }
    async command(sub, rest, cwd) {
        switch (sub) {
            case 'open': {
                const cur = await this.url();
                const base = /^https?:/.test(cur) ? cur : this.base;
                let url;
                try {
                    url = new URL(rest[0] ?? '/', base).toString();
                }
                catch {
                    return { ok: false, text: `open what? Give a full URL the first time — \`lantern open http://localhost:3000\` — then paths like /settings resolve against it` };
                }
                if (!hostAllowed(this.config.hosts, new URL(url).hostname))
                    return { ok: false, text: `this browser only visits this project's app (${this.config.hosts.join(', ')}), not ${new URL(url).host}` };
                await this.load(url);
                if (this.failed)
                    return { ok: false, text: /AUTH_CREDENTIALS/.test(this.failed) ? `${url} asks for a username and password (HTTP auth), which lantern can't answer at a prompt — put them in the URL: https://user:password@host/…` : `${url} did not load (${this.failed}). Is the app running there?` };
                const status = this.docStatus >= 400 ? ` (HTTP ${this.docStatus}: the server answered with an error page)` : '';
                return { ok: true, text: `at ${await this.where()}${status}\nrun \`lantern snapshot\` to see what's on it` };
            }
            case 'url': return { ok: true, text: await this.where() };
            case 'back': {
                const h = await this.cdp('Page.getNavigationHistory');
                const prev = h.entries[h.currentIndex - 1];
                if (!prev)
                    return { ok: false, text: 'nothing to go back to' };
                await this.cdp('Page.navigateToHistoryEntry', { entryId: prev.id });
                await sleep(700);
                return { ok: true, text: `at ${await this.where()}` };
            }
            case 'reload':
                await this.load(await this.url());
                return { ok: true, text: `reloaded ${await this.where()}` };
            case 'snapshot': {
                const s = await this.evaluate(SNAPSHOT_JS);
                const frames = s.lines.length ? 0 : await this.evaluate("document.querySelectorAll('frame, iframe').length");
                return { ok: true, text: [`${s.url}${s.title ? ` — ${s.title}` : ''}`, ...(s.lines.length ? s.lines : [frames ? `(the page is made of ${frames} frame${frames > 1 ? 's' : ''}, and the snapshot does not look inside frames — open a frame's own URL, or use eval)` : '(nothing to act on — the page may still be loading; try `lantern wait 1000`, or `lantern text`)']), ...(s.more ? [`… and ${s.more} more controls not listed`] : [])].join('\n') };
            }
            case 'text': {
                const t = await this.evaluate(`(() => { ${rest[0] ? `let els; try { els = [...document.querySelectorAll(${JSON.stringify(rest[0])})] } catch { return null }; if (!els.length) return null; return els.map((e) => e.innerText)` : 'return [document.body.innerText]'} })()`);
                if (t === null)
                    return { ok: false, text: `no element matches ${rest[0]}` };
                const text = t.map((x) => x.replace(/\n{3,}/g, '\n\n').trim()).join(t.length > 1 ? '\n---\n' : '');
                const head = t.length > 1 ? `(${t.length} elements match; each is separated by ---)\n` : '';
                return { ok: true, text: head + (text.length > 8000 ? `${text.slice(0, 8000)}\n… (${text.length - 8000} more characters; pass a selector to read one part)` : text || '(no text)') };
            }
            case 'click': {
                if (!rest[0])
                    return { ok: false, text: 'click what? a ref from the snapshot (e12), text=Label, or a CSS selector' };
                const before = await this.url();
                this.popups.length = 0;
                this.downloads.length = 0;
                const at = await this.click(rest.join(' '));
                await sleep(500);
                await this.settle();
                if (this.pending.size)
                    for (let i = 0; i < 100 && this.pending.size; i++)
                        await sleep(200); // a download in flight: give it 20s
                const got = this.downloads.length ? `\ndownloaded ${this.downloads.map((d) => d).join(', ')}` : '';
                const tabs = this.popups.length ? `\nit asked to open a new tab: ${this.popups[0]} (opened here instead${this.popups.length > 1 ? `; and ${this.popups.length - 1} more, not followed` : ''})` : '';
                const now = await this.url();
                return { ok: true, text: `clicked "${at.name}"${this.several(at)}${now !== before ? ` → now at ${await this.where()}` : ''}${tabs}${got}` };
            }
            case 'fill': {
                if (rest.length < 2)
                    return { ok: false, text: 'usage: lantern fill <target> <text>' };
                const at = await this.spot(rest[0]);
                const k = await this.kind();
                const field = k && (k.tag === 'input' ? !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'hidden'].includes(k.type) : k.tag === 'textarea' || k.editable || k.tag === 'select');
                if (!field)
                    return { ok: false, text: `"${at.name}" is not a field you can type into (${k?.tag ?? 'nothing'}${k?.type && k.tag === 'input' ? ` type=${k.type}` : ''}) — \`click\` it, or \`select\`/\`check\` it` };
                if (k.tag === 'select')
                    return { ok: false, text: `"${at.name}" is a <select>: use \`lantern select ${rest[0]} <option>\`` };
                const text = rest.slice(1).join(' ');
                // A date, a colour, a slider: a person uses the picker; typing does nothing. Set it the way the picker would.
                if (k.tag === 'input' && PICKED.has(k.type)) {
                    await this.moveMouse(at.x, at.y, { settle: 150 });
                    const r = await this.evaluate(`(() => { const el = window.__lantern.last; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return { ok: el.value === ${JSON.stringify(text)}, value: el.value } })()`);
                    return r.ok ? { ok: true, text: `set "${at.name}" to ${text}` } : { ok: false, text: `"${at.name}" (${k.type}) would not take ${JSON.stringify(text)}: it holds ${JSON.stringify(r.value)} — give it the form the input wants (a date as 2026-01-15, a colour as #ff0000, a number within the range)` };
                }
                await this.click(rest[0]);
                await this.kind(); // a label was clicked: aim the checks below at its field
                if (!(await this.evaluate(FOCUS_JS)))
                    return { ok: false, text: `"${at.name}" did not take focus — is it a field?` };
                // Replace, as the help says: select what's there (a person would) and type over it.
                await this.evaluate(`(() => { const el = window.__lantern.last; if (el && el.select) el.select(); else if (el && el.isContentEditable) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r) } })()`);
                await this.typeText(text);
                // Did it stick? A page that moves focus while you type scatters the text; say so rather than "filled".
                const after = await this.evaluate(`(() => { const el = window.__lantern.last; const a = el.getRootNode().activeElement || document.activeElement; const held = a === el || el.contains(a); const value = 'value' in el ? String(el.value) : el.innerText; return { held, value: value.slice(0, 80), where: a ? a.tagName.toLowerCase() + (a.id ? '#' + a.id : '') : 'nothing' } })()`);
                if (!after.held)
                    return { ok: false, text: `typed into "${at.name}" but focus moved to ${after.where} part way through; it now holds ${JSON.stringify(after.value)}` };
                return { ok: true, text: `filled "${at.name}"${this.several(at)}` };
            }
            case 'press': {
                // cmd+a, shift+Tab, ctrl+Enter, cmd++: the modifiers are a bitmask to CDP, and a modified key sends no text.
                const spec = rest[0] ?? '';
                const parts = spec.endsWith('+') && spec.length > 1 ? [...spec.slice(0, -1).split('+').filter(Boolean), '+'] : spec.split('+');
                let k = parts.pop() ?? '';
                if (NAMED[k])
                    k = NAMED[k];
                const modifiers = parts.reduce((m, x) => m | (MODS[x.toLowerCase()] ?? 0), 0);
                if (parts.some((x) => !MODS[x.toLowerCase()]))
                    return { ok: false, text: `unknown modifier in ${spec}: use cmd, ctrl, alt, shift` };
                const def = KEYS[k] ?? (k.length === 1 ? { key: k, code: /^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : /^[0-9]$/.test(k) ? `Digit${k}` : CODES[k] ?? '', vk: /^[a-z0-9]$/i.test(k) ? k.toUpperCase().charCodeAt(0) : 0, text: k } : null);
                if (!def)
                    return { ok: false, text: `unknown key ${k}. Known: ${Object.keys(KEYS).join(', ')}, ${Object.keys(NAMED).join(', ')}, or a single character (cmd++ for the plus key)` };
                const text = modifiers & ~8 ? undefined : def.text;
                await this.cdp('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: def.key, code: def.code, windowsVirtualKeyCode: def.vk, nativeVirtualKeyCode: def.vk, text, modifiers, commands: modifiers & 4 && k.length === 1 ? [{ a: 'selectAll', c: 'copy', v: 'paste', x: 'cut', z: 'undo' }[k.toLowerCase()]].filter(Boolean) : undefined });
                await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: def.key, code: def.code, windowsVirtualKeyCode: def.vk, nativeVirtualKeyCode: def.vk, modifiers });
                this.hud(`key(${JSON.stringify([...parts.map((x) => KEY_GLYPH[x.toLowerCase()] ?? x), KEY_GLYPH[k] ?? k])})`);
                await sleep(this.rec ? 700 : 300);
                await this.settle();
                return { ok: true, text: `pressed ${spec}` };
            }
            case 'rightclick': {
                if (!rest[0])
                    return { ok: false, text: 'rightclick what? a ref, text=Label, a selector, or x,y' };
                const at = await this.click(rest.join(' '), 1, 'right');
                await sleep(300);
                return { ok: true, text: `right-clicked "${at.name}" — snapshot to see the menu` };
            }
            case 'dblclick': {
                if (!rest[0])
                    return { ok: false, text: 'dblclick what? a ref, text=Label, a selector, or x,y' };
                const at = await this.click(rest.join(' '), 2);
                await sleep(300);
                return { ok: true, text: `double-clicked "${at.name}"` };
            }
            case 'highlight': {
                if (!rest[0])
                    return { ok: false, text: 'highlight what? a ref, text=Label, a selector — or off' };
                if (rest[0] === 'off') {
                    this.hl = false;
                    await this.evaluate(HIGHLIGHT_JS(false)).catch(() => { });
                    return { ok: true, text: 'highlight off' };
                }
                const { rect: r, name, matches } = await this.locate(rest.join(' '));
                await this.evaluate(HIGHLIGHT_JS(true)).catch(() => { });
                this.hl = true;
                // The pointer rests where it last clicked — often on the very thing being shown. Step it out of the box.
                const c = this.at;
                if (c && c.x >= r.x - 12 && c.x <= r.x + r.width + 12 && c.y >= r.y - 12 && c.y <= r.y + r.height + 12) {
                    const [w, h] = this.size;
                    const x = r.x + r.width + 48 <= w ? r.x + r.width + 48 : Math.max(12, r.x - 48), y = Math.min(h - 12, r.y + r.height + 36);
                    await this.moveMouse(x, y, { settle: 300 });
                }
                return { ok: true, text: `highlighting "${name}"${this.several({ x: 0, y: 0, name, matches })} — it glows in screenshots and the recording, follows the element and goes when it does; \`lantern highlight off\` ends it` };
            }
            case 'hover': {
                if (!rest[0])
                    return { ok: false, text: 'hover what? a ref, text=Label, a selector, or x,y' };
                const at = await this.spot(rest.join(' '));
                await this.moveMouse(at.x, at.y, { settle: 400 });
                return { ok: true, text: `hovering over "${at.name}"${this.several(at)} — snapshot to see what that revealed` };
            }
            case 'drag': {
                if (rest.length < 2)
                    return { ok: false, text: 'usage: lantern drag <from> <to> — each a ref, text=Label, a selector, or x,y' };
                const name = await this.drag(rest[0], rest.slice(1).join(' '));
                await sleep(300);
                return { ok: true, text: `dragged ${name}` };
            }
            case 'scroll': {
                const dir = rest[0];
                if (dir === 'to' && rest[1]) {
                    const at = await this.spot(rest.slice(1).join(' '), true, true);
                    await this.moveMouse(at.x, at.y, { settle: 150 });
                    return { ok: true, text: `scrolled "${at.name}" into view${this.several(at)}` };
                }
                const d = { down: [0, 1], up: [0, -1], right: [1, 0], left: [-1, 0] }[dir ?? ''];
                if (!d)
                    return { ok: false, text: 'usage: lantern scroll <down|up|left|right> [px] [at <target>], or scroll to <target>' };
                if (rest[1] && rest[1] !== 'at' && !/^\d+$/.test(rest[1]))
                    return { ok: false, text: `scroll how far? ${rest[1]} is not a number of pixels` };
                const px = /^\d+$/.test(rest[1] ?? '') ? Number(rest[1]) : 500;
                const atIdx = rest.indexOf('at');
                const [cw, ch] = this.size;
                const at = atIdx >= 0 && rest[atIdx + 1] ? await this.spot(rest.slice(atIdx + 1).join(' '), true, true) : { x: cw / 2, y: ch / 2, name: 'the page' };
                await this.moveMouse(at.x, at.y, { settle: 120 });
                // A wheel, not a jump: the distance goes in ticks that ease out, so the page scrolls as it does under a finger.
                this.hud(`wheel(${at.x}, ${at.y}, ${JSON.stringify(dir)})`);
                const ticks = this.rec ? 14 : 4;
                let done = 0;
                for (let i = 1; i <= ticks; i++) {
                    const t = i / ticks, target = Math.round(px * (1 - Math.pow(1 - t, 3))), step = target - done;
                    done = target;
                    if (step)
                        await this.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: d[0] * step, deltaY: d[1] * step });
                    await sleep(this.rec ? 32 : 10);
                }
                await sleep(this.rec ? 400 : 200);
                return { ok: true, text: `scrolled ${dir} ${px}px over ${at.name}` };
            }
            case 'type': {
                if (!rest.length)
                    return { ok: false, text: 'type what?' };
                const focus = await this.evaluate(`(() => { const a = document.activeElement; return !a || a === document.body ? '' : a.tagName.toLowerCase() + (a.id ? '#' + a.id : '') })()`);
                await this.typeText(rest.join(' '));
                await sleep(150);
                return { ok: true, text: `typed ${rest.join(' ').length} characters into ${focus ? focus : 'the page (nothing had focus — click a field first if the text was meant for one)'}` };
            }
            case 'select': {
                if (rest.length < 2)
                    return { ok: false, text: 'usage: lantern select <target> <option text or value> — several options for a multi-select, each quoted' };
                const at = await this.spot(rest[0]);
                await this.moveMouse(at.x, at.y, { settle: 150 });
                const wants = rest.slice(1);
                const r = await this.evaluate(`(() => { const el = window.__lantern && window.__lantern.last; if (!el || el.tagName !== 'SELECT') return { error: 'not a <select>' }; const wants = ${JSON.stringify(wants)}; const find = (want) => [...el.options].find((o) => o.text.trim() === want || o.value === want) || [...el.options].find((o) => o.text.trim().toLowerCase().includes(want.toLowerCase())); if (!el.multiple) { const o = find(wants.join(' ')); if (!o) return { error: 'no such option', options: [...el.options].map((o) => o.text.trim()) }; el.value = o.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return { ok: true, chosen: [o.text.trim()] } } const found = wants.map(find); const missing = wants.filter((w, i) => !found[i]); if (missing.length) return { error: 'no such option: ' + missing.join(', '), options: [...el.options].map((o) => o.text.trim()) }; for (const o of el.options) o.selected = found.includes(o); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return { ok: true, chosen: found.map((o) => o.text.trim()), multiple: true } })()`);
                if (r.error)
                    return { ok: false, text: r.options ? `${r.error} — the options are: ${r.options.join(' · ')}` : `"${at.name}" is ${r.error}; for a custom dropdown, click it and then click the option` };
                return { ok: true, text: `chose ${r.chosen.map((c) => `"${c}"`).join(', ')} in "${at.name}"${r.multiple ? ' (a multi-select: those and only those are selected now)' : ''}` };
            }
            case 'check':
            case 'uncheck': {
                if (!rest[0])
                    return { ok: false, text: `${sub} what? a ref, text=Label, or a selector` };
                const at = await this.spot(rest.join(' '));
                const STATE = `(() => { const el = window.__lantern && window.__lantern.last; if (!el) return { error: 'gone' }; const box = el.matches('input[type=checkbox],input[type=radio],[role=checkbox],[role=switch],[role=radio]') ? el : el.querySelector('input[type=checkbox],input[type=radio]'); if (!box) return { error: 'not a checkbox' }; return { checked: 'checked' in box ? box.checked : box.getAttribute('aria-checked') === 'true' } })()`;
                const state = await this.evaluate(STATE);
                if (state.error)
                    return { ok: false, text: `"${at.name}" is ${state.error}` };
                const want = sub === 'check';
                if (state.checked === want)
                    return { ok: true, text: `"${at.name}" was already ${want ? 'checked' : 'unchecked'}` };
                await this.click(rest.join(' '));
                await sleep(200);
                const after = await this.evaluate(STATE);
                if (after.checked !== want)
                    return { ok: false, text: `clicked "${at.name}" but it is still ${want ? 'unchecked' : 'checked'} — the page may not have let it change` };
                return { ok: true, text: `${want ? 'checked' : 'unchecked'} "${at.name}"` };
            }
            case 'upload': {
                if (rest.length < 2)
                    return { ok: false, text: 'usage: lantern upload <target> <file…> — a file input, or the button that opens one' };
                const files = rest.slice(1).map((f) => path.resolve(cwd, f));
                for (const f of files) {
                    if (!fs.existsSync(f))
                        return { ok: false, text: `no such file: ${f}` };
                    if (!fs.statSync(f).isFile())
                        return { ok: false, text: `not a file: ${f}` };
                }
                const at = await this.spot(rest[0], true, true);
                await this.moveMouse(at.x, at.y, { settle: 150 });
                // The file input itself, or the nearest one to what was pointed at (an "Upload" button usually fronts a hidden input).
                const found = await this.evaluate(`(() => { const el = window.__lantern && window.__lantern.last; if (!el) return false; const input = el.matches('input[type=file]') ? el : el.querySelector('input[type=file]') || (el.closest('label') && el.closest('label').querySelector('input[type=file]')) || (el.parentElement && el.parentElement.querySelector('input[type=file]')) || (el.closest('form') && el.closest('form').querySelector('input[type=file]')); if (!input) return false; window.__lantern.last = input; return true })()`);
                if (!found)
                    return { ok: false, text: `no file input at or near "${at.name}"` };
                const objectId = await this.lastObject();
                if (!objectId)
                    return { ok: false, text: 'could not reach the file input' };
                await this.cdp('DOM.setFileInputFiles', { files, objectId });
                await sleep(400);
                return { ok: true, text: `put ${files.length === 1 ? path.basename(files[0]) : `${files.length} files`} in the file input at "${at.name}"` };
            }
            case 'get': {
                const what = rest[0], target = rest.slice(what === 'attr' ? 2 : 1).join(' ');
                if (!what || !target)
                    return { ok: false, text: 'usage: lantern get text|value|attr <name>|count|box <target>' };
                if (what === 'count') {
                    if (target.startsWith('text=')) {
                        const want = target.slice(5).replace(/\s+/g, ' ').trim().toLowerCase();
                        const n = await this.evaluate(`(() => { const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase(); const hits = [...document.body.querySelectorAll('*')].filter((e) => clean(e.innerText) === ${JSON.stringify(want)}); return hits.filter((e) => !hits.some((o) => o !== e && e.contains(o))).length })()`);
                        return { ok: true, text: String(n) };
                    }
                    const n = await this.evaluate(`(() => { try { return document.querySelectorAll(${JSON.stringify(target)}).length } catch { return null } })()`);
                    return n === null ? { ok: false, text: `${target} is not a selector` } : { ok: true, text: String(n) };
                }
                const at = await this.spot(target, false); // a read: the page is left where it is
                if (what === 'box')
                    return { ok: true, text: at.rect ? `${Math.round(at.rect.x)},${Math.round(at.rect.y)} ${Math.round(at.rect.width)}×${Math.round(at.rect.height)} (in the viewport; page scrolled ${Math.round(at.scroll?.x ?? 0)},${Math.round(at.scroll?.y ?? 0)})` : `${at.x},${at.y}` };
                const v = await this.evaluate(`(() => { const el = window.__lantern && window.__lantern.last; if (!el) return null; ${what === 'text' ? 'return el.innerText' : what === 'value' ? "return 'value' in el ? String(el.value) : null" : what === 'attr' ? `return el.getAttribute(${JSON.stringify(rest[1] ?? '')})` : 'return null'} })()`);
                return v === null ? { ok: false, text: `"${at.name}" has no ${what}${what === 'attr' ? ` ${rest[1]}` : ''}` } : { ok: true, text: v };
            }
            case 'is': {
                const what = rest[0], target = rest.slice(1).join(' ');
                if (!['visible', 'enabled', 'checked'].includes(what ?? '') || !target)
                    return { ok: false, text: 'usage: lantern is visible|enabled|checked <target>' };
                let at;
                try {
                    at = await this.spot(target, false);
                }
                catch (e) {
                    return what === 'visible' ? { ok: true, text: 'no' } : { ok: false, text: String(e.message) };
                }
                const v = await this.evaluate(`(() => { const el = window.__lantern && window.__lantern.last; if (!el) return false; ${what === 'visible' ? "const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'" : what === 'enabled' ? "return !el.disabled && el.getAttribute('aria-disabled') !== 'true'" : "return 'checked' in el ? !!el.checked : el.getAttribute('aria-checked') === 'true'"} })()`);
                return { ok: true, text: `${v ? 'yes' : 'no'} — "${at.name}" is ${v ? '' : 'not '}${what}` };
            }
            case 'wait': {
                const a = rest.join(' ');
                if (/^\d+$/.test(a)) {
                    const ms = Math.min(Number(a), 30_000);
                    await sleep(ms);
                    return { ok: true, text: `waited ${ms}ms${ms < Number(a) ? ' (the most one wait can be)' : ''}` };
                }
                for (let i = 0; i < 40; i++) {
                    if (await this.evaluate(`document.body.innerText.includes(${JSON.stringify(a)})`))
                        return { ok: true, text: `"${a}" is on the page` };
                    await sleep(250);
                }
                return { ok: false, text: `"${a}" did not appear within 10s` };
            }
            case 'eval': {
                if (!rest.length)
                    return { ok: false, text: 'usage: lantern eval <javascript>' };
                const v = await this.evaluate(rest.join(' '));
                const out = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
                return { ok: true, text: (out ?? 'undefined').slice(0, 8000) };
            }
            case 'size': {
                const a = rest[0];
                if (!a) {
                    const [w, h] = this.size;
                    return { ok: true, text: `${w}×${h} — presets: ${Object.entries(PRESETS).map(([k, [w2, h2]]) => `${k} ${w2}×${h2}`).join(', ')}, or WxH` };
                }
                const m = /^(\d{2,4})[x×](\d{2,4})$/.exec(a);
                const sz = PRESETS[a] ?? (m ? [Number(m[1]), Number(m[2])] : null);
                if (!sz || sz[0] < 100 || sz[1] < 100)
                    return { ok: false, text: `size what? a preset (${Object.keys(PRESETS).join(', ')}), or WxH like 1440x900 (at least 100 each way)` };
                if (this.rec)
                    return { ok: false, text: 'the size is fixed while recording — set it before `lantern record start`' };
                this.fixed = true;
                await this.setSize(sz[0], sz[1]);
                await sleep(400);
                return { ok: true, text: `${sz[0]}×${sz[1]}` };
            }
            case '_cdp': { // for debugging lantern itself: a raw protocol call on the page (Target.* goes to the browser)
                const [method, json] = [rest[0], rest.slice(1).join(' ')];
                const params = json ? JSON.parse(json) : {};
                const r = method.startsWith('Target.') ? await this.chrome.send(method, { targetId: this.targetId, ...params }) : await this.cdp(method, params);
                return { ok: true, text: JSON.stringify(r ?? null).slice(0, 4000) };
            }
            case 'record': return this.record(rest);
            case 'screenshot': return this.screenshot(rest);
            case 'console': {
                const out = this.log.slice(-60).join('\n') || '(no warnings, errors, failed requests or dialogs since the page was opened)';
                if (rest[0] === '--clear')
                    this.log.length = 0;
                return { ok: true, text: out };
            }
            default: return { ok: false, text: `unknown: lantern ${sub}\n\n${USAGE}` };
        }
    }
    async record(rest) {
        const what = rest[0];
        if (what === 'start') {
            if (this.rec)
                return { ok: false, text: `already recording (${this.rec.frames.length} frames so far) — \`lantern record stop\` first` };
            const dir = path.join(this.outDir, `rec-${stamp()}`);
            fs.mkdirSync(dir, { recursive: true });
            const [rw, rh] = this.fixed ? this.size : [REC_W, REC_H];
            await this.setSize(rw, rh);
            await sleep(400); // let the page lay out at that size before the first frame
            this.rec = { dir, frames: [], marks: [], wrote: 0, until: Infinity };
            // The opening frame, before anything happens; then every frame the page paints.
            const first = await this.cdp('Page.captureScreenshot', { format: 'jpeg', quality: 82 }, 15_000).catch(() => null);
            if (first) {
                const file = path.join(dir, 'f-00000.jpg');
                this.rec.frames.push({ file, t: Date.now() });
                this.rec.wrote = Date.now();
                fs.writeFileSync(file, Buffer.from(first.data, 'base64'));
            }
            await this.wantFrames();
            return { ok: true, text: `recording at ${rw}×${rh} (the video comes out ${Math.min(1920, rw * SCALE)} pixels wide) — do the steps, set captions with \`lantern record caption <text>\`, then \`lantern record stop\`` };
        }
        if (what === 'caption') {
            if (!this.rec)
                return { ok: false, text: 'not recording — `lantern record start` first' };
            const text = rest.slice(1).join(' ');
            this.rec.caption = text === 'off' ? undefined : text;
            this.rec.marks.push(Date.now());
            await this.evaluate(CAPTION_JS(this.rec.caption ?? '')).catch(() => { });
            return { ok: true, text: this.rec.caption ? `caption: ${this.rec.caption}` : 'caption off' };
        }
        if (what === 'stop') {
            const r = this.rec;
            if (!r)
                return { ok: false, text: 'not recording' };
            this.rec = undefined;
            this.hl = false;
            await this.evaluate(CAPTION_JS('') + ';' + HIGHLIGHT_JS(false)).catch(() => { });
            await this.doneWithFrames();
            await sleep(200); // the last frames are still being written
            // Nothing happened: only the opening frame, or a couple of screencast frames that are all the same picture.
            const cast = r.frames.slice(1);
            const same = cast.length <= 2 && cast.every((f) => { try {
                return fs.readFileSync(f.file).equals(fs.readFileSync(cast[0].file));
            }
            catch {
                return false;
            } });
            if (r.frames.length < 2 || same) {
                fs.rmSync(r.dir, { recursive: true, force: true });
                return { ok: false, text: 'nothing was recorded: the page never changed while recording' };
            }
            // Each frame shows until the next; a long gap (the agent thinking) is cut to a beat, so the clip is the interactions, not the waiting.
            const GAP = 1.2, MIN = 0.08, HOLD = 2.5;
            const durs = r.frames.map((f, i) => { const next = r.frames[i + 1]; return next ? Math.max(MIN, Math.min(GAP, (next.t - f.t) / 1000)) : 1.5; });
            // Every caption stays up for at least HOLD seconds: an agent that sets one and acts in the same breath leaves
            // nothing readable. The segment keeps its pace; its last frame holds for whatever time is missing.
            const bounds = [...r.marks, Infinity];
            for (let m = 0; m + 1 < bounds.length; m++) {
                const idx = r.frames.map((f, i) => (f.t >= bounds[m] && f.t < bounds[m + 1] ? i : -1)).filter((i) => i >= 0);
                if (!idx.length)
                    continue;
                const have = idx.reduce((n, i) => n + durs[i], 0);
                if (have < HOLD)
                    durs[idx[idx.length - 1]] += HOLD - have;
            }
            const secs = durs.reduce((n, d) => n + d, 0);
            const base = path.join(this.outDir, `demo-${path.basename(r.dir).slice(4)}`);
            let out, how = '';
            if (await hasFfmpeg()) {
                const list = r.frames.map((f, i) => `file '${f.file.replace(/'/g, "'\\''")}'\nduration ${durs[i].toFixed(3)}`).join('\n') + `\nfile '${r.frames[r.frames.length - 1].file}'\n`;
                const listFile = path.join(r.dir, 'list.txt');
                fs.writeFileSync(listFile, list);
                out = `${base}.mp4`;
                const log = await tryOut(ffmpegBin(), ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', "scale='min(1920,iw)':-2,format=yuv420p", '-r', '30', '-movflags', '+faststart', out]);
                if (!fs.existsSync(out))
                    return { ok: false, text: `ffmpeg could not assemble the video${log ? `: ${log.slice(-300)}` : ''} (frames kept in ${r.dir})` };
            }
            else {
                // No ffmpeg: Chrome encodes it, in real time — as long as the clip is.
                try {
                    const enc = await encodeInChrome(this.chrome, r.frames.map((f) => f.file), durs, base);
                    out = enc.file;
                    how = `; encoded by Chrome as ${enc.mime.split(';')[0]} since ffmpeg is not installed — \`brew install ffmpeg\` for faster, smaller MP4s`;
                }
                catch (e) {
                    return { ok: false, text: `could not assemble the video without ffmpeg: ${e.message} (frames kept in ${r.dir}; brew install ffmpeg, or set LANTERN_FFMPEG)` };
                }
            }
            fs.rmSync(r.dir, { recursive: true, force: true });
            return { ok: true, text: `${out}\n(${Math.round(secs)}s of video from ${r.frames.length} captured changes${how})` };
        }
        return { ok: false, text: 'usage: lantern record start | caption <text> | stop' };
    }
    async screenshot(rest) {
        // Of the page, of one element (a ref, text=Label, or a selector — with a little room around it), or of a
        // region given as x,y,w,h in viewport pixels. A reviewer should see the part that matters, not the whole window.
        let clip;
        let what = '';
        const full = rest.includes('--full');
        if (full)
            rest.splice(rest.indexOf('--full'), 1);
        const crop = rest.includes('--crop');
        if (crop)
            rest.splice(rest.indexOf('--crop'), 1);
        const region = /^(\d+),(\d+),(\d+),(\d+)$/.exec(rest[0] ?? '');
        let lit = false; // a target without --crop: the whole viewport, the size under test, with the target glowing
        // Chrome's clip is in page coordinates (from the top of the document), while rects and regions are in the viewport.
        const scrolled = await this.evaluate('({ x: scrollX, y: scrollY })');
        if (region) {
            clip = { x: +region[1] + scrolled.x, y: +region[2] + scrolled.y, width: +region[3], height: +region[4] };
            what = ` — the region ${rest[0]}`;
        }
        else if (rest[0] && !crop) {
            const { name, matches } = await this.locate(rest.join(' '));
            await this.evaluate(HIGHLIGHT_JS(true)).catch(() => { });
            await sleep(120);
            lit = true;
            what = ` — "${name}" highlighted${this.several({ x: 0, y: 0, name, matches })}`;
        }
        else if (rest[0]) {
            const { rect: r, name, scroll, matches } = await this.locate(rest.join(' '));
            const [cw, ch] = this.size, pad = 12;
            clip = { x: Math.max(0, Math.floor(r.x - pad)) + scroll.x, y: Math.max(0, Math.floor(r.y - pad)) + scroll.y, width: Math.min(cw, Math.ceil(r.width + pad * 2)), height: Math.min(ch, Math.ceil(r.height + pad * 2)) };
            what = ` — "${name}"${this.several({ x: 0, y: 0, name, matches })}`;
        }
        // --full: the whole page, however long or wide (up to 8000px each way).
        if (full && !clip) {
            const d = await this.evaluate('({ w: Math.min(document.documentElement.scrollWidth, 8000), h: Math.min(document.documentElement.scrollHeight, 8000) })');
            clip = { x: 0, y: 0, width: Math.max(d.w, this.size[0]), height: Math.max(d.h, this.size[1]) };
            what = ' — the whole page';
        }
        await this.evaluate(FX_JS(true)).catch(() => { });
        await sleep(60); // the pointer and any click/key effects stay out of the picture
        const shot = await this.cdp('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}), captureBeyondViewport: !!(full && !region) }, 20_000).catch(() => null);
        this.fire(FX_JS(false));
        if (this.at)
            void this.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: this.at.x, y: this.at.y }).catch(() => { }); // the picture must not end a hover
        if (lit && !this.hl)
            this.fire(HIGHLIGHT_JS(false)); // only for the picture, unless `highlight` set it
        if (!shot)
            return { ok: false, text: 'the page gave no picture (it may still be loading — try again)' };
        const buf = Buffer.from(shot.data, 'base64'), { w, h } = pngSize(buf);
        if (crop && h > w * 1.5)
            what += ' — a tall crop; for a PR picture, `screenshot <target>` without --crop gives the page with it highlighted';
        fs.mkdirSync(this.outDir, { recursive: true });
        // Keep the last 20 screenshots (only screenshots: framed pictures and videos live here too).
        for (const old of fs.readdirSync(this.outDir).filter((f) => f.startsWith('shot-') && f.endsWith('.png')).sort().slice(0, -19))
            fs.rmSync(path.join(this.outDir, old), { force: true });
        const file = path.join(this.outDir, `shot-${stamp()}.png`);
        fs.writeFileSync(file, buf);
        return { ok: true, text: `${file}\n(${w}×${h} of ${await this.where()}${what} — read the file to look at it)` };
    }
}

// The lantern daemon: one per project, started by the first `lantern` command and gone again after half an hour
// idle. It owns the Chrome and the page, so the page lives on between an agent's commands — however long the
// agent thinks in between. A unix socket under ~/.lantern: one JSON line in, one out. Only this user can reach it.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { findChrome, launchChrome, NO_CHROME } from './chrome.js';
import { frame } from './frame.js';
import { Page, SETTLE } from './page.js';
import { paths } from './paths.js';
import { readConfig } from './config.js';
const root = process.argv[2];
if (!root) {
    console.error('usage: daemon.ts <project root>');
    process.exit(2);
}
const P = paths(root);
const CONFIG = readConfig(root);
const IDLE = 30 * 60_000;
/** Commands whose outcome a watcher is told about, in words. */
const ACTS = new Set(['open', 'click', 'dblclick', 'rightclick', 'hover', 'highlight', 'drag', 'scroll', 'fill', 'type', 'press', 'select', 'check', 'uncheck', 'upload', 'back', 'reload', 'wait']);
let chrome;
let page;
let used = Date.now();
let queue = Promise.resolve();
let server;
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(stamp(), ...a);
let stopping;
let owned = false; // the socket and pid file are ours to remove only once we have written them
/** Stop taking commands, close Chrome and wait for it to let go of the profile, so the next daemon can start at once. */
function stop(why) {
    if (stopping)
        return stopping;
    log('shutting down:', why);
    try {
        server?.close();
    }
    catch { }
    try {
        preview?.close();
    }
    catch { }
    try {
        if (owned) {
            fs.rmSync(P.sock, { force: true });
            fs.rmSync(P.pid, { force: true });
        }
    }
    catch { }
    stopping = (async () => {
        // Keep the login: cookies go to the profile folder (readable by this user only) and come back next start.
        if (page) {
            try {
                fs.writeFileSync(path.join(P.profile, 'cookies.json'), JSON.stringify(await page.cookiesOut()), { mode: 0o600 });
            }
            catch (e) {
                log('could not save cookies:', e.message);
            }
        }
    })().then(() => new Promise((done) => {
        const c = chrome;
        if (!c || c.proc.exitCode !== null)
            return done();
        const t = setTimeout(() => { try {
            c.proc.kill('SIGKILL');
        }
        catch { } ; done(); }, 5000);
        c.proc.once('exit', () => { clearTimeout(t); done(); });
        c.kill();
    }));
    return stopping;
}
function shutdown(why) { void stop(why).then(() => setTimeout(() => process.exit(0), 100)); }
async function dispatch(req) {
    switch (req.cmd) {
        case 'status': return { ok: true, text: `lantern is up for ${root}\n  pid ${process.pid}, chrome pid ${chrome?.proc.pid}, log ${P.log}\n  ${page ? `page at ${await page.where()}${page.rec ? ` (recording, ${page.rec.frames.length} frames)` : ''}` : 'no page open yet'}` };
        case 'close':
            await stop('asked to close');
            setTimeout(() => process.exit(0), 100);
            return { ok: true, text: 'closed' };
        case 'frame': return frame(chrome, { note: CONFIG.note, ...req }, P.out);
        case 'preview': {
            const url = await previewUrl();
            return { ok: true, text: url };
        }
        case 'browser': {
            const p = await thePage();
            const args = req.args ?? [];
            if (p.rec)
                p.rec.until = Infinity; // frames are kept while a command runs…
            try {
                const r = await p.run(args[0], args.slice(1), req.cwd ?? root);
                if (r.ok && ACTS.has(args[0]))
                    p.did(r.text.split('\n')[0].slice(0, 90));
                if (p.dead && !p.rec) {
                    const note = await relaunch();
                    return { ...r, text: note + r.text };
                }
                return r;
            }
            finally {
                if (p.rec)
                    p.rec.until = Date.now() + SETTLE;
            } // …and for a beat after, while the page settles
        }
        default: return { ok: false, text: `lantern does not know that request (${req.cmd})` };
    }
}
async function thePage() { return (page ??= await Page.open(chrome, P.out, path.join(P.profile, 'lantern.json'), CONFIG)); }
/** A new Chrome in place of one whose page stopped taking input: cookies carried over, the page opened again. */
async function relaunch() {
    const old = chrome, p = page;
    let cookies = [];
    try {
        cookies = await p.cookiesOut();
    }
    catch { }
    try {
        fs.writeFileSync(path.join(P.profile, 'cookies.json'), JSON.stringify(cookies), { mode: 0o600 });
    }
    catch { }
    page = undefined;
    await new Promise((done) => { const t = setTimeout(() => { try {
        old.proc.kill('SIGKILL');
    }
    catch { } ; done(); }, 5000); old.proc.once('exit', () => { clearTimeout(t); done(); }); old.kill(); });
    chrome = launchChrome(findChrome(), P.profile);
    chrome.proc.on('exit', (code) => { if (!stopping)
        shutdown(`chrome exited (${code})`); });
    await chrome.send('Browser.getVersion', {}, undefined, 30_000);
    const fresh = await thePage();
    const url = p.lastUrl;
    if (url) {
        await fresh.load(url);
    }
    log('restarted chrome: the page had stopped taking input');
    return `(the page stopped taking input after that navigation, so lantern restarted its browser${url ? ` and opened ${url} again` : ''}; the step above was done, the next one is safe)\n`;
}
/** A watcher over the socket (forest's panel, say): JSON lines — {frame, url} as the page paints, {did} as commands land. */
async function watch(conn) {
    const p = await thePage();
    const w = { frame: (jpeg, url) => { if (!conn.destroyed)
            conn.write(JSON.stringify({ frame: jpeg.toString('base64'), url }) + '\n'); }, did: (text) => { if (!conn.destroyed)
            conn.write(JSON.stringify({ did: text }) + '\n'); } };
    p.watchers.add(w);
    await p.wantFrames();
    if (p.lastFrame)
        w.frame(p.lastFrame, p.currentUrl);
    conn.on('close', () => { p.watchers.delete(w); void p.doneWithFrames(); });
    conn.on('error', () => { });
}
// A live view in any browser: `lantern watch` prints this page's URL. Frames arrive as a motion-JPEG stream, the
// line under the picture says what the agent just did. Only on this machine (127.0.0.1), only while the daemon lives.
let preview;
function previewUrl() {
    if (preview)
        return Promise.resolve(`http://127.0.0.1:${preview.address().port}/`);
    preview = http.createServer(async (req, res) => {
        const p = await thePage();
        if (req.url === '/stream') {
            res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
            const send = (jpeg) => { if (!res.destroyed)
                res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`), res.write(jpeg), res.write('\r\n'); };
            const w = { frame: send };
            p.watchers.add(w);
            await p.wantFrames();
            if (p.lastFrame)
                send(p.lastFrame);
            req.on('close', () => { p.watchers.delete(w); void p.doneWithFrames(); });
        }
        else if (req.url === '/events') {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
            const w = { did: (text) => { if (!res.destroyed)
                    res.write(`data: ${JSON.stringify({ did: text, url: p.currentUrl })}\n\n`); }, frame: (_j, url) => { if (!res.destroyed)
                    res.write(`data: ${JSON.stringify({ url })}\n\n`); } };
            p.watchers.add(w);
            res.write(`data: ${JSON.stringify({ url: p.currentUrl })}\n\n`);
            req.on('close', () => { p.watchers.delete(w); });
        }
        else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!doctype html><meta charset="utf-8"><title>lantern · ${root.split('/').pop()}</title>
<style>html,body{margin:0;height:100%;background:#16161a;color:#e8e8ee;font:13px -apple-system,system-ui,sans-serif}body{display:flex;flex-direction:column}img{flex:1;min-height:0;object-fit:contain;background:#000}#bar{display:flex;gap:16px;align-items:center;padding:8px 14px;border-top:1px solid #2a2a30}#dot{width:8px;height:8px;border-radius:50%;background:#ff7a2f;box-shadow:0 0 10px rgba(255,122,47,.8)}#did{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#url{color:#8a8a95;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40%}</style>
<img src="/stream" alt="the page lantern is driving"><div id="bar"><span id="dot"></span><span id="did">watching — frames arrive as the page changes</span><span id="url"></span></div>
<script>const es=new EventSource('/events');es.onmessage=(e)=>{const d=JSON.parse(e.data);if(d.did)document.getElementById('did').textContent=d.did;if(d.url)document.getElementById('url').textContent=d.url}</script>`);
        }
    });
    return new Promise((r) => preview.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${preview.address().port}/`)));
}
/** One command at a time: an agent that runs two in parallel gets them in order, never interleaved on the page. */
function handle(req) {
    used = Date.now();
    const job = () => dispatch(req).catch((e) => ({ ok: false, text: String(e?.message ?? e) }));
    const r = queue.then(job, job);
    queue = r.then(() => { }, () => { });
    return r;
}
async function main() {
    const bin = findChrome();
    if (!bin) {
        console.error(NO_CHROME);
        process.exit(1);
    }
    log('starting for', root, 'with', bin);
    chrome = launchChrome(bin, P.profile);
    chrome.proc.on('exit', (code) => { if (!stopping)
        shutdown(`chrome exited (${code})`); });
    const v = await chrome.send('Browser.getVersion', {}, undefined, 30_000);
    log('chrome is up:', v.product);
    fs.mkdirSync(path.dirname(P.sock), { recursive: true });
    try {
        fs.rmSync(P.sock, { force: true });
    }
    catch { }
    server = net.createServer((conn) => {
        let buf = '';
        conn.on('data', (d) => {
            buf += d;
            const nl = buf.indexOf('\n');
            if (nl < 0)
                return;
            const line = buf.slice(0, nl);
            buf = '';
            let req = null;
            try {
                req = JSON.parse(line);
            }
            catch { }
            const done = (r) => { try {
                conn.end(JSON.stringify(r) + '\n');
            }
            catch { } };
            if (!req)
                return done({ ok: false, text: 'lantern could not read that request' });
            if (req.cmd === 'watch') {
                used = Date.now();
                void watch(conn).catch((e) => done({ ok: false, text: String(e?.message ?? e) }));
                return;
            }
            handle(req).then(done);
        });
        conn.on('error', () => { });
    });
    server.on('error', (e) => { console.error('socket error:', e.message); shutdown('socket error'); });
    server.listen(P.sock, () => { try {
        fs.chmodSync(P.sock, 0o600);
        fs.writeFileSync(P.pid, String(process.pid));
        owned = true;
    }
    catch { } ; log('listening on', P.sock); });
    setInterval(() => { if (Date.now() - used > IDLE && !page?.rec && !page?.watchers.size)
        shutdown('idle for 30 minutes'); }, 60_000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (e) => { console.error('uncaught:', e); });
main().catch((e) => { console.error('could not start:', e); shutdown('failed to start'); });

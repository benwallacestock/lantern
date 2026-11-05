#!/usr/bin/env node
// lantern — a browser for coding agents: open the app, click around, take screenshots that are ready for a pull
// request, record a demo. Each command is a short-lived process; the page lives in a daemon (src/daemon.ts)
// that the first command starts, so the page survives between commands however long the agent thinks.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findChrome, NO_CHROME } from '../src/chrome.ts'
import { KEYS, readSettings } from '../src/config.ts'
import { runDaemon } from '../src/daemon.ts'
import { FAVICON } from '../src/frameHtml.ts'
import { buildId, cleanName, instances, paths } from '../src/paths.ts'
import { USAGE } from '../src/usage.ts'
import { installSkills, skillsStatus, updateHint, updateNow, version } from '../src/update.ts'

// This file is the whole program: the CLI, and — started by the CLI as `lantern __daemon <root>` — the daemon. It runs
// as TypeScript from a checkout (Node strips the types) and as one bundled file, dist/lantern.js, from npm.
const here = fileURLToPath(import.meta.url)

type Reply = { ok: boolean; text: string }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const die = (msg: string): never => { process.stderr.write(msg + '\n'); process.exit(1) }

const argv = process.argv.slice(2)
// `lantern --name review-2 <command>` (or LANTERN_NAME=review-2): one of several lanterns on the same project, for parallel agents.
let name = cleanName(process.env.LANTERN_NAME)
if (argv[0] === '--name' || argv[0] === '-n') { name = cleanName(argv[1]); argv.splice(0, 2) }
else if (/^--name=/.test(argv[0] ?? '')) { name = cleanName(argv[0].slice(7)); argv.shift() }
const [cmd, ...rest] = argv
if (cmd === '__daemon') { await runDaemon(rest[0], cleanName(rest[1])); await new Promise(() => {}) } // the daemon: this process stays until it stops itself
if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(USAGE); process.exit(0) }

const cwd = process.cwd()
const git = (...a: string[]) => { try { return execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return '' } }
const root = git('rev-parse', '--show-toplevel') || cwd
const P = paths(root, name)

// Pictures go in <root>/tmp/lantern. In a git repo that folder is kept out of git for you (in .git/info/exclude, so
// the repo's own .gitignore is left alone).
if (root !== cwd || git('rev-parse', '--is-inside-work-tree') === 'true') {
  const ignored = (() => { try { execFileSync('git', ['check-ignore', '-q', 'tmp/lantern'], { cwd: root, stdio: 'ignore' }); return true } catch { return false } })()
  if (!ignored) { const ex = git('rev-parse', '--git-path', 'info/exclude'); if (ex) { try { fs.mkdirSync(path.dirname(path.resolve(root, ex)), { recursive: true }); fs.appendFileSync(path.resolve(root, ex), '\ntmp/lantern/\n') } catch {} } }
}

function connect(req: object): Promise<Reply | null> {
  return new Promise((res) => {
    const c = net.createConnection(P.sock)
    let buf = ''
    c.on('connect', () => c.write(JSON.stringify(req) + '\n'))
    c.on('data', (d) => (buf += d))
    c.on('end', () => { try { res(JSON.parse(buf)) } catch { res({ ok: false, text: 'lantern gave no answer' }) } })
    c.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ECONNREFUSED') { try { fs.rmSync(P.sock, { force: true }) } catch {} } // a socket file left by a daemon that died
      res(e.code === 'ENOENT' || e.code === 'ECONNREFUSED' ? null : { ok: false, text: `could not reach lantern: ${e.message}` })
    })
    setTimeout(() => res({ ok: false, text: 'lantern did not answer within 2 minutes' }), 120_000).unref() // never what keeps the process alive
  })
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
/** A daemon whose socket has gone (deleted, or lost with a crash) still holds the Chrome profile: nothing else can start until it is gone. */
async function reapOrphan() {
  let pid = 0; try { pid = Number(fs.readFileSync(P.pid, 'utf8')) } catch {}
  if (pid && alive(pid)) { process.stderr.write(`an earlier lantern (pid ${pid}) was still running without its socket; stopping it\n`); try { process.kill(pid, 'SIGTERM') } catch {}; for (let i = 0; i < 40 && alive(pid); i++) await sleep(250); if (alive(pid)) { try { process.kill(pid, 'SIGKILL') } catch {} } }
  try { fs.rmSync(P.pid, { force: true }); fs.rmSync(P.sock, { force: true }) } catch {}
  // And the leftovers of other projects' daemons that died: a socket or pid file with no process behind it.
  try { for (const f of fs.readdirSync(path.dirname(P.pid))) { if (!f.endsWith('.pid')) continue; const file = path.join(path.dirname(P.pid), f); let other = 0; try { other = Number(fs.readFileSync(file, 'utf8')) } catch {}; if (other && !alive(other)) { fs.rmSync(file, { force: true }); fs.rmSync(file.replace(/\.pid$/, '.sock'), { force: true }) } } } catch {}
}

function start() {
  fs.mkdirSync(path.dirname(P.log), { recursive: true })
  const log = fs.openSync(P.log, 'a')
  const child = spawn(process.execPath, [here, '__daemon', root, ...(name ? [name] : [])], { detached: true, stdio: ['ignore', log, log], env: process.env })
  child.unref()
  return child
}

/** A daemon from an earlier install keeps that install's code; after an update it is closed (its page comes back) and started again. */
async function retireOld() {
  let was = ''; try { was = fs.readFileSync(P.build, 'utf8') } catch {}
  if (was === buildId()) return
  let pid = 0; try { pid = Number(fs.readFileSync(P.pid, 'utf8')) } catch {}
  if (!pid || !alive(pid)) return // nothing running; a running daemon with no build file (from before this check existed) is old too
  // Not under an agent that is mid-task: a daemon in use (or recording) keeps going on its old code, and is restarted
  // once it has been idle for five minutes. A daemon too old to answer the question is restarted now, as before.
  const idle = await connect({ cmd: 'idle' })
  if (idle?.ok) { try { const s = JSON.parse(idle.text); if (s.recording || s.idleMs < (Number(process.env.LANTERN_RETIRE_IDLE_MS ?? '') || (process.env.LANTERN_RETIRE_IDLE_MS === '0' ? 0 : 5 * 60_000))) return } catch {} }
  process.stderr.write(`lantern was updated to ${version()}; restarting its browser\n`)
  await connect({ cmd: 'close', why: 'updated' })
  for (let i = 0; i < 40 && pid && alive(pid); i++) await sleep(250)
}

async function ask(req: object): Promise<Reply> {
  await retireOld()
  const first = await connect(req)
  if (first) return first
  if (!findChrome()) die(NO_CHROME)
  await reapOrphan()
  const child = start()
  let gone = false; child.on('exit', () => (gone = true))
  const t0 = Date.now()
  while (Date.now() - t0 < 30_000) {
    await sleep(250)
    const r = await connect(req)
    if (r) return r
    if (gone) { let tail = ''; try { tail = fs.readFileSync(P.log, 'utf8').trim().split('\n').slice(-8).join('\n') } catch {}; die(`lantern could not start. Its log (${P.log}) ends:\n${tail}`) }
  }
  return die(`lantern did not start within 30s — see ${P.log}`)
}

async function main() {
  let req: object
  if (cmd === 'watch' && rest.includes('--all')) {
    // Every lantern on this project side by side: one page of live views, written where the pictures go.
    const up = instances(root)
    if (!up.length) die(`no lantern is running for ${root}`)
    const views: { name: string; url: string }[] = []
    for (const n of up) { const r = await new Promise<Reply | null>((res) => { const c = net.createConnection(paths(root, n || undefined).sock); let buf = ''; c.on('connect', () => c.write(JSON.stringify({ cmd: 'preview' }) + '\n')); c.on('data', (d) => (buf += d)); c.on('end', () => { try { res(JSON.parse(buf)) } catch { res(null) } }); c.on('error', () => res(null)) }); if (r?.ok) views.push({ name: n || 'lantern', url: r.text }) }
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
    const html = `<!doctype html><meta charset="utf-8"><title>lantern · ${esc(path.basename(root))} · all</title><link rel="icon" href="${FAVICON()}"><style>html,body{margin:0;height:100%;background:#0f0f12}body{display:grid;grid-template-columns:repeat(auto-fit,minmax(480px,1fr));gap:4px;padding:4px;box-sizing:border-box}iframe{width:100%;height:100%;min-height:48vh;border:0;border-radius:6px;background:#16161a}</style>${views.map((v) => `<iframe src="${esc(v.url)}" title="${esc(v.name)}"></iframe>`).join('')}`
    fs.mkdirSync(P.out, { recursive: true }); const file = path.join(path.resolve(root, paths(root).out), 'watch.html'); fs.writeFileSync(file, html)
    console.log(`${file}\n${views.map((v) => `${v.name}: ${v.url}`).join('\n')}\nwatching ${root} — every lantern on it, side by side. Open that in a browser (or \`lantern watch --all --open\`).`)
    if (rest.includes('--open')) { const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'; try { spawn(opener, [file], { detached: true, stdio: 'ignore' }).unref() } catch {} }
    process.exit(0)
  }
  if (cmd === 'watch') {
    // A live view of the page in your own browser, for a person who wants to see what the agent is doing.
    const r = await ask({ cmd: 'preview' })
    if (!r.ok) die(r.text)
    console.log(`${r.text}\nwatching ${root} — the page lantern is driving, live. Open that in a browser (or \`lantern watch --open\`); it closes when lantern does.`)
    if (rest.includes('--open')) { const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'; try { spawn(opener, [r.text], { detached: true, stdio: 'ignore' }).unref() } catch {} }
    process.exit(0)
  }
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') { console.log(`lantern ${version()}${updateHint(P.home)}`); return }
  if (cmd === 'update') { const r = await updateNow(P.home); if (!r.ok) die(r.text); console.log(r.text); return }
  if (cmd === 'settings') {
    // What is in force for this project and where each value came from; and where a setting would go.
    const { config, sources, files, userFile } = readSettings(root)
    const show = (v: unknown) => { const s = Array.isArray(v) ? v.join(', ') : String(v); return s.length > 72 ? s.replace(/\s+/g, ' ').slice(0, 69) + '…' : s }
    const tidy = (s: string) => s.replace(os.homedir(), '~')
    const lines = KEYS.filter((k) => (config as any)[k] !== undefined).map((k) => `  ${k.padEnd(10)} ${show((config as any)[k]).padEnd(72)} ${tidy(String(sources[k]))}`)
    console.log(`settings for ${root}${name ? ` (lantern "${name}")` : ''}:\n${lines.length ? lines.join('\n') : '  (none: defaults)'}\n\nfrom, first wins: the environment (LANTERN_URL, LANTERN_ON_LOAD, …), then .lantern/settings.json in the project folder or any folder above it, nearest first${files.length ? `:\n  ${files.map(tidy).join('\n  ')}` : ` (none found; yours would be ${tidy(userFile)})`}\nThe daemon reads settings when it starts: \`lantern close\` to pick up a change.`)
    return
  }
  if (cmd === 'skills') {
    if (rest[0] === 'install') { console.log(installSkills()); return }
    if (!rest[0] || rest[0] === 'status') { console.log(skillsStatus()); return }
    die('usage: lantern skills [install|status]')
  }
  if (cmd === 'close' && rest.includes('--all')) {
    // Every lantern on this project: the unnamed one and each named one.
    const up = instances(root)
    for (const n of up) await new Promise<void>((res) => { const c = net.createConnection(paths(root, n || undefined).sock); c.on('connect', () => c.write(JSON.stringify({ cmd: 'close' }) + '\n')); c.on('data', () => {}); c.on('end', () => res()); c.on('error', () => res()) })
    console.log(up.length ? `closed ${up.map((n) => n || '(unnamed)').join(', ')}` : 'no lantern was running for this project'); return
  }
  if (cmd === 'status' || cmd === 'close') {
    if (!fs.existsSync(P.sock)) {
      let pid = 0; try { pid = Number(fs.readFileSync(P.pid, 'utf8')) } catch {}
      if (pid && alive(pid)) { if (cmd === 'close') { await reapOrphan(); console.log('closed (it had lost its socket)') } else console.log(`lantern (pid ${pid}) is running for ${root} but its socket is gone: \`lantern close\` will stop it`); return }
      const others = instances(root).filter((n) => n !== (name ?? ''))
      console.log(cmd === 'status' ? `lantern${name ? ` "${name}"` : ''} is not running for ${root}\n  log: ${P.log}${others.length ? `\n  also on this project: ${others.map((n) => n || '(unnamed)').join(', ')}` : ''}` : 'lantern was not running'); return
    }
    req = { cmd }
  } else if (cmd === 'frame') {
    const images: string[] = []; let title: string | undefined, captions: string[] | undefined, out: string | undefined, layout: 'side' | 'stack' | undefined, scale: number | undefined, note: string | undefined, footer: string | undefined
    // --flag value and --flag=value both work (agents reach for either).
    const flat = rest.flatMap((a) => (/^--(title|captions|out|scale|note|footer)=/.test(a) ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a]))
    for (let i = 0; i < flat.length; i++) {
      const a = flat[i]
      if (a === '--title') title = flat[++i]
      else if (a === '--captions') captions = (flat[++i] ?? '').split('|').map((s) => s.trim())
      else if (a === '--out') out = flat[++i]
      else if (a === '--side' || a === '--stack') layout = a.slice(2) as 'side' | 'stack'
      else if (a === '--scale') scale = Number(flat[++i]) || undefined
      else if (a === '--note') note = flat[++i]
      else if (a === '--footer') footer = flat[++i]
      else images.push(path.resolve(cwd, a))
    }
    if (!images.length) die('lantern frame: give a screenshot to frame (from `lantern screenshot`), or two for a before/after')
    req = { cmd: 'frame', images, title, captions, out, layout, scale, note, ...(footer !== undefined ? { footer } : {}), branch: git('rev-parse', '--abbrev-ref', 'HEAD') || undefined, cwd }
  } else {
    req = { cmd: 'browser', args: argv, cwd, branch: git('rev-parse', '--abbrev-ref', 'HEAD') || undefined }
  }
  const reply = await ask(req)
  console.log(reply.text)
  process.exit(reply.ok ? 0 : 1)
}

main().catch((e) => die(String(e?.message ?? e)))

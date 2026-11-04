// What every test file needs: the fixture app on its own port, a temp LANTERN_HOME (so nothing touches ~/.lantern)
// and a temp project folder, with the real CLI run against them. Each file has its own, so files run in parallel.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { start } from './fixture/server.ts'

export const BIN = fileURLToPath(new URL('../bin/lantern.ts', import.meta.url))
export type Run = { ok: boolean; out: string }

export async function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-home-'))
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-proj-'))
  const app = await start()
  execFile('git', ['init', '-q'], { cwd: proj })
  await new Promise((r) => setTimeout(r, 300))
  const lanternWith = (env: Record<string, string>, ...args: string[]): Promise<Run> => new Promise((res) => execFile(process.execPath, [BIN, ...args], { cwd: proj, env: { ...process.env, LANTERN_HOME: home, ...env }, maxBuffer: 1 << 24, timeout: 180_000 }, (e, so, se) => res({ ok: !e, out: (so + se).trim() })))
  const lantern = (...args: string[]) => lanternWith({}, ...args)
  const ok = async (...args: string[]) => { const r = await lantern(...args); assert.ok(r.ok, `lantern ${args.join(' ')} failed: ${r.out}`); return r.out }
  const bad = async (...args: string[]) => { const r = await lantern(...args); assert.ok(!r.ok, `lantern ${args.join(' ')} should have failed: ${r.out}`); return r.out }
  const teardown = async () => { await lantern('close'); app.close(); fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(proj, { recursive: true, force: true }) }
  return { home, proj, app, lantern, lanternWith, ok, bad, teardown }
}

export const pngSize = (f: string) => { const b = Buffer.alloc(24); const fd = fs.openSync(f, 'r'); fs.readSync(fd, b, 0, 24, 0); fs.closeSync(fd); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } }
export const firstLine = (s: string) => s.split('\n')[0]
export const sh = (cmd: string, args: string[]) => new Promise<string>((res) => execFile(cmd, args, (_e, so, se) => res(so + se)))
/** What ffprobe says about a video, or null where ffprobe isn't installed (the file's existence and size are still checked). */
export const probe = async (f: string): Promise<string | null> => { const out = await sh('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,duration', '-show_entries', 'format=duration', '-of', 'default=nw=1', f]); return /ENOENT|not found/.test(out) ? null : out }
/** The colour at x,y of frame n of a video, as [r, g, b] — or null without ffmpeg. */
export const pixelAt = async (f: string, n: number, x: number, y: number): Promise<number[] | null> => new Promise((res) => execFile('ffmpeg', ['-v', 'error', '-i', f, '-vf', `select=eq(n\\,${n}),crop=1:1:${x}:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 1 << 20 }, (e, so) => res(e || !so.length ? null : [...so.subarray(0, 3)])))
export const duration = (p: string) => Math.max(...[...p.matchAll(/duration=([\d.]+)/g)].map((m) => Number(m[1])))
export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

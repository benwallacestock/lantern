// Chrome DevTools Protocol over Chrome's debugging pipe. No debugging port is opened: a port would expose the
// browser to anything on the machine; the pipe is only ever ours. Messages are JSON, NUL-terminated, on the
// child's file descriptors 3 (in) and 4 (out).
import { spawn, type ChildProcess } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'

type Pending = { res: (v: any) => void; rej: (e: Error) => void; method: string }
export type Listener = (sessionId: string | undefined, method: string, params: any) => void

export class Chrome {
  proc: ChildProcess
  private pending = new Map<number, Pending>()
  private seq = 0
  private buf: Buffer[] = []
  private listeners: Listener[] = []
  private inp: Writable

  constructor(bin: string, args: string[], log: number | 'inherit' = 'inherit') {
    this.proc = spawn(bin, [...args, '--remote-debugging-pipe'], { stdio: ['ignore', log, log, 'pipe', 'pipe'] })
    this.inp = this.proc.stdio[3] as unknown as Writable
    const out = this.proc.stdio[4] as unknown as Readable
    out.on('data', (d: Buffer) => this.feed(d))
    this.proc.on('exit', () => { for (const p of this.pending.values()) p.rej(new Error('chrome exited')); this.pending.clear() })
  }

  private feed(d: Buffer) {
    // Split on NUL, decoding each whole message: a multi-byte character can straddle two chunks.
    let start = 0
    for (let i = 0; i < d.length; i++) {
      if (d[i] !== 0) continue
      this.buf.push(d.subarray(start, i)); start = i + 1
      const text = Buffer.concat(this.buf).toString('utf8'); this.buf = []
      try { this.handle(JSON.parse(text)) } catch (e) { console.error('[cdp] bad message', (e as Error).message) }
    }
    if (start < d.length) this.buf.push(d.subarray(start))
  }

  private handle(m: any) {
    if (m.id !== undefined) {
      const p = this.pending.get(m.id); if (!p) return
      this.pending.delete(m.id)
      if (m.error) p.rej(new Error(`${p.method}: ${m.error.message}${m.error.data ? ` (${m.error.data})` : ''}`)); else p.res(m.result)
      return
    }
    for (const l of this.listeners) { try { l(m.sessionId, m.method, m.params) } catch (e) { console.error('[cdp] listener threw', e) } }
  }

  on(l: Listener) { this.listeners.push(l) }

  send<T = any>(method: string, params: object = {}, sessionId?: string, ms = 10_000): Promise<T> {
    const id = ++this.seq
    const msg = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })
    return new Promise<T>((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error(`the page did not answer (${method})`)) }, ms)
      this.pending.set(id, { res: (v) => { clearTimeout(t); res(v) }, rej: (e) => { clearTimeout(t); rej(e) }, method })
      this.inp.write(msg + '\0')
    })
  }

  kill() { try { this.proc.kill() } catch {} }
}

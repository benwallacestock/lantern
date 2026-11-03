// Finding and starting a Chrome. Headless (the new headless, a real Chrome with no window), its own profile per
// project so logins survive between sessions, talking to us over the pipe (see cdp.ts).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { Chrome } from './cdp.ts'

const MAC = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
]
const LINUX = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']
const WIN = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']

const onPath = (name: string) => { try { return execFileSync(process.platform === 'win32' ? 'where' : 'which', [name], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n')[0] || null } catch { return null } }
/** Chromes that test tooling has already downloaded: Playwright's and Puppeteer's caches. */
const cached = (): string[] => {
  const out: string[] = []
  const pw = path.join(os.homedir(), '.cache', 'ms-playwright')
  try { for (const d of fs.readdirSync(pw).filter((d) => d.startsWith('chromium-')).sort().reverse()) out.push(path.join(pw, d, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'), path.join(pw, d, 'chrome-linux', 'chrome')) } catch {}
  const pp = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome')
  try { for (const d of fs.readdirSync(pp).sort().reverse()) { for (const sub of fs.readdirSync(path.join(pp, d))) out.push(path.join(pp, d, sub, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'), path.join(pp, d, sub, 'chrome')) } } catch {}
  return out
}

/** The Chrome to use: GLADE_CHROME, then the usual places, then a test-tool download. */
export function findChrome(): string | null {
  const env = process.env.GLADE_CHROME
  if (env) return fs.existsSync(env) ? env : null
  const fixed = process.platform === 'darwin' ? MAC : process.platform === 'win32' ? WIN : []
  for (const f of fixed) if (fs.existsSync(f)) return f
  if (process.platform !== 'darwin') for (const n of LINUX) { const f = onPath(n); if (f) return f }
  for (const f of cached()) if (fs.existsSync(f)) return f
  return null
}

export const NO_CHROME = 'glade needs a Chrome and found none. Install Google Chrome (or Chromium, Edge, Brave), or point GLADE_CHROME at one.'

export function launchChrome(bin: string, profile: string, log: number | 'inherit' = 'inherit'): Chrome {
  fs.mkdirSync(profile, { recursive: true })
  return new Chrome(bin, [
    '--headless=new',
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--hide-scrollbars', '--mute-audio',
    '--window-size=1440,900',
    '--disable-features=TranslateUI,Translate',
  ], log)
}

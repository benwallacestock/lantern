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

/** The Chrome to use: LANTERN_CHROME, then the usual places, then a test-tool download. */
export function findChrome(): string | null {
  const env = process.env.LANTERN_CHROME
  if (env) return fs.existsSync(env) ? env : null
  const fixed = process.platform === 'darwin' ? MAC : process.platform === 'win32' ? WIN : []
  for (const f of fixed) if (fs.existsSync(f)) return f
  if (process.platform !== 'darwin') for (const n of LINUX) { const f = onPath(n); if (f) return f }
  for (const f of cached()) if (fs.existsSync(f)) return f
  return null
}

export const NO_CHROME = 'lantern needs a Chrome and found none. Install Google Chrome (or Chromium, Edge, Brave), or point LANTERN_CHROME at one.'

/**
 * Chrome with everything that moves on its own switched off — the set Playwright and Puppeteer use. A fresh profile
 * otherwise installs component extensions, offers to save passwords, translate, sync and update, and any of those
 * can take the focus from the page at an unlucky moment, after which input dispatched to the page goes nowhere.
 */
export function launchChrome(bin: string, profile: string, log: number | 'inherit' = 'inherit'): Chrome {
  fs.mkdirSync(path.join(profile, 'Default'), { recursive: true })
  // A new profile starts with the password manager off (the save-password bubble is browser UI that steals focus).
  const prefs = path.join(profile, 'Default', 'Preferences')
  if (!fs.existsSync(prefs)) fs.writeFileSync(prefs, JSON.stringify({ credentials_enable_service: false, profile: { password_manager_enabled: false } }))
  return new Chrome(bin, [
    '--headless=new', '--force-device-scale-factor=2',
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--no-service-autorun',
    '--disable-background-networking', '--disable-component-update', '--disable-component-extensions-with-background-pages', '--disable-extensions', '--disable-default-apps', '--disable-sync',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--disable-breakpad', '--disable-client-side-phishing-detection', '--disable-hang-monitor', '--disable-ipc-flooding-protection', '--disable-prompt-on-repost', '--disable-popup-blocking',
    '--password-store=basic', '--use-mock-keychain', '--metrics-recording-only', '--force-color-profile=srgb',
    '--hide-scrollbars', '--mute-audio',
    '--window-size=1440,900',
    // No back-forward cache (Playwright turns it off too: a cached document surprises navigation and input handling).
    '--disable-features=TranslateUI,Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints,PasswordManagerOnboarding,PasswordLeakDetection',
  ], log)
}

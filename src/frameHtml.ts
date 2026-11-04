// The look every lantern picture shares — the frame around a still (`lantern frame`) and the banner around a video
// (`record stop`): a dark gradient, the title with the glyph, the footer saying lantern · note · branch · time (or
// your own words) with "made with lantern" at its right. One place, so stills and videos match.
import { ORANGE } from './pageScripts.ts'

export type Foot = { note?: string; branch?: string; footer?: string; accent?: string; mark?: boolean }

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** The lantern glyph, in the accent colour, for the mark. */
export const GLYPH = (accent: string) => `<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M100 66 C100 38, 156 38, 156 66" fill="none" stroke="#e8e8ee" stroke-width="14" stroke-linecap="round"/><rect x="84" y="70" width="88" height="16" rx="6" fill="#e8e8ee"/><rect x="92" y="86" width="72" height="92" rx="12" fill="${accent}" stroke="#e8e8ee" stroke-width="12"/><path d="M128 112 C140 126, 146 136, 146 146 C146 157, 138 164, 128 164 C118 164, 110 157, 110 146 C110 136, 116 126, 128 112 Z" fill="#fff1c2"/><rect x="84" y="178" width="88" height="16" rx="6" fill="#e8e8ee"/></svg>`

export const when = () => new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** The title line, when there is one: just the words (the mark at the bottom right is the branding). */
export const titleHtml = (title: string | undefined) => (title ? `<h1>${esc(title)}</h1>` : '')

/** The footer: your own words, or lantern · note · branch · time; "made with lantern" at the right unless the mark is off. */
export function footHtml(f: Foot): string {
  const accent = f.accent ?? ORANGE
  const left = f.footer !== undefined ? `<span>${esc(f.footer)}</span>` : [`<b>lantern</b>`, f.note ? `<span>${esc(f.note)}</span>` : '', f.branch ? `<span class="mono">${esc(f.branch)}</span>` : '', `<span>${esc(when())}</span>`].filter(Boolean).join('<span>·</span>')
  return `<div class="foot">${left}${f.mark ? `<span class="made">${GLYPH(accent)}made with lantern</span>` : ''}</div>`
}

/** The frame's CSS. `u` scales the type and spacing to the picture's width, so a frame reads the same wherever it is
 * shown fitted to a column. A still's frame has rounded outer corners (its PNG is transparent around them); a
 * video's cannot, so `rounded` is false there. */
export function frameCss(u: number, accent: string, rounded: boolean): string {
  return `
    :root { --u: ${u.toFixed(3)}; }
    html, body { margin: 0; background: transparent; overflow: hidden; }
    body { display: inline-block; font-family: -apple-system, system-ui, sans-serif; color: #f2f2f4; }
    .frame { display: inline-flex; flex-direction: column; gap: calc(14px * var(--u)); padding: calc(28px * var(--u)) calc(32px * var(--u)) calc(22px * var(--u)); background: linear-gradient(160deg, #26262c, #15151a); ${rounded ? 'border-radius: calc(18px * var(--u));' : ''} }
    h1 { margin: 0; font-size: calc(18px * var(--u)); font-weight: 700; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* width 0 + min-width 100%: the footer wraps to the pictures' width instead of widening the frame to fit itself */
    .foot { display: flex; flex-wrap: wrap; gap: 4px calc(12px * var(--u)); align-items: center; font-size: calc(10.5px * var(--u)); color: #a0a0aa; width: 0; min-width: 100%; }
    .foot b { color: ${accent}; }
    .foot .mono { font-family: ui-monospace, Menlo, monospace; }
    .made { margin-left: auto; display: inline-flex; align-items: center; gap: calc(5px * var(--u)); color: #c8c8d0; font-weight: 600; }
    .made svg { width: calc(12px * var(--u)); height: calc(12px * var(--u)); }
    /* the picture: rounded, with a shadow — a figure in a still, the hole the clip shows through in a video */
    figure, .hole { margin: 0; border-radius: calc(12px * var(--u)); box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45), 0 1px 2px rgba(0, 0, 0, 0.3); overflow: hidden; }`
}

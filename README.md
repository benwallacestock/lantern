<p align="center"><img src="logo.svg" width="128" alt="lantern"></p>
<h1 align="center">lantern</h1>
<p align="center"><b>Let your agent see in the dark.</b><br>A command-line browser for coding agents.</p>

> **Vibe coded, for your pleasure.** Claude wrote nearly all of this in a day while [Ben](https://github.com/benwallacestock) pointed, squinted and said "no, orange". It has a proper end-to-end test suite and it gets used for real, but it's still a lantern that was hung up yesterday. Point it at the app you're building and sites you control, not at other people's: it is for showing your own work, and it isn't a scraper. Expect the odd rough edge, and send fixes. Humans and agents both welcome.

lantern is a CLI. Claude Code, Codex and anything else that can run a shell command use it to drive a real Chrome page: open, click, fill, read what it says. It takes screenshots that are ready for a pull request, records demo videos with captions and a visible pointer, and lets you watch the agent's page live from your own browser. It ships with skills that teach those agents when and how to use it.

lantern grew out of [forest](https://github.com/SpruceEco/forest), Spruce's tool for running one tree per branch, where its agent browser lives. This is that browser on its own, for any project.

```bash
lantern open http://localhost:3000
lantern snapshot                       # what's on the page, each control with a ref
lantern fill e7 "Large box"
lantern click "text=Get a quote"
lantern screenshot "text=£1.80"       # the page with that element glowing → tmp/lantern/shot-….png
lantern frame before.png after.png --title "The quote after sizing"   # one PNG for the PR

lantern record start
lantern record caption "Ask for a quote"
lantern click "text=Get a quote"
lantern record stop                    # → tmp/lantern/demo-….mp4

lantern watch                          # a live view of the page, in your own browser
```

Each command is a short-lived process. The first one starts a daemon for the project that owns the Chrome and the page, so the page survives between commands however long the agent thinks in between. It closes itself after half an hour idle, or on `lantern close`. No window, no app, no debugging port: Chrome is driven over its pipe.

## Install

Needs Node 22.18 or later and a Chrome (Google Chrome, Chromium, Edge or Brave; `LANTERN_CHROME=/path` to choose). ffmpeg is optional: with it, videos are assembled faster and come out smaller; without it, Chrome encodes them itself. 

```bash
npm install -g @benwallacestock/lantern      # the CLI; or run it without installing: npx -y @benwallacestock/lantern <command>
```

**Claude Code** — the plugin brings the skills that teach Claude when and how to use it:

```
/plugin marketplace add benwallacestock/lantern
/plugin install lantern@lantern
```

**Codex** — the same skills, with [skills](https://skills.sh) or by hand:

```bash
npx skills add benwallacestock/lantern
# or: ln -s "$(npm root -g)/@benwallacestock/lantern/skills/"* ~/.codex/skills/
```

**Any other agent** — put the text of `skills/lantern/SKILL.md` where the agent reads its instructions.

## What it does

- **Drive the page** as a person would: real mouse and key events through the DevTools protocol, so the page sees mousedown, keydown and input, not synthetic clicks. `snapshot` lists what can be acted on, with refs; `click`, `fill`, `press`, `drag`, `scroll`, `select`, `check`, `upload`, `hover`; `text`, `get`, `is`, `wait`, `console`, `eval`.
- **Screenshots at 2x**, like a Retina screen: the whole viewport, the page with one element glowing, a crop of one element, or the whole page however long. `size` picks phone, tablet, laptop, desktop or wide.
- **Frames for a pull request**: one picture, a before/after pair, or numbered steps, with a title drawn in, rounded corners, a shadow, and the branch and time in the footer.
- **Demo videos**: frames are kept only while a command runs and for a beat after, so the agent's thinking between commands is cut; captions hold for at least 2.5 seconds; the pointer glides to each target; a ring and a little mouse show each click; a keycap strip shows typing; a pill shows scrolling. ffmpeg assembles an MP4 when it is installed; otherwise Chrome encodes the video itself (MP4 where it can, WebM otherwise; GitHub plays both inline).

- **A live view** for a person: `lantern watch` opens a page in your own browser showing what the agent's page paints, with a line saying what it just did. Tools that embed lantern (forest's Agent Browser panel) get the same frames as JSON lines over the daemon's socket.

Pictures and videos go in `<project>/tmp/lantern/`, which lantern adds to `.git/info/exclude` so nothing lands in git.

## Settings

Most projects need none. A `.lantern.json` at the project root, or the same keys as `LANTERN_*` in the environment of the command that starts the daemon:

```json
{
  "url": "http://localhost:3000",
  "hosts": ["localhost"],
  "out": "tmp/lantern",
  "note": "SPR-123",
  "footer": "Acme · internal",
  "accent": "#4cc3ff",
  "watermark": false,
  "onLoad": "/* JavaScript run in the page after every load — a dev login, say */"
}
```

`url` is where relative paths go before any page has been opened. `hosts` keeps the page on your app: a navigation anywhere else fails and is noted in `lantern console`. `out` moves the pictures. `note` goes in the frame's footer and `footer` replaces it. `accent` recolours everything lantern draws. `watermark: false` leaves the small "made with lantern" off recordings. `onLoad` runs after each load, which is how forest logs its agent in as the dev user. `LANTERN_CHROME` and `LANTERN_FFMPEG` point at those binaries; `LANTERN_HOME` moves lantern's own state (default `~/.lantern`).

## How it is put together

- `bin/lantern.ts` — the CLI: finds the project root, talks to the daemon over a unix socket, starts it if it isn't up. From a checkout it runs as TypeScript (Node strips the types), and it is also the daemon's entry (`lantern __daemon <root>`), so esbuild bundles the whole program into one file for npm.
- `src/daemon.ts` — one per project: owns the Chrome, the page, and a queue so commands never interleave.
- `src/cdp.ts` — the DevTools protocol over Chrome's pipe. No dependencies.
- `src/page.ts` — every command, and the recorder.
- `src/pageScripts.ts` — what runs inside the page: the snapshot, locating targets, and the overlays (caption, pointer, highlight, keycaps, mouse).
- `src/frame.ts` — the PR frame, rendered by Chrome itself.
- `src/encode.ts` — the video, encoded by Chrome when there is no ffmpeg.
- `skills/` — the skills for Claude Code and Codex.

State lives in `~/.lantern` (`LANTERN_HOME` to move it): a profile per project (so logins persist), a socket, a log.

## Releases

Pre-1.0: versions are 0.x and a minor bump may change behaviour. Every change goes under *Unreleased* in [CHANGELOG.md](CHANGELOG.md) as it lands. To cut a release: `npm run release -- 0.2.0` (or `patch`, `minor`, `major`) moves that section under the new version, bumps `package.json`, commits, tags `v0.2.0` and pushes; the release workflow runs the tests, publishes a GitHub Release with those notes, and publishes the package to npm (with an `NPM_TOKEN` secret, or npm's trusted publishing once it is set up for this repository). The package is one bundled file, built by esbuild at publish time; from a checkout the TypeScript runs directly.

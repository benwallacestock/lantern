<p align="center"><img src="logo.svg" width="128" alt="lantern"></p>
<h1 align="center">lantern</h1>
<p align="center"><b>Let your agent see in the dark.</b><br>A browser for coding agents: see the app, show the change.</p>

Claude Code, Codex or any agent that can run a shell command gets a real Chrome page it can open, click, fill and read; screenshots that are ready for a pull request; and demo videos with captions, a visible pointer and the keys as they're typed. A person can watch it live from their own browser.

lantern grew out of [forest](https://github.com/SpruceEco/forest), Spruce's tool for running one tree per branch, where its agent browser lives. This is that browser on its own, for any project.

```bash
lantern open http://localhost:3000
lantern snapshot                       # what's on the page, each control with a ref
lantern fill e7 "Back bedroom"
lantern click "text=Calculate demand"
lantern screenshot "text=1.2 kW"       # the page with that element glowing → tmp/lantern/shot-….png
lantern frame before.png after.png --title "Demand after calculating"   # one PNG for the PR

lantern record start
lantern record caption "Calculate the heat demand"
lantern click "text=Calculate demand"
lantern record stop                    # → tmp/lantern/demo-….mp4

lantern watch                          # a live view of the page, in your own browser
```

Each command is a short-lived process. The first one starts a daemon for the project that owns the Chrome and the page, so the page survives between commands however long the agent thinks in between. It closes itself after half an hour idle, or on `lantern close`. No window, no app, no debugging port: Chrome is driven over its pipe.

## Install

Needs Node 22.18 or later, a Chrome (Google Chrome, Chromium, Edge or Brave; `LANTERN_CHROME=/path` to choose), and ffmpeg for video.

```bash
npm install -g @spruceeco/lantern          # the CLI
```

**Claude Code** — the plugin carries two skills that teach Claude when and how to use it:

```
/plugin marketplace add SpruceEco/lantern
/plugin install lantern@lantern
```

**Codex** — copy or link the skills into Codex's skills folder:

```bash
ln -s "$(npm root -g)/@spruceeco/lantern/skills/lantern" ~/.codex/skills/lantern
ln -s "$(npm root -g)/@spruceeco/lantern/skills/lantern-demo-video" ~/.codex/skills/lantern-demo-video
```

Any other agent: put the text of `skills/lantern/SKILL.md` where it reads its instructions.

## What it does

- **Drive the page** as a person would: real mouse and key events through the DevTools protocol, so the page sees mousedown, keydown and input, not synthetic clicks. `snapshot` lists what can be acted on, with refs; `click`, `fill`, `press`, `drag`, `scroll`, `select`, `check`, `upload`, `hover`; `text`, `get`, `is`, `wait`, `console`, `eval`.
- **Screenshots at 2x**, like a Retina screen: the whole viewport, the page with one element glowing, a crop of one element, or the whole page however long. `size` picks phone, tablet, laptop, desktop or wide.
- **Frames for a pull request**: one picture, a before/after pair, or numbered steps, with a title drawn in, rounded corners, a shadow, and the branch and time in the footer.
- **Demo videos**: frames are kept only while a command runs and for a beat after, so the agent's thinking between commands is cut; captions hold for at least 2.5 seconds; the pointer glides to each target; a ring and a little mouse show each click; a keycap strip shows typing; a pill shows scrolling. ffmpeg assembles an MP4.

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
  "onLoad": "/* JavaScript run in the page after every load — a dev login, say */"
}
```

`url` is where relative paths go before any page has been opened. `hosts` keeps the page on your app: a navigation anywhere else fails and is noted in `lantern console`. `out` moves the pictures. `note` goes in the frame's footer. `onLoad` runs after each load, which is how forest logs its agent in as the dev user. `LANTERN_CHROME` and `LANTERN_FFMPEG` point at those binaries; `LANTERN_HOME` moves lantern's own state (default `~/.lantern`).

## How it is put together

- `bin/lantern.ts` — the CLI: finds the project root, talks to the daemon over a unix socket, starts it if it isn't up.
- `src/daemon.ts` — one per project: owns the Chrome, the page, and a queue so commands never interleave.
- `src/cdp.ts` — the DevTools protocol over Chrome's pipe. No dependencies.
- `src/page.ts` — every command, and the recorder.
- `src/pageScripts.ts` — what runs inside the page: the snapshot, locating targets, and the overlays (caption, pointer, highlight, keycaps, mouse).
- `src/frame.ts` — the PR frame, rendered by Chrome itself.
- `skills/` — the skills for Claude Code and Codex.

State lives in `~/.lantern` (`LANTERN_HOME` to move it): a profile per project (so logins persist), a socket, a log.

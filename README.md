# glade

A browser for coding agents. Claude Code, Codex or any agent that can run a shell command gets a real Chrome page it can open, click, fill and read, screenshots that are ready for a pull request, and demo videos with captions, a visible pointer and the keys as they're typed.

A glade is the clearing in a forest where you can see what's going on. This one grew out of [forest](https://github.com/SpruceEco/forest), Spruce's tool for running one tree per branch, where its agent browser lives; glade is that browser on its own, for any project.

```bash
glade open http://localhost:3000
glade snapshot                       # what's on the page, each control with a ref
glade fill e7 "Back bedroom"
glade click "text=Calculate demand"
glade screenshot "text=1.2 kW"       # the page with that element glowing → tmp/glade/shot-….png
glade frame before.png after.png --title "Demand after calculating"   # one PNG for the PR

glade record start
glade record caption "Calculate the heat demand"
glade click "text=Calculate demand"
glade record stop                    # → tmp/glade/demo-….mp4
```

Each command is a short-lived process. The first one starts a daemon for the project that owns the Chrome and the page, so the page survives between commands however long the agent thinks in between. It closes itself after half an hour idle, or on `glade close`. No window, no app, no debugging port: Chrome is driven over its pipe.

## Install

Needs Node 22.18 or later, a Chrome (Google Chrome, Chromium, Edge or Brave; `GLADE_CHROME=/path` to choose), and ffmpeg for video.

```bash
npm install -g glade          # the CLI
```

**Claude Code** — the plugin carries two skills that teach Claude when and how to use it:

```
/plugin marketplace add SpruceEco/glade
/plugin install glade@glade
```

**Codex** — copy or link the skills into Codex's skills folder:

```bash
ln -s "$(npm root -g)/glade/skills/glade" ~/.codex/skills/glade
ln -s "$(npm root -g)/glade/skills/glade-demo-video" ~/.codex/skills/glade-demo-video
```

Any other agent: put the text of `skills/glade/SKILL.md` where it reads its instructions.

## What it does

- **Drive the page** as a person would: real mouse and key events through the DevTools protocol, so the page sees mousedown, keydown and input, not synthetic clicks. `snapshot` lists what can be acted on, with refs; `click`, `fill`, `press`, `drag`, `scroll`, `select`, `check`, `upload`, `hover`; `text`, `get`, `is`, `wait`, `console`, `eval`.
- **Screenshots at 2x**, like a Retina screen: the whole viewport, the page with one element glowing, a crop of one element, or the whole page however long. `size` picks phone, tablet, laptop, desktop or wide.
- **Frames for a pull request**: one picture, a before/after pair, or numbered steps, with a title drawn in, rounded corners, a shadow, and the branch and time in the footer.
- **Demo videos**: frames are kept only while a command runs and for a beat after, so the agent's thinking between commands is cut; captions hold for at least 2.5 seconds; the pointer glides to each target; a ring and a little mouse show each click; a keycap strip shows typing; a pill shows scrolling. ffmpeg assembles an MP4.

Pictures and videos go in `<project>/tmp/glade/`, which glade adds to `.git/info/exclude` so nothing lands in git.

## How it is put together

- `bin/glade.ts` — the CLI: finds the project root, talks to the daemon over a unix socket, starts it if it isn't up.
- `src/daemon.ts` — one per project: owns the Chrome, the page, and a queue so commands never interleave.
- `src/cdp.ts` — the DevTools protocol over Chrome's pipe. No dependencies.
- `src/page.ts` — every command, and the recorder.
- `src/pageScripts.ts` — what runs inside the page: the snapshot, locating targets, and the overlays (caption, pointer, highlight, keycaps, mouse).
- `src/frame.ts` — the PR frame, rendered by Chrome itself.
- `skills/` — the skills for Claude Code and Codex.

State lives in `~/.glade` (`GLADE_HOME` to move it): a profile per project (so logins persist), a socket, a log.

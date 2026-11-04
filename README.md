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

lantern watch                          # a URL for a live view of the page in your own browser (--open opens it)
```

Each command is a short-lived process. The first one starts a daemon for the project that owns the Chrome and the page, so the page survives between commands however long the agent thinks in between. It closes itself half an hour after the last command (a live view left open in a tab doesn't keep it up), or on `lantern close`. No window, no app, no debugging port: Chrome is driven over its pipe.

## Install

Needs Node 22.18+ and a Chrome (Google Chrome, Chromium, Edge or Brave). ffmpeg is optional: videos assemble faster and smaller with it.

```bash
npm install -g @benwallacestock/lantern
```

That installs the CLI and links its skills into `~/.claude/skills` (and into `~/.codex/skills` when Codex is set up). Open a new Claude Code or Codex session and ask it to look at, check, demo or screenshot something in your app. From then on lantern updates itself, skills included: it checks npm once a day and installs a newer version in the background.

- `lantern skills` shows where the links point; `lantern skills install` makes them again; `LANTERN_SKILLS=off` on the install skips them.
- `lantern update` updates now; `LANTERN_UPDATE=off` (or `update: false` in `.lantern.json`) turns the daily check off; `lantern version` says when a newer one is out.
- `LANTERN_CHROME=/path/to/chrome` picks the browser. Without installing: `npx -y @benwallacestock/lantern <command>`, slower to start.

**Claude Code plugin instead.** The same skills through `/plugin`, for a team that manages skills that way (pick one path, not both):

```
/plugin marketplace add benwallacestock/lantern
/plugin install lantern@lantern
```

The plugin brings only the skills; the first time Claude needs the CLI, the skill has it run the install above. Plugins from a marketplace update when you ask (`/plugin marketplace update lantern`) or when auto-update is on for the marketplace in `/plugin`.

**Any other agent.** Put the text of `skills/lantern/SKILL.md` where the agent reads its instructions.

## What it does

- **Drive the page** as a person would: real mouse and key events through the DevTools protocol, so the page sees mousedown, keydown and input, not synthetic clicks. `snapshot` lists what can be acted on, with refs; `click`, `fill`, `press`, `drag`, `scroll`, `select`, `check`, `upload`, `hover`; `text`, `get`, `is`, `wait`, `console`, `eval`.
- **Screenshots at 2x**, like a Retina screen: the whole viewport, the page with one element glowing, a crop of one element, or the whole page however long. `size` picks phone, tablet, laptop, desktop or wide.
- **Callouts**: the words beside an element, joined to it by a line, the element lit, numbered if you like; in screenshots and recordings.
- **Frames for a pull request**: one picture, a before/after pair, or numbered steps, with a title drawn in, rounded corners, a shadow, and the branch and time in the footer. A recording started with `--title` gets the same frame as a video.
- **Demo videos**: frames are kept only while a command runs and for a beat after, so the agent's thinking between commands is cut; captions hold for at least 2.5 seconds; the pointer glides to each target; a ring and a little mouse show each click; a keycap strip shows typing; a pill shows scrolling. ffmpeg assembles an MP4 when it is installed; otherwise Chrome encodes the video itself (MP4 where it can, WebM otherwise; GitHub plays both inline).

- **A live view** for a person: `lantern watch` prints the URL of a page (`--open` opens it) that shows what the agent's page paints, with a line saying what it just did. Tools that embed lantern (forest's Agent Browser panel) get the same frames as JSON lines over the daemon's socket.

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

`url` is where relative paths go before any page has been opened. `hosts` keeps the page on your app: a navigation anywhere else fails and is noted in `lantern console`. `out` moves the pictures. `note` goes in the frame's footer and `footer` replaces it. `accent` recolours everything lantern draws. `watermark: false` leaves the banner off videos and the "made with lantern" out of the frame's footer. `onLoad` runs after each load, which is how forest logs its agent in as the dev user. `LANTERN_CHROME` and `LANTERN_FFMPEG` point at those binaries; `LANTERN_HOME` moves lantern's own state (default `~/.lantern`).

## How it is put together

- `bin/lantern.ts` — the CLI: finds the project root, talks to the daemon over a unix socket, starts it if it isn't up. From a checkout it runs as TypeScript (Node strips the types), and it is also the daemon's entry (`lantern __daemon <root>`), so esbuild bundles the whole program into one file for npm.
- `src/daemon.ts` — one per project: owns the Chrome, the page, and a queue so commands never interleave.
- `src/cdp.ts` — the DevTools protocol over Chrome's pipe. No dependencies.
- `src/page.ts` — every command, and the recorder.
- `src/pageScripts.ts` — what runs inside the page to read it: the snapshot, locating targets, the focused element.
- `src/overlay.ts` — what lantern draws in the page, in one runtime: the caption, the pointer, the click rings, the keys bubble, and the annotations (highlight, callout, badge, ring, arrow, blur) that follow their element.
- `src/frameHtml.ts` — the look stills and videos share: the frame, the title, the footer with the mark.
- `src/frame.ts` — the PR frame, rendered by Chrome itself.
- `src/encode.ts` — the video, encoded by Chrome when there is no ffmpeg.
- `src/videoFrame.ts` — the frame around a titled video.
- `skills/` — the skills for Claude Code and Codex: `lantern`, `lantern-demo-video`, and `lantern-verify` (how to check a change works and matches its design).

State lives in `~/.lantern` (`LANTERN_HOME` to move it): a profile per project (so logins persist), a socket, a log.

## Releases

Every push to main is a release. Commit messages are [Conventional Commits](https://www.conventionalcommits.org/): `feat:` is a minor bump (pre-1.0, the only kind of breaking change there is), `fix:` and any other change to the program a patch, and `docs:`, `chore:`, `ci:`, `test:` make no release. The Release workflow runs the tests, decides the version from the commits since the last tag, writes their subjects into [CHANGELOG.md](CHANGELOG.md) as the notes (with `- ` lines from a commit body as sub-points), bumps `package.json` and the plugin's version, commits, tags, publishes the GitHub Release and the package to npm by trusted publishing, with provenance. Nobody bumps a version or edits the changelog by hand; `node scripts/release.ts auto --dry` shows what the next push would release. [AGENTS.md](AGENTS.md) says the same to the agents that work here. The package is one bundled file, built by esbuild at publish time; from a checkout the TypeScript runs directly.

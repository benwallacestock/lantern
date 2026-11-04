# Changelog

What changed in lantern, release by release, in the shape of [Keep a Changelog](https://keepachangelog.com/). Versions follow [semver](https://semver.org/); before 1.0 a minor bump may change behaviour. Nobody writes this file: every push to main is a release, and the commit messages (in the [Conventional Commits](https://www.conventionalcommits.org/) shape, see AGENTS.md) decide the version and become the notes.

## 0.4.3 — 2026-11-04

### Fixed
- A page that stops taking input is caught and the browser restarted, and six more things a user's agent ran into
  - The deaf page: lantern now checks that input arrives after any navigation (open, reload, back), at `record start`, when a recording ends with nothing, and when Chrome never answers an input event; a dead page gets the browser restarted (a recording in flight is abandoned and said so) instead of clicks printing success into the void
  - `click` waits for the element's box to stop moving after scrolling it into view, so a smooth scroll or a layout animation no longer gets a click aimed at where the card was
  - Two callouts keep off each other's labels
  - `frame --out name.png` with a bare name lands in the pictures folder, not the project root
  - `branch: false` (or LANTERN_BRANCH=off) keeps the branch name out of the footer and banner, for a branch named after something that must not reach a PR; the skill says so
  - The skills say `gh --attach` needs gh 2.99+ (it said 2.80+) and what to do with an older gh
  - "Nothing was recorded" says what to try when the actions printed success

## 0.4.2 — 2026-11-04

### Fixed
- Frame: type is sized by the frame's width again, so every frame in a pull request reads the same
  - Sizing by the longer side gave a tall stacked pair bigger type than the single shot beside it, since GitHub fits every image to the same column width; the video banner follows the same rule

## 0.4.1 — 2026-11-04

### Fixed
- Watch: the live view's URL follows a single-page app's own navigations
  - a pushState navigation (a router moving from / to /admin/jobs) left the watch stream and the live view's footer saying the first page; the URL now moves with the page
  - forest's Agent Browser tab shows this URL in its address line

## 0.4.0 — 2026-11-04

### Added
- One command sets everything up — `npm install -g` links the skills for Claude Code and Codex itself
  - A postinstall runs `lantern skills install` on a global install (not in CI, not with LANTERN_SKILLS=off), so there is nothing to run after it and every update brings the new skills
  - The README's Install section is short and exact: the one command, what it does, the knobs, and the plugin path as an alternative

## 0.3.4 — 2026-11-04

### Fixed
- Record: the frame stays for the whole video, and the "made with lantern" mark lines up with its words
  - The title, footer and rounded corners vanished after the first frame: the frame is one still laid over the clip, and ffmpeg dropped it once that one-frame input ended; it is looped now, and a test checks a corner well into the clip
  - The mark's glyph is cropped to its drawing, so it no longer sits high and to the left of the words

## 0.3.3 — 2026-11-04

### Fixed
- Frame: the title, captions and footer are sized to the frame's longer side, so a tall frame reads the same as a wide one
  - A stacked pair or a phone shot is fitted to its height in a viewer or a chat, and its type came out small; the video banner follows the same rule

## 0.3.2 — 2026-11-04

### Fixed
- Skills: annotate every picture and every demo step, not only when a callout seems too much
  - The lantern skill says to mark a picture before shooting it (a callout for the result, badges for steps, a ring or arrow for a detail) and to blur personal data, and when a bare screenshot is right
  - The demo-video skill asks for at least one annotation per result and to clear them between steps; its frame and size wording match 0.2.0 (a banner on every video, no glyph, the clip at 2x)
  - AGENTS.md: a skill change is a fix: or a feat:, since the skills ship in the package
- `lantern watch` prints the live view's URL and leaves the browser alone; `--open` opens it

## 0.3.1 — 2026-11-04

### Fixed
- An installed lantern finds its own package through the command's symlink
  - `lantern version` said 0.0.0, `lantern skills` found no skills, and the daily self-update never saw a global install, because the package was looked for next to <prefix>/bin/lantern instead of the bundle it links to

## 0.3.0 — 2026-11-04

### Added
- Every push to main is a release, with the version and notes from the commits
  - Commit messages in the Conventional Commits shape decide the version (feat is a minor bump, fix and other changes a patch, docs/chore/ci/test make no release) and become the release notes, so nobody bumps a version or edits the changelog by hand
  - `node scripts/release.ts auto --dry` shows what the next push would release
  - The Claude plugin's version moves with each release, so plugin users get updates (it had stayed at 0.1.0)
  - AGENTS.md, which CLAUDE.md imports, tells agents working in the repo how to write commits and what happens on push
- Lantern keeps itself current, and `lantern skills install` links the skills so they follow

## 0.2.0 — 2026-11-04

### Fixed
- The daemon closes itself 30 minutes after the last command, whatever else is going on: a live view left open in a browser tab (or a recording nobody stopped) kept it and its Chrome alive all night. The live view now says when lantern has closed, keeps the last picture, and shows the first one straight away (it waited for the page to change).
- After updating lantern, the next command restarts a daemon left from the earlier install (its page comes back), instead of driving the old code.
- Recordings played in slow motion once every painted frame was kept: a minimum frame time meant for sparse captures stretched dense ones. Clips are real time now, and `record stop` gives the length to a decimal.
- `lantern text` and `wait` no longer see lantern's own overlays (the typing bubble lingered in the page's text).
- `scroll to body` went to the bottom; now `scroll top` and `scroll bottom` exist and `scroll to body` means the top.
- `fill e7 ""` clears the field instead of reporting success and leaving it.

### Added
- `get style <property> <target>` reads a computed style, for checking a colour against a design.
- `callout <target> <words>`: the words beside an element, joined to it by a line, with the element lit; `callout 2 …` numbers it; in screenshots and recordings.
- `record start --title "…" [--note] [--footer]`: the video gets a frame like a still, with the glyph, the title and the footer, from ffmpeg or from the Chrome encoder.
- Typing is shown in a bubble by the pointer, each character popping in, with key combinations in the same bubble.
- A `lantern-verify` skill: how to check a change works and matches its design, and leave evidence in the pull request.
- Annotations beyond the highlight and the callout: `badge <n> <target>` numbers the steps of a still, `ring <target>` circles something small, `arrow <target>` points at it, `blur <target>` hides a name or a number; `clear [kind]` takes them off. Several can be up at once; each follows its element and goes when it does. All of lantern's drawing (these, the caption, the pointer, the click rings, the keys bubble) now shares one runtime and one look.

### Changed
- Recordings play at 24 frames a second and keep every frame Chrome paints; only actions keep a recording rolling, so an agent's reads between steps (`snapshot`, `text`) no longer record as pauses; `scroll to` scrolls visibly, with the wheel pill; every video sits in a dark banner that says lantern, the branch and the time, with "made with lantern" at its right (`watermark: false` to drop it; the still frame's footer carries the same); a title adds the bar above. Videos are the 2x pixels the page draws (2880 wide for the default size; they were 1x frames scaled up, which is why they looked soft). The title carries no glyph; the mark at the bottom right is the branding.
- The live view streams a lighter 1x picture at up to 25 frames a second while only watching (full quality when recording), drops frames for a slow viewer rather than lagging, and wears lantern's name and glyph.
- `--footer` (or the `footer` setting) replaces the frame's footer; the `accent` setting recolours everything lantern draws.

## 0.1.3 — 2026-11-03

### Fixed
- The restart lantern does when a page stops taking input (which still happens after some logins, for reasons that are Chrome's) took the daemon down with it, so the command got no answer; it now carries on, reopens the page the browser was on, and checks twice with time to answer before deciding a page is dead.

### Changed
- The tests run as four files in parallel, each with its own browser, in about a quarter of the time; the fixture app is now a trail planner.

## 0.1.2 — 2026-11-03

### Changed
- The npm package is `@benwallacestock/lantern` (0.1.1 was tagged before the rename and never reached npm).

## 0.1.1 — 2026-11-03

### Fixed
- Input no longer dies after a login or another navigation started by a click: Chrome is launched the way Playwright launches it (no component extensions, password bubble, translate, sync or back-forward cache), and if a page still stops taking input after a navigation, lantern notices in the same command and restarts its browser with the page and cookies carried over.
- `screenshot --crop` and region screenshots were offset by the scroll position; `--full` now covers a page wider than the viewport too.
- A daemon that lost its socket is stopped by the next command instead of wedging the project; `lantern close` finds it too.
- Downloads go into `tmp/lantern/downloads/`, named by the server, and the click says so — not into the person's own Downloads folder.
- A hover survives a screenshot; stills taken while recording leave the caption out.

### Changed
- Installed from npm as `@benwallacestock/lantern`: one bundled file built by esbuild at publish time. The release workflow publishes to npm as well as GitHub. The Claude plugin carries the skills; the CLI comes from npm, or runs with `npx -y @benwallacestock/lantern` uninstalled.

### Added
- The snapshot looks inside open shadow roots, lists an open dialog first, names submit buttons by their value and checkboxes by the text beside them, lists iframes, and skips labels in favour of their fields.
- `text=` also matches a label, placeholder, aria-label or button value; says when several elements match; hints at the nearest text when nothing matches exactly.
- A click aimed at something covered by an overlay or a modal's backdrop is refused, naming what is in front.
- `fill` sets date, time, range and colour inputs directly, refuses buttons and links, aims at a label's field, and says when focus was stolen while typing. `select` picks several options in a multi-select. `check` verifies the box changed.
- `press` gives characters a proper key code (so `cmd+=` zooms), accepts `cmd++` and named keys like Equal, and F1–F12.
- `open` reports an HTTP error page as a page (with its status) and explains HTTP auth; a fresh daemon reopens the last page; `wait` says when it capped; `text <selector>` returns every match; `get count text=…`; `lantern version`; `get` reads without scrolling.
- Console lines for failed requests name the URL; beforeunload is noted.

## 0.1.0 — 2026-11-03

### Added
- The `lantern` CLI: a real Chrome page for coding agents, driven over Chrome's pipe by a daemon per project, so the page survives between commands. `open`, `snapshot` with refs, `click`, `fill`, `press`, `type`, `hover`, `drag`, `scroll`, `select`, `check`, `upload`, `get`, `is`, `wait`, `text`, `console`, `eval`, `url`, `back`, `reload`, `size`, `status`, `close`.
- Screenshots at 2x: the viewport, the page with one element glowing, a crop, a region, or the whole page; `size` presets from phone to wide.
- `frame`: one picture, a before/after pair or numbered steps, framed for a pull request with a title, the branch and the time.
- `record`: demo videos that keep only the frames painted while a command runs, with captions held for at least 2.5 seconds, a visible pointer, click rings, a keycap strip and a scroll pill. ffmpeg assembles an MP4 when installed; otherwise Chrome encodes the video itself.
- `watch`: a live view of the page in your own browser, with a line for each action; the same frames and lines as JSON over the daemon's socket for tools that embed lantern.
- Settings from `.lantern.json` or `LANTERN_*`: `url`, `hosts` (an allowlist enforced on every document request), `out`, `note`, `onLoad`.
- Logins persist: the project's Chrome profile, and its cookies saved when the daemon stops and restored when it starts.
- Skills for Claude Code (as a plugin that also carries the CLI) and Codex: `lantern` and `lantern-demo-video`.

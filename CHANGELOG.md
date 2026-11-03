# Changelog

What changed in lantern, release by release, in the shape of [Keep a Changelog](https://keepachangelog.com/). Versions follow [semver](https://semver.org/); before 1.0 a minor bump may change behaviour. Write the entry under *Unreleased* with the change that makes it, in words a user of the CLI would understand; `npm run release` moves it under a version.

## Unreleased

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

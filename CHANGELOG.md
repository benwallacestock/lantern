# Changelog

What changed in lantern, release by release, in the shape of [Keep a Changelog](https://keepachangelog.com/). Versions follow [semver](https://semver.org/); before 1.0 a minor bump may change behaviour. Write the entry under *Unreleased* with the change that makes it, in words a user of the CLI would understand; `npm run release` moves it under a version.

## Unreleased

### Added
- The `lantern` CLI: a real Chrome page for coding agents, driven over Chrome's pipe by a daemon per project, so the page survives between commands. `open`, `snapshot` with refs, `click`, `fill`, `press`, `type`, `hover`, `drag`, `scroll`, `select`, `check`, `upload`, `get`, `is`, `wait`, `text`, `console`, `eval`, `url`, `back`, `reload`, `size`, `status`, `close`.
- Screenshots at 2x: the viewport, the page with one element glowing, a crop, a region, or the whole page; `size` presets from phone to wide.
- `frame`: one picture, a before/after pair or numbered steps, framed for a pull request with a title, the branch and the time.
- `record`: demo videos that keep only the frames painted while a command runs, with captions held for at least 2.5 seconds, a visible pointer, click rings, a keycap strip and a scroll pill. ffmpeg assembles an MP4 when installed; otherwise Chrome encodes the video itself.
- `watch`: a live view of the page in your own browser, with a line for each action; the same frames and lines as JSON over the daemon's socket for tools that embed lantern.
- Settings from `.lantern.json` or `LANTERN_*`: `url`, `hosts` (an allowlist enforced on every document request), `out`, `note`, `onLoad`.
- Logins persist: the project's Chrome profile, and its cookies saved when the daemon stops and restored when it starts.
- Skills for Claude Code (as a plugin that also carries the CLI) and Codex: `lantern` and `lantern-demo-video`.

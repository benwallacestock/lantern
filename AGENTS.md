# Working in lantern

lantern is a CLI (TypeScript, run directly by Node from the checkout, one esbuild bundle on npm) with a per-project daemon that owns a headless Chrome, plus the skills in `skills/` that teach agents to use it. `README.md` has the map of the code; `lantern help` the commands.

## Commits are the changelog, and every push to main is a release

Write commit subjects in the [Conventional Commits](https://www.conventionalcommits.org/) shape; they decide the version and become the release notes, word for word, so write them for a user of the CLI, not for yourself.

- `feat: …` — something new a user can do or see. A minor bump (0.2.1 → 0.3.0).
- `fix: …` — something that was wrong and is right now. A patch (0.2.1 → 0.2.2).
- `perf: …`, `refactor: …`, or a subject with no type — any other change to the program. A patch.
- `docs: …`, `chore: …`, `ci: …`, `test: …`, `style: …`, `build: …` — nothing a user would notice. No release. The skills in `skills/` are part of the product and ship in the package, so a change to them is a `fix:` or a `feat:` (with scope `skills`), never `docs:`.
- `feat!: …` (or `BREAKING CHANGE:` in the body) — a major bump (1.4.2 → 2.0.0): a command, flag or setting that people rely on changes or goes. Since 1.0 these are a promise; avoid them, and say why in the body when one is needed. (A line `Release-As: x.y.z` in a commit's body picks the version outright; 1.0 was cut that way.)

A scope is welcome and shows in the notes: `feat(record): a banner on every video` → "Record: a banner on every video". Keep the subject one line of plain words with a verb; put detail in the body as `- ` lines, which become sub-points under it in the notes. Everything else in the body (reasoning, attribution) stays out of the notes.

Never bump a version or edit `CHANGELOG.md` by hand: the Release workflow does both on every push to main (tests, version from the commits since the last tag, notes, commit "lantern x.y.z", tag, GitHub Release, npm by trusted publishing). `node scripts/release.ts auto --dry` shows what the next push would release. A push with only `docs:`/`chore:`/`ci:` commits releases nothing.

## Before you push

- `npm run typecheck && npm test` — the suite is four files in parallel (about 80s) against a fixture app, plus the parse and release-rule tests. Keep tests fast and never flaky: a test that waits on the clock without a reason to is wrong.
- Anything a person sees in a browser: look at it with lantern itself (`lantern screenshot`, `lantern record`) before saying it works.
- `lantern` on this machine may be an installed copy; the checkout runs as `node bin/lantern.ts <command>`. A daemon keeps the code it started with: after changing the daemon, `lantern close` (the installed copy restarts itself when its build changes).

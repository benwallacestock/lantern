---
name: lantern
description: Use the app you are working on in a real browser with the `lantern` CLI — open a page, click, fill, read what it says — to check that a UI change works before saying it does, to show the person what you built, and to take screenshots a reviewer can use (a before/after pair framed for the pull request). Use whenever a change touches something a person sees in a browser, when asked to look at, check, show, demo or screenshot a page, or when a pull request needs a picture.
---

# lantern: your browser

`lantern` drives a real Chrome page for you, with no window. Each command is an ordinary shell command and prints what happened; the page stays open between commands, however long you take between them. Run it from anywhere inside the project: the browser is per project, and pictures go in `tmp/lantern/` at the project root (kept out of git for you).

Check it is there with `lantern help`. If the command is not found: `npm install -g github:benwallacestock/lantern` puts it on the PATH (needs Node 22.18+ and a Chrome on the machine). Inside Claude Code the plugin carries the CLI too, so `node "${CLAUDE_PLUGIN_ROOT}/bin/lantern.ts" <command>` works in place of `lantern` without installing anything. If neither is possible, say so rather than reaching for another browser. ffmpeg is optional: videos are assembled faster with it, and by Chrome without it.

## The loop

Open, look, act, look again. The snapshot is how you see; read it before you click.

```bash
lantern open http://localhost:3000/admin/jobs   # a full URL the first time; after that `lantern open /settings`
lantern snapshot              # what's on the page you can act on; each control has a ref like e12
lantern click e12             # or: click "text=Save changes", a CSS selector, or 815,520 for a spot on a canvas
lantern fill e7 "Heat pump"   # clicks the field and types over what's in it, key by key
lantern press Enter           # or Escape, Tab, ArrowDown, a character, cmd+a, shift+Tab, ctrl+Enter
lantern text                  # the page's visible text, to confirm what it now says (or `text .selector` for one part)
lantern screenshot            # prints a PNG path: open that file with your image tool and look at it
```

More, when you need them:

```bash
lantern hover e12 · dblclick e12 · rightclick e12 · drag e12 e30 · drag 400,300 700,500
lantern scroll down 500 · scroll up · scroll down 400 at e12 · scroll to e12
lantern type "free text"      # into whatever has focus — a canvas, an editor
lantern select e7 "Heat pump" · check e9 · uncheck e9 · upload e4 ./tmp/photo.jpg
lantern get text|value|attr <name>|count|box <target> · is visible|enabled|checked <target>   # read or check one thing
lantern wait 1500 · wait "Saved"   # a pause, or until that text is on the page (10s at most)
lantern url · back · reload · console [--clear] · eval <js>
lantern size phone            # or tablet, laptop, desktop (1440×900), wide, or 1200x800 — held until changed
lantern status · close        # is it up; close the browser (it closes itself after 30 minutes idle)
```

**Targets.** A ref from the last snapshot (`e12`), `text=Exact label` (case-insensitive, whole text of the element), a CSS selector, or `x,y` in page pixels for a canvas. Refs are gone after a navigation or a reload: take a new snapshot. `text=` and selectors always work. Quote targets with spaces: `"text=Save changes"`.

**Custom controls.** A dropdown that is not a `<select>`: click it, snapshot, click the option. A date picker, a combobox, a menu: the same. `select` is only for a real `<select>`; it tells you if the element is not one.

**Waiting.** After an action that loads or fetches, `lantern wait "text that should appear"` rather than a fixed sleep. A snapshot that says `(nothing to act on)` usually means the page is still loading. Clicks that submit a form or follow a link wait for the new page themselves.

**Reading results.** `lantern text` is cheaper than a screenshot and tells you exactly what the page says. `lantern console` after an interaction lists console warnings and errors, uncaught exceptions, failed requests and dialogs that were dismissed: the errors a screenshot hides. Check it before declaring a flow works.

**Dialogs and tabs.** `alert`, `confirm` and `beforeunload` dialogs are accepted for you and noted in `console`. A link that opens a new tab is opened in the same page instead, and the click's output says so.

**Logging in.** lantern has no account of its own. If the app shows a login form, log in the way a person would — `fill` the fields, `click` the button — with the project's dev credentials (from its seed data, its README, or the person). Logins persist: the project's browser profile and its cookies survive between sessions. Never put a real credential for another service into the page. Projects that want it automatic set an `onLoad` script in `.lantern.json` (see Settings).

**When to use it.** Whenever you change something a person sees: open the page and look before you say it works. When the person asks to see, check, try or be shown something in the browser, this is the browser: don't go looking for another (Playwright, a browser extension, a desktop browser pane). To let the person watch what you are doing live, run `lantern watch` once: it prints a URL (and opens it) showing the page as you drive it, with a line saying what you just did. Mention the URL to them.

## Pictures for a pull request

A UI pull request needs pictures, and the reviewer should not have to guess what changed. lantern makes them:

```bash
lantern size desktop                                     # the same size for before and after (or phone)
lantern screenshot                                       # before the change (or on the base branch) → before.png
lantern screenshot                                       # after → after.png
lantern screenshot text=72%                              # the information you're talking about, glowing, on the whole page
lantern frame before.png after.png --title "Canvas and device symbols"   # one PNG: Before above After, titled, with branch and time
lantern frame after.png --title "The new empty state"                    # a single screenshot, framed
gh pr edit 123 --attach './tmp/lantern/framed-….png#Canvas and device symbols'   # into the PR body (gh 2.80+); or --attach on pr create / pr comment
```

- Always give `--title`: it is drawn into the frame as its heading, so the image says what it shows wherever it ends up (the PR, Slack, a ticket). Say what the pair is of ("Canvas and device symbols"), not "before and after".
- Take the "before" first, on the base branch or before applying the change, so the pair really is a pair. Same `size` for both.
- When the change is one component, screenshot just that: `lantern screenshot e12` gives the whole page with the element glowing (best for context); `--crop` gives only the element; or a region `x,y,w,h`. The whole page when the change is the page; `--full` for a page longer than the screen. Don't crop by hand: the frame is the crop.
- `--captions "Old|New"` to name the panels; `--note "SPR-123"` for the footer; landscape pictures stack one above the other, portrait ones (a phone) sit side by side (`--side` / `--stack` to override).
- Never commit anything from `tmp/lantern/`.

For a change a still can't show — a drag, a flow across pages, something animating — record a demo: see the `lantern-demo-video` skill.

## Settings

Most projects need none. A `.lantern.json` at the project root (or `LANTERN_URL`, `LANTERN_HOSTS`, `LANTERN_OUT`, `LANTERN_NOTE`, `LANTERN_ON_LOAD` in the environment) sets: `url`, where paths resolve before any page is open; `hosts`, the only hosts the page may visit; `out`, where pictures go; `note`, a word for the frame's footer; `onLoad`, JavaScript run after every load (a dev login, say). If `open` says the browser only visits this project's hosts, that is the project's choice: stay on them.

## What it can't do

- One page at a time, no tabs. A new tab is opened in place.
- The snapshot doesn't look inside iframes; `eval` can, or open the frame's URL directly.
- HTML5 drag-and-drop (dragstart/drop) may not fire from `drag`; pointer-driven dragging (mousedown/mousemove/mouseup) does.
- It does not see your own browser's logins; log in once in lantern.

## If something is wrong

- `lantern needs a Chrome`: install Google Chrome (or Chromium, Edge, Brave), or set `LANTERN_CHROME` to one.
- `could not assemble the video without ffmpeg`: Chrome couldn't encode it; `brew install ffmpeg` (or `apt install ffmpeg`), or set `LANTERN_FFMPEG`, and record again.
- `did not load`: nothing answers at that URL. Start the app, or check the port.
- `no element e12 — refs come from the last snapshot`: the page changed; snapshot again.
- `lantern could not start`: its log is named in the message. Node must be 22.18 or newer.
- Something odd: `lantern status`, then `lantern close` and start again.

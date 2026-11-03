---
name: lantern
description: Use the app you are working on in a real browser with the `lantern` CLI — open a page, click, fill, read what it says — to check that a UI change works before saying it does, to show the person what you built, and to take screenshots a reviewer can use (a before/after pair framed for the pull request). Use whenever a change touches something a person sees in a browser, when asked to look at, check, show, demo or screenshot a page, or when a pull request needs a picture.
---

# lantern: your browser

`lantern` drives a real Chrome page for you, with no window. Each command is an ordinary shell command and prints what happened; the page stays open between commands, however long you take between them. Run it from anywhere inside the project: the browser is per project, and pictures go in `tmp/lantern/` at the project root (kept out of git for you).

Check it is there with `lantern help`. If the command is not found, install it once with `npm install -g lantern-browser` (needs Node 22.18+ and a Chrome on the machine), or run it without installing as `npx -y lantern-browser <command>` wherever this skill says `lantern`. If neither is possible, say so rather than reaching for another browser. ffmpeg is optional: videos are assembled faster with it, and by Chrome without it.

## The loop

Open, look, act, look again. The snapshot is how you see; read it before you click.

```bash
lantern open http://localhost:3000/admin/jobs   # a full URL the first time; after that `lantern open /settings`
lantern snapshot              # what's on the page you can act on; each control has a ref like e12
lantern click e12             # or: click "text=Save changes", a CSS selector, or 815,520 for a spot on a canvas
lantern fill e7 "Heat pump"   # clicks the field and types over what's in it, key by key
lantern press Enter           # or Escape, Tab, ArrowDown, a character, cmd+a, shift+Tab, ctrl+Enter
lantern text                  # the page's visible text, to confirm what it now says (or `text .selector`: every match, separated by ---)
lantern screenshot            # prints a PNG path: open that file with your image tool and look at it
```

More, when you need them:

```bash
lantern hover e12 · dblclick e12 · rightclick e12 · drag e12 e30 · drag 400,300 700,500
lantern scroll down 500 · scroll up · scroll down 400 at e12 · scroll to e12
lantern type "free text"      # into whatever has focus — a canvas, an editor
lantern select e7 "Heat pump" · check e9 · uncheck e9 · upload e4 ./tmp/photo.jpg
lantern get text|value|attr <name>|count|box <target> · is visible|enabled|checked <target>   # read or check one thing
lantern wait 1500 · wait "Saved"   # a pause (30s at most), or until that text is on the page (10s at most)
lantern url · back · reload · console [--clear] · eval <js>
lantern size phone            # or tablet, laptop, desktop (1440×900, the start), wide, or 1200x800 — held until changed
lantern status · close        # is it up; close the browser (it closes itself after 30 minutes idle)
```

**Targets.** A ref from the last snapshot (`e12`), `text=Name` (case-insensitive; the whole visible text of an element, or the name the snapshot showed for it: a label, placeholder, aria-label or button value), a CSS selector, or `x,y` in viewport pixels for a canvas. Every snapshot renumbers refs, and they die with a navigation or reload: re-read before reusing a number. `text=` and selectors always work, and reach inside open shadow roots. Quote targets with spaces: `"text=Save changes"`. When several elements read the same, lantern uses the first that looks pressable and says so; a selector picks another. If something is in front of the target (an overlay, a modal's backdrop), the click is refused and the thing in front is named: close it first.

**The snapshot** lists controls, headings, dialogs and alerts, not prose: read results with `text` or `get text`. An open dialog is listed first, with the page behind it after. Names come from the label, placeholder, aria-label, button text or value; a control with no name shows `""`. Labels aren't listed separately: fill the field they label.

**Custom controls.** A dropdown that is not a `<select>`: click it, snapshot, click the option. A combobox, a menu: the same. `select` is only for a real `<select>` (several options at once for a multi-select); it tells you if the element is not one. `fill` sets a date, time, range or colour input directly, in the form the input wants (2026-01-15, #ff0000, a number in range), and refuses buttons and links. Keys: `press` takes Enter, Tab, Escape, arrows, F1–F12, a character, or combinations like `cmd+a`, `shift+Tab`, `cmd++`; characters carry a proper key code, so app shortcuts work.

**Waiting.** After an action that loads or fetches, `lantern wait "text that should appear"` rather than a fixed sleep. A snapshot that says `(nothing to act on)` usually means the page is still loading. Clicks that submit a form or follow a link wait for the new page themselves.

**Reading results.** `lantern text` is cheaper than a screenshot and tells you exactly what the page says (code shown in a textarea, as on GitHub, is in `get value` instead). `lantern console` lists console warnings and errors, uncaught exceptions, failed requests with their URLs, dialogs that were dismissed and files downloaded; it accumulates across pages, so `lantern console --clear` before a flow and `lantern console` after it shows just that flow's problems. Check it before declaring a flow works. Commands verify their result where they can: `check` says if the box didn't change, `fill` says if focus was stolen while typing, `click` says if a file was downloaded (into `tmp/lantern/downloads/`) or a new tab was opened in place.

**Dialogs, tabs and frames.** `alert`, `confirm` and `beforeunload` dialogs are accepted for you (a `prompt` with an empty answer) and noted in `console`. A link that opens a new tab is opened in the same page instead, and the click's output says so. The snapshot lists an iframe but doesn't look inside it, and `text`/`wait` don't either: click into the frame and `type`, or `eval` its `contentDocument`. A page built of `<frame>`s shows as such. HTTP basic auth can't be answered at the prompt: put the credentials in the URL.

**Logging in.** lantern has no account of its own. If the app shows a login form, log in the way a person would — `fill` the fields, `click` the button — with the project's dev credentials (from its seed data, its README, or the person). Logins persist: the project's browser profile and its cookies survive between sessions. Never put a real credential for another service into the page. Projects that want it automatic set an `onLoad` script in `.lantern.json` (see Settings).

**When to use it.** Whenever you change something a person sees: open the page and look before you say it works. When the person asks to see, check, try or be shown something in the browser, this is the browser: don't go looking for another (Playwright, a browser extension, a desktop browser pane). To let the person watch what you are doing live, run `lantern watch` once: it prints a URL (and opens it) showing the page as you drive it, with a line saying what you just did. Mention the URL to them.

**If a command says it worked but the page didn't change**, that is the one thing to be suspicious of. lantern checks for it after a navigation and restarts its browser itself when it happens (the output says so). If you see it otherwise: `lantern close`, then open the page again; the login survives.

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
- When the change is one component, screenshot just that: `lantern screenshot e12` gives the whole page with the element glowing (best for context); `--crop` gives only the element; or a region `x,y,w,h` in viewport pixels. The whole page when the change is the page; `--full` for a page longer or wider than the screen. Don't crop by hand: the frame is the crop. Screenshots and highlights scroll the target into view; for a picture from the top, `lantern scroll to body` first. Pictures are 2x (a 1440×900 viewport gives a 2880×1800 PNG), the size a PR wants.
- `--captions "Old|New"` to name the panels; `--note "SPR-123"` for the footer; landscape pictures stack one above the other, portrait ones (a phone) sit side by side (`--side` / `--stack` to override).
- Never commit anything from `tmp/lantern/`.

For a change a still can't show — a drag, a flow across pages, something animating — record a demo: see the `lantern-demo-video` skill.

## Settings

Most projects need none. A `.lantern.json` at the project root (or `LANTERN_URL`, `LANTERN_HOSTS`, `LANTERN_OUT`, `LANTERN_NOTE`, `LANTERN_ON_LOAD` in the environment) sets: `url`, where paths resolve before any page is open; `hosts`, the only hosts the page may visit; `out`, where pictures go; `note`, a word for the frame's footer; `onLoad`, JavaScript run after every load (a dev login, say). If `open` says the browser only visits this project's hosts, that is the project's choice: stay on them.

## What it can't do

- One page at a time, no tabs. A new tab is opened in place.
- The snapshot, `text` and `wait` don't look inside iframes; click into the frame and type, or `eval` its `contentDocument`.
- Permission prompts (geolocation, notifications) are not answered.
- It does not see your own browser's logins; log in once in lantern. Windows is not supported yet.

## If something is wrong

- `lantern needs a Chrome`: install Google Chrome (or Chromium, Edge, Brave), or set `LANTERN_CHROME` to one.
- `could not assemble the video without ffmpeg`: Chrome couldn't encode it; `brew install ffmpeg` (or `apt install ffmpeg`), or set `LANTERN_FFMPEG`, and record again.
- `did not load`: nothing answers at that URL. Start the app, or check the port.
- `no element e12 — refs come from the last snapshot`: the page changed; snapshot again.
- `lantern could not start`: its log is named in the message. Node must be 22.18 or newer.
- `lantern status` names the daemon's log; `lantern close` stops it, even one that lost its socket. Something odd: `lantern close` and open the page again.

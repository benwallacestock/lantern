---
name: glade
description: Use the app you are working on in a real browser with the `glade` CLI — open a page, click, fill, read what it says — to check a UI change works before saying it does, and to take screenshots a reviewer can use (a before/after pair framed for the pull request). Use whenever a change touches something a person sees in a browser, or when asked to show, check or screenshot a page.
---

# glade: your browser

`glade` drives a real Chrome page for you, with no window. Each command is a shell command; the page stays open between them, however long you take. It works from any folder of the project: pictures go in `tmp/glade/` there (kept out of git for you).

The first time, give a full URL. After that, paths resolve against it.

```bash
glade open http://localhost:3000/admin/jobs   # a full URL the first time; then `glade open /settings`
glade snapshot              # what's on the page you can act on; each control has a ref like e12
glade click e12             # or: click "text=Save changes", a CSS selector, or 815,520 for a spot on a canvas
glade fill e7 "Heat pump"   # replaces what's in the field, typing key by key
glade press Enter           # or cmd+a, shift+Tab
glade hover e12 · drag e12 e30 · drag 400,300 700,500 · dblclick e12 · scroll down 500 [at e12]
glade type "free text"      # into whatever has focus — a canvas, an editor
glade select e7 "Heat pump" · check e9 · uncheck e9 · upload e4 ./tmp/photo.jpg
glade get text|value|attr <name>|count|box <target> · is visible|enabled|checked <target>   # read or check one thing
glade text                  # the page's visible text — to confirm what it now says
glade wait 1500             # or `glade wait "Saved"` to wait for text to appear
glade screenshot            # prints a PNG path; Read that file to look at it
glade screenshot e12        # the page at its size with that element glowing (or text=Label, a selector); --crop for just the element
glade highlight e12         # a glowing box around an element, in screenshots and recordings; follows it; `highlight off`
glade console               # console warnings/errors, uncaught exceptions, failed requests
glade size phone            # or tablet, laptop, desktop (1440×900), wide, or 1200x800 — held until changed
```

Refs (`e12`) come from the last snapshot and are gone after a navigation: take a new snapshot. `text=Label` and selectors always work. A `(nothing to act on)` snapshot usually means the page is still loading: `glade wait 1000`, then again.

**Logging in.** glade has no account of its own. If the app shows a login form, log in the way a person would — `glade fill` the fields, `glade click` the button — with the project's dev credentials. The profile persists per project, so you stay logged in across runs. Never put real credentials from another service in.

**When to use it.** Whenever you change something a person sees: open the page and look, before you say it works. `glade console` after an interaction catches the errors a screenshot hides. Don't reach for another browser tool (Playwright, a browser extension) when glade is here.

## Pictures for a pull request

A UI pull request needs pictures, and the reviewer should not have to guess what changed. glade makes them:

```bash
glade size desktop                                         # the same size for before and after (or phone)
glade screenshot                                           # before the change (or on the base branch) → before.png
glade screenshot                                           # after → after.png
glade screenshot text=72%                                  # the information you're talking about, glowing, on the whole page
glade frame before.png after.png --title "Canvas and device symbols"   # one PNG: Before above After, titled, with branch and time
glade frame after.png --title "The new empty state"                    # a single screenshot, framed
```

Always give `--title`: it is drawn into the frame as its heading, so the image says what it shows wherever it ends up — in the PR, in chat, in a ticket. Say what the pair is of ("Canvas and device symbols"), not "before and after". Take the "before" first, on the base branch or before applying the change, so the pair really is a pair. When the change is one component, screenshot just that — `glade screenshot e12` or a region `x,y,w,h` — so the reviewer sees the part that matters at full size; the whole page when the change is the page. Don't crop by hand: the frame is the crop. Landscape pictures stack one above the other, portrait ones (a phone) sit side by side; `--side` / `--stack` override.

Attach it: `gh pr create|edit|comment` with the PNG (for example `--body` with the image uploaded, or the project's own way of attaching pictures). Never commit files from `tmp/glade/`.

For a change a still can't show — a drag, a flow across pages, something animating — record a demo: see the `glade-demo-video` skill.

## If something is wrong

- `glade needs a Chrome`: install Google Chrome (or Chromium, Edge, Brave), or set `GLADE_CHROME` to one.
- `recording needs ffmpeg`: `brew install ffmpeg` (or `apt install ffmpeg`), or set `GLADE_FFMPEG`.
- `did not load`: the app isn't running at that URL. Start it, or check the port.
- `glade status` says what is open; `glade close` closes the browser (it closes itself after 30 minutes idle).

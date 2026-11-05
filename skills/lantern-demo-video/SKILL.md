---
name: lantern-demo-video
description: Record a short demo video of a change in the app with `lantern record`, so a reviewer can watch the behaviour instead of imagining it from a diff. Use when a still can't show it — a drag, a flow across pages, something animating, a sequence of steps — or when the pull request rules or the person ask for a demo or a video.
---

# Recording a demo with lantern

A recording is a person using the app, and a human has to be able to follow it. The recorder only keeps frames while an action runs (`click`, `fill`, `press`, `scroll`, `drag`, `hover`, `highlight`, `callout`, `badge`, `ring`, `arrow`, `blur`, `clear`, `wait`, `open`, a caption) and for a moment after; your thinking between steps, and your reads (`snapshot`, `text`, `get`, `screenshot`), are cut out, even on a page that keeps animating. Everything the viewer needs is drawn into the video for you: a caption along the bottom, the pointer gliding to each target, a ring and a little mouse as a click lands, the keys as you type them, a pill when you scroll (`scroll to` scrolls visibly too), a glowing box around anything you highlight (and a badge, ring, arrow or blur where you put one). The video sits in a dark banner (lantern, the branch, the time, "made with lantern" at the right); `record start --title "…"` adds the title above it. It plays at 24 frames a second, at the 2x pixels Chrome painted.

The `lantern` skill covers the commands themselves; this one is how to make a recording a reviewer will watch. ffmpeg is optional: with it the MP4 is assembled in a second; without it Chrome encodes the clip itself, which takes as long as the clip is.

## The shape of a good one

1. **Plan the steps first.** Write them down: what the viewer sees at the start, each thing you'll do, what they see at the end. Under thirty seconds; five to eight captions. You can't watch it back, so get it right before you start. Rehearse the flow once without recording so every target is known.
2. **Start on the starting state.** Open the page, set the size (`lantern size desktop`, or `phone`), log in if needed, wait for it to settle. Then `record start --title \"What it shows\"`: every video sits in lantern's dark banner (lantern, `--note`, the branch, the time, "made with lantern"; `--footer` to replace the words), and the title adds a bar above it, as `frame` does for a still — always give one. The size is fixed for the whole recording.
3. **Caption first, then act.** A caption says what the viewer is about to see, in plain words, as they'd say it: "Drag the photo onto the album", not "Trigger onDrop". One caption per step. Each stays up at least 2.5 seconds, so don't repeat yourself.
4. **Do it the way a user would.** `click` the button, `fill` the field (it types key by key, about ten characters a second, so keep values short: typing is what makes clips long), `press Enter`, `scroll down`, `drag` the thing. Never `eval`, never jump to a URL mid-flow with `open` when a user would click there. Every click is in the video. The pointer appears with the first mouse command.
5. **Brisk through the routine, slow for what matters.** Getting to the page, opening a menu, closing a dialog: no caption, no `wait`, just the clicks — the pointer and the click ring are enough, and the video moves at about two seconds a click. Give time only where the viewer should take something in: after a step whose result takes a moment, `wait 1500` (or `wait "text that appears"`) so the result is recorded, then the next caption. `wait` is the one way to put stillness in the video, so use it on purpose and keep it short: a `wait 5000` is five seconds of nothing happening.
6. **Mark what matters, every time.** Each step has a result the viewer should notice, and the video should point at it: `callout <target> "what it means"` puts the words beside a figure, a message, a new row — joined to it by a line, the element lit; `arrow <target>` points at it without words; `ring <target>` circles something small (an icon, a toggle, a dot); `highlight <target>` lights a region. A demo with no annotation is a screen recording, not a demo: plan at least one per result, usually a callout. Point at information, never at the button you're about to click; the pointer shows that. Hold it with the `wait` that follows, then `clear` (or `callout off`) before the next step, so marks don't pile up. `blur <target>` an element that must not be in the video (a real customer's name, an email) before the step that shows it; it stays until cleared.
7. **Show states when the look is the change.** For a new control, a switcher, a hover or focus style, or anything whose point is how it looks and responds, let the viewer see the states: `hover <target>` and `wait 1000` shows its hover state (the pointer really travels while recording, so things light up on the way as they would for a person), then click it and `wait` for the pressed or selected state. For a flow or a behaviour change, skip this: it only slows the demo down.
8. **End on the finished state.** Last caption says what changed, hold it with `wait 2000`, then `record stop`. The video is real time: every action as it happened (a click is about two seconds with the pointer's glide and the page settling, typing about ten characters a second), every `wait` in full, and each caption for at least 2.5 seconds; what is cut is your thinking and your reads between steps, each to a beat. Budget from that: under thirty seconds means a handful of clicks, a few short values typed, short waits. `record stop` prints the length. The clip is the page at 2x (2880 pixels wide for the desktop size), inside the banner; `--title` gives a title bar across the whole video, not an opening card.

9. **Close the browser.** After `record stop` and any pictures: `lantern close`. The video is on disk; nothing else needs the page.

## Commands

```bash
lantern size desktop                                   # 1440×900 — or phone, tablet, laptop, wide
lantern open /the/page && lantern wait 2000
lantern record start --title "Estimating a walk" --note "TRAIL-7"   # a title frames the video like a still: glyph, title, footer
lantern record caption "Open the order and switch it to express delivery"   # --top puts it along the top, clear of a toolbar at the bottom
lantern click "text=Order #1042"
lantern wait 1500
lantern click e42                                      # refs from `lantern snapshot`
lantern record caption "The price follows the delivery choice"
lantern callout "text=Estimated time" "Two hours, now the terrain is a scramble"   # the result, pointed at: a callout, or `arrow` / `ring` / `highlight`
lantern wait 2500
lantern clear                                          # marks off before the next step
lantern record caption off                             # no caption for a while, if a step speaks for itself
lantern record stop                                    # → tmp/lantern/demo-….mp4 and its length
lantern close                                          # done: don't leave the browser running
```

Then attach it: `gh pr edit <pr> --attach './tmp/lantern/demo-….mp4#What the demo shows'` (or `--attach` on `pr create` / `pr comment`; gh 2.99+ — an older gh has no `--attach`, so say where the file is and ask the person to drag it into the PR). GitHub plays MP4 inline. Never commit it.

## What goes wrong

- A step flashes past: you acted before the caption, or didn't `wait` for the result. Caption, act, wait.
- Something of the app's is lying over what you are showing (a tip, a popover, a cookie banner, a toast): you can't see the page, so lantern tells you. A line starting ⚠ in a reply to `callout`, `highlight`, `ring`, `arrow`, `badge`, `screenshot <target>` or `record caption` means the picture is wrong as it stands: dismiss what it names (or move the words, as it says) and do the step again. Before `record start`, take one plain `lantern screenshot` and look at it; close anything that should not be in the video.
- The clip ran over: budget it before the take. A click is about two seconds on camera, a caption holds at least 2.5, typing is ten characters a second, and every `wait` counts in full; ten clicks and five captions are already past thirty seconds with no waits at all. Cut waits first, then steps.
- The take is slow to perform, or drifts from the rehearsal: run it as one shell script, command after command with no thinking between, and pick up refs inside it (`lantern snapshot | grep "Fill Panels"`) rather than from memory. Shorter takes, and the same every time.
- The caption sits on the app's own toolbar or a bar along the bottom: `lantern record caption --top "…"` puts it along the top instead.
- A callout's words land on the thing beside it (on a canvas lantern can't see what is drawn there): say which side, `lantern callout 707,447,135,80 "The new array" --left` (or `--right`, `--above`, `--below`).
- A tooltip is in the last frames: the pointer is still on the control you last clicked. `lantern hover` somewhere neutral before the final `wait`.
- The view cuts from one thing to another (an app that switches cameras or pages in one frame): that is the app, not the recording; set the caption before the step so the viewer knows what they are about to be looking at.
- The viewer can't tell what was clicked: you used `eval` or `fill` on something a user would click. Use the mouse commands.
- A box hangs over nothing: a highlight outlived its element — it goes when the element does, but turn it off when you move on.
- The pointer sits on the thing you're showing: `highlight` moves it out of the box; otherwise `hover` somewhere neutral first.
- The clip is long and dull: thinking and reads are already cut; what's left is you waiting with `wait`, or typing long values. Only wait for things the viewer needs to see, and keep typed values short.
- A pause in the middle you didn't intend: a `wait` that was longer than the result needed, or a `highlight` left on. Plan the steps so each command does something visible.
- `nothing was recorded`: the page never changed while recording. Something must happen on screen between `start` and `stop`.
- `already recording`: a previous recording was never stopped. `lantern record stop`, then start again.
- `the size is fixed while recording`: set `size` before `record start`; the size you set stays after `record stop`.
- A still taken while recording leaves the caption and keycaps out, so screenshots for the PR can be taken mid-flow.
- Marks (`callout`, `highlight`, `ring`…) stay on the page after `record stop`, so a still of the end can be taken with them; `lantern clear` takes them off.
- `could not assemble the video without ffmpeg`: Chrome couldn't encode it; `brew install ffmpeg` (or `apt install ffmpeg`), and record again.

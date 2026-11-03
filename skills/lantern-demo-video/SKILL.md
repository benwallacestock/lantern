---
name: lantern-demo-video
description: Record a short demo video of a change in the app with `lantern record`, so a reviewer can watch the behaviour instead of imagining it from a diff. Use when a still can't show it — a drag, a flow across pages, something animating, a sequence of steps — or when the pull request rules or the person ask for a demo or a video.
---

# Recording a demo with lantern

A recording is a person using the app, and a human has to be able to follow it. The recorder only keeps frames while an action runs (`click`, `fill`, `press`, `scroll`, `drag`, `hover`, `highlight`, `wait`, `open`, a caption) and for a moment after; your thinking between steps, and your reads (`snapshot`, `text`, `get`, `screenshot`), are cut out, even on a page that keeps animating. Everything the viewer needs is drawn into the video for you: a caption along the bottom, the pointer gliding to each target, a ring and a little mouse as a click lands, the keys as you type them, a pill when you scroll (`scroll to` scrolls visibly too), a glowing box around anything you highlight, and a small "made with lantern" in the corner. The video plays at 24 frames a second.

The `lantern` skill covers the commands themselves; this one is how to make a recording a reviewer will watch. ffmpeg is optional: with it the MP4 is assembled in a second; without it Chrome encodes the clip itself, which takes as long as the clip is.

## The shape of a good one

1. **Plan the steps first.** Write them down: what the viewer sees at the start, each thing you'll do, what they see at the end. Under thirty seconds; five to eight captions. You can't watch it back, so get it right before you start. Rehearse the flow once without recording so every target is known.
2. **Start on the starting state.** Open the page, set the size (`lantern size desktop`, or `phone`), log in if needed, wait for it to settle. Then `record start`. The size is fixed for the whole recording.
3. **Caption first, then act.** A caption says what the viewer is about to see, in plain words, as they'd say it: "Drag the photo onto the album", not "Trigger onDrop". One caption per step. Each stays up at least 2.5 seconds, so don't repeat yourself.
4. **Do it the way a user would.** `click` the button, `fill` the field (it types key by key, about ten characters a second, so keep values short: typing is what makes clips long), `press Enter`, `scroll down`, `drag` the thing. Never `eval`, never jump to a URL mid-flow with `open` when a user would click there. Every click is in the video. The pointer appears with the first mouse command.
5. **Let results land.** After a step whose result takes a moment, `wait 1500` (or `wait "text that appears"`) so the result is recorded, then the next caption. `wait` is the one way to put stillness in the video, so use it on purpose and keep it short: a `wait 5000` is five seconds of nothing happening.
6. **Point at information, not controls.** `highlight` a result the viewer should read — a figure, a message, a new row. Never the button you're about to click; the pointer shows that. `highlight off` when you move on.
7. **End on the finished state.** Last caption says what changed, hold it with `wait 2000`, then `record stop`. Time is compressed: a `wait` records at most about a second of stillness, and gaps between commands are cut, so a flow that took 40 seconds to drive comes out around 20. The video is 1920 pixels wide whatever the viewport.

## Commands

```bash
lantern size desktop                                   # 1440×900 — or phone, tablet, laptop, wide
lantern open /the/page && lantern wait 2000
lantern record start
lantern record caption "Open the order and switch it to express delivery"
lantern click "text=Order #1042"
lantern wait 1500
lantern click e42                                      # refs from `lantern snapshot`
lantern record caption "The price follows the delivery choice"
lantern highlight "text=Total"
lantern wait 2500
lantern highlight off
lantern record caption off                             # no caption for a while, if a step speaks for itself
lantern record stop                                    # → tmp/lantern/demo-….mp4 and its length
```

Then attach it: `gh pr edit <pr> --attach './tmp/lantern/demo-….mp4#What the demo shows'` (or `--attach` on `pr create` / `pr comment`; gh 2.80+). GitHub plays MP4 inline. Never commit it.

## What goes wrong

- A step flashes past: you acted before the caption, or didn't `wait` for the result. Caption, act, wait.
- The viewer can't tell what was clicked: you used `eval` or `fill` on something a user would click. Use the mouse commands.
- A box hangs over nothing: a highlight outlived its element — it goes when the element does, but turn it off when you move on.
- The pointer sits on the thing you're showing: `highlight` moves it out of the box; otherwise `hover` somewhere neutral first.
- The clip is long and dull: thinking and reads are already cut; what's left is you waiting with `wait`, or typing long values. Only wait for things the viewer needs to see, and keep typed values short.
- A pause in the middle you didn't intend: a `wait` that was longer than the result needed, or a `highlight` left on. Plan the steps so each command does something visible.
- `nothing was recorded`: the page never changed while recording. Something must happen on screen between `start` and `stop`.
- `already recording`: a previous recording was never stopped. `lantern record stop`, then start again.
- `the size is fixed while recording`: set `size` before `record start`; the size you set stays after `record stop`.
- A still taken while recording leaves the caption and keycaps out, so screenshots for the PR can be taken mid-flow.
- `could not assemble the video without ffmpeg`: Chrome couldn't encode it; `brew install ffmpeg` (or `apt install ffmpeg`), and record again.

---
name: lantern-demo-video
description: Record a short demo video of a change in the app with `lantern record`, so a reviewer can watch the behaviour instead of imagining it from a diff. Use when a still can't show it — a drag, a flow across pages, something animating, a sequence of steps — or when the pull request rules or the person ask for a demo or a video.
---

# Recording a demo with lantern

A recording is a person using the app, and a human has to be able to follow it. The recorder only keeps frames while a `lantern` command runs (and a moment after), so your thinking between commands is cut out. Everything the viewer needs is drawn into the video for you: a caption along the bottom, the pointer gliding to each target, an orange ring and a little mouse as a click lands, the keys as you type them, a pill when you scroll, a glowing box around anything you highlight.

Needs ffmpeg (`brew install ffmpeg`, or `LANTERN_FFMPEG=/path`). The `lantern` skill covers the commands themselves; this one is how to make a recording a reviewer will watch.

## The shape of a good one

1. **Plan the steps first.** Write them down: what the viewer sees at the start, each thing you'll do, what they see at the end. Under thirty seconds; five to eight captions. You can't watch it back, so get it right before you start. Rehearse the flow once without recording so every target is known.
2. **Start on the starting state.** Open the page, set the size (`lantern size desktop`, or `phone`), log in if needed, wait for it to settle. Then `record start`. The size is fixed for the whole recording.
3. **Caption first, then act.** A caption says what the viewer is about to see, in plain words, as they'd say it: "Drag the battery onto the inverter", not "Trigger onDrop". One caption per step. Each stays up at least 2.5 seconds, so don't repeat yourself.
4. **Do it the way a user would.** `click` the button, `fill` the field (it types key by key), `press Enter`, `scroll down`, `drag` the thing. Never `eval`, never jump to a URL mid-flow with `open` when a user would click there. Every click is in the video.
5. **Let results land.** After a step whose result takes a moment, `wait 1500` (or `wait "text that appears"`) so the result is recorded, then the next caption.
6. **Point at information, not controls.** `highlight` a result the viewer should read — a figure, a message, a new row. Never the button you're about to click; the pointer shows that. `highlight off` when you move on.
7. **End on the finished state.** Last caption says what changed, hold it with `wait 2000`, then `record stop`.

## Commands

```bash
lantern size desktop                                   # 1440×900 — or phone, tablet, laptop, wide
lantern open /the/page && lantern wait 2000
lantern record start
lantern record caption "Open the emitter and switch the sizing to room demand"
lantern click "text=UFH - Cloaks/WC"
lantern wait 1500
lantern click e42                                      # refs from `lantern snapshot`
lantern record caption "The flow rate follows the sizing choice"
lantern highlight "text=Flow rate"
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
- The clip is long and dull: thinking is already cut; what's left is you waiting with `wait`. Only wait for things the viewer needs to see.
- `nothing was recorded`: the page never changed while recording. Something must happen on screen between `start` and `stop`.
- `already recording`: a previous recording was never stopped. `lantern record stop`, then start again.
- `the size is fixed while recording`: set `size` before `record start`.

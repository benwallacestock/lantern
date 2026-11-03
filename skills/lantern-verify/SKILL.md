---
name: lantern-verify
description: Check that a UI change you made actually works and looks right, with the `lantern` CLI, before saying it does or opening a pull request — exercise it as a user would, read the console, compare it with the design or the version before, and leave evidence (a framed screenshot, a demo video) in the pull request. Use after changing anything a person sees in a browser, when asked to verify, validate, QA or check a change, or when a design (a Figma frame, a mockup image) is given to match.
---

# Verifying a change with lantern

A change you can't see working isn't done. This is the pass to make after the code and before the pull request: use the change the way a person will, look at it, compare, and keep what you saw. The `lantern` skill has the commands; the `lantern-demo-video` skill has recordings. This one is the method.

## 1. Set the scene

- Start the app, `lantern open` the page the change lives on, log in if it needs it, and `lantern size desktop` (or `phone` when the change is mobile, or both when it should hold on both). `lantern scroll top` before a screenshot that should start at the top; `lantern text .selector` reads one part of the page.
- `lantern console --clear`, so what the console says afterwards is about this flow.
- If there is a "before" to compare with (the base branch, or the app before applying the change), take its screenshots first: `lantern screenshot` of the same page at the same size. A reviewer trusts a pair far more than a single "after".

## 2. Use it as a person would

- Go through the flow with `click`, `fill`, `press`, `select`, `scroll`, never with `eval`. If a person would type it, type it. If a person would wait for something, `wait "the text that appears"`.
- After each step, read the result: `lantern text` for what the page says, `lantern get value e7` for what a field holds, `lantern is visible` / `is enabled` for state. Check what the change promises, and the one thing next to it that the change could have broken.
- Try the edge the change is likely to get wrong: the empty state, a long value, the second time through, the back button, a reload.
- `lantern console` at the end: errors, failed requests and uncaught exceptions are failures of the change until proven otherwise, even when the page looks fine. A warning is a question to raise (debug logging left in, a deprecation), not a failure, unless the change itself caused it.
- The empty state is worth one try: `lantern fill e7 ""` clears a field.

## 3. Compare with what it should be

- **Against a design.** When you have a design image (exported from Figma, a mockup file, a screenshot in the ticket), open it with your image tool and put it next to `lantern screenshot` at the same size; `lantern frame design.png shot.png --captions "Design|Built" --title "…"` puts them in one picture. Compare structure first (what is where), then type and spacing, then colour; `lantern get style background-color e3` reads a colour off the page exactly. Say what differs, in the design's words; don't call a difference fine because it's small. Put a callout on each difference (`lantern callout e3 "Design has this navy"`, a screenshot each) and frame those together.
- **Against the version before.** `lantern frame before.png after.png --title "…"` and look at the pair as a reviewer would.
- **Against the ticket.** Re-read what was asked and tick it off against what the page shows, not against the diff.

## 4. Leave evidence

- A framed picture: `lantern screenshot "text=the thing"` (the page with it glowing), or `lantern callout "text=the thing" "what it means"` then `lantern screenshot`, then `lantern frame … --title "What this shows"`.
- A demo video when a still can't carry it: a flow, a drag, something that moves. `lantern record start --title "…"`, captions, `record stop`.
- Attach them to the pull request with `gh pr create|edit|comment --attach`, and say in the description what you checked and what the console said. Never commit anything from `tmp/lantern/`.

## 5. Say what you found

Report in three parts: what works (with the evidence), what doesn't or differs from the design (exactly, with a picture), and what you couldn't check (no design, no data, a flow that needs a real account). A verdict with no evidence is a guess.

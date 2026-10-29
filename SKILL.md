---
name: remotion-video-check
description: Visually verify every video rendered with Remotion, then fix what is wrong and re-check. Measures pauses, black frames, hook motion, audio peak and stale renders with ffmpeg, lints the source, and walks a checklist (rhythm, framing, overlays, text, content, technical) frame by frame. Use it right after any `remotion render` / render script, before sending or committing a video, and whenever someone asks whether a video has errors, weak spots, illogical parts or bad animations.
---

# Remotion video check

A render is not finished until it has passed this check. Look at the frames
yourself. Never call a video good based on the code or the render log alone.
Report in the user's language.

Requirements: `ffmpeg` and `ffprobe` on PATH, Node 18+. The scripts live next
to this file in `scripts/` and need no npm packages. `<skill>` below means the
folder of this SKILL.md.

## 0. Before you start

- **Project rules:** If the project has `.claude/video-check-rules.md` (or a
  "Video check" section in CLAUDE.md), read it. It adds project-specific checks
  such as brand, wording, allowed stores or privacy rules, and it overrides
  the defaults here.
- **Preserve changes:** Run `git status` and re-read every file right before
  you edit it. Do not overwrite changes that someone else made since you last
  read the file. If such changes conflict with your fix, ask first.
- **Lint the source** before spending render time:

  ```bash
  node <skill>/scripts/lint-remotion.mjs src
  ```

  The lint flags several risky patterns:
  - `interpolate` without clamping
  - CSS transitions or animations
  - non-deterministic code (`Math.random`, `Date.now`, timers)
  - hard-coded fps
  - raw `<img>`, `<video>` or `<audio>` tags

  These are heuristics: judge each warning (a bounded input needs no clamp),
  and fix the real ones.

## 1. Cheap pre-check, then full render

When you have changed only part of the timeline, verify the change on stills
first:

```bash
npx remotion still <CompositionId> out/_qa/pre-<frame>.png --frame=<n>
npx remotion render <CompositionId> out/_qa/pre.mp4 --frames=<a>-<b>
```

Render all formats only when the stills look right.

## 2. Collect the material

For every rendered file:

```bash
node <skill>/scripts/qa-video.mjs out/<file>.mp4 [--src=src]
```

It writes to `out/_qa/<name>/`:

- `sheet.png`: one frame per second with timestamps
- `report.json`, containing:
  - `staticStretches`: spans where nothing visibly changes, ≥ 1.5 s by default
  - `firstMotion`: hook motion, checked against the 0.5 s limit
  - `blackFrames`, `peakDb`, duration and size
  - `staleRender`: a source file changed after the render
  - `warnings`: a summary of the points above

If `staleRender` is set, re-render before checking anything else.

Look at `sheet.png`. Then, for every scene change, every zoom or camera move,
and every spot that looks suspicious, run the script again and look at the
results:

- `--strip=a-b`: frames at 4 fps, for cuts and transitions
- `--strip=a-b --strip-fps=30`: for short ranges, to see stutter, easing
  and pops
- `--at=t1,t2`: full-resolution frames, for reading text

Check every format of a composition (16:9, 9:16, 4:5, 1:1); they break in
different places.

## 3. Checklist

**Hook and call to action**

- [ ] Visible motion in the first 0.5 s (`firstMotion`). A still opening frame loses viewers.
- [ ] The core message or promise is readable by about 1.5 s.
- [ ] Exactly one clear call to action at the end, and it is on screen long enough to read (≥ 2 s).

**Rhythm and motion**

- [ ] No stretch over ~1.5 s without new information (`staticStretches`). Intended holds, such as an end card or a payoff of at most 2.5 s, are fine; name them as intended.
- [ ] No dead air at the end. A static tail that is not an end card means a scene is longer than its content.
- [ ] No moment with no headline and no camera move while the subject stands still, typically right after the intro.
- [ ] The camera stays calm: no zoom pumping in and out on consecutive cuts, and no jumps in size or position between cuts of one scene.
- [ ] Zooms only on things worth reading. No zoom on confirmations, toasts or snackbars.
- [ ] Easing looks smooth in 30 fps strips: no linear starts or stops, no pops, and exits no slower than entrances.

**Framing and layout**

- [ ] Zooms are strong enough that the focused element is readable (rule of thumb: text ≥ ~22 px at 1080p).
- [ ] The space between text block and visual is balanced: no large empty gap and no overlap. Check short headlines without body text in particular.
- [ ] No mask, crop or edge feather cuts or fades the main visual (device mockup, product shot) in a way that looks like an error.
- [ ] Text is inside the platform safe zones (for social formats roughly 14 % top/bottom and 6 % sides). Nothing is clipped.
- [ ] No orphan words, and no line break inside numbers, prices or names.

**Overlays and highlights**

- [ ] Focus rings and highlights sit exactly on their element (same radius, centred). They never double up with a highlight the UI already shows; if the UI marks the state itself, use no ring.
- [ ] Overlays add information, such as a summary or a before/after. An overlay that repeats what the screen shows at the same moment should go.
- [ ] Decorative elements never stand alone: no line, badge or bullet without its text during a fade in or out.
- [ ] Counters and tickers end on the exact value shown elsewhere in the video.

**Content**

- [ ] Each scene shows the strongest screen or shot for its message.
- [ ] Nothing appears without a reason, such as settings or legal screens, unless the message needs it.
- [ ] No personal data (real names, emails, addresses, postcodes), no debug, test or internal banners, no notifications.
- [ ] Claims are true, or marked as an example.
- [ ] Spelling and grammar are correct, and so is the number formatting for the locale.

**Technical**

- [ ] `blackFrames` is empty, except for intended fades at the very start or end.
- [ ] The duration matches the composition, and `peakDb` is between −6 and −0.5 dB.
- [ ] No stray frame of a previous scene at a cut; the strips around every cut show this.
- [ ] Sound effects land on their visual hit, 0 to 3 frames early.
- [ ] File size and format fit the target platform.

## 4. Record findings

Keep one file per video, `out/_qa/<name>/findings.json`, and add a round each
time you check:

```json
{
  "rounds": [
    {
      "round": 1,
      "render": "out/promo.mp4",
      "findings": [
        {
          "id": "hook-static",
          "time": "0:05-0:08",
          "format": "16:9",
          "scene": "intro",
          "category": "rhythm",
          "severity": "major",
          "issue": "3.3 s without visible change after the logo",
          "cause": "intro scene is 2 bars, first zoom starts after it",
          "fix": "intro 1 bar, zoom starts with the next scene",
          "status": "open"
        }
      ]
    }
  ]
}
```

The `severity` value is one of:
- `critical`: wrong or broken, such as false claims, private data or black frames
- `major`: clearly visible weak spot
- `minor`: polish

The `status` value is `open`, `fixed`, `wontfix` or `ask-user`. Each new round
re-checks every earlier finding at the same timestamps. A finding that comes
back counts as a regression and is reported as such.

## 5. Fix

1. Sort the findings into two groups:
   - **Craft:** timing, zoom, masks, rings, spacing, artefacts, redundancy,
     lint warnings. Fix these directly in the source.
   - **Content decisions:** dropping or adding scenes, a different message,
     new footage or recordings. Propose these with a recommendation and wait
     for the user's answer.
2. Fix the cause, not the symptom. If timings come from data or events, such
   as a recording log, captions or beats, change the anchor, not a
   hard-coded frame.
3. Check the fix on stills (step 1), then re-render only the affected
   compositions. Then run `qa-video.mjs` again and look at the same
   timestamps. A before/after pair (`ffmpeg -i before.png -i after.png
   -filter_complex hstack`) makes the change visible.
4. At most three fix rounds per finding. If it is still there after that,
   report it as open instead of continuing.

## 6. Report

Give a short report with three parts:
- **Verified:** what was checked, with formats and timestamps.
- **Fixed:** each fix, with before/after.
- **Open / needs a decision:** content points, with a recommendation.

Hand over the final videos, plus before/after frames where they help. Commit
only source and script changes. Keep renders and `out/_qa` out of version
control.

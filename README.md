# remotion-video-check

An agent skill for Claude Code and other agents that read `SKILL.md` that
checks Remotion videos **after rendering**: it looks at the frames, fixes
what is wrong and checks again.

Most Remotion skills teach an agent how to *write* compositions. This one
makes sure the result is actually good before anyone sees it.

## What it does

- **Measures** with ffmpeg, so you don't rely on looks alone:
  - stretches where nothing visibly changes
  - whether the hook moves in the first 0.5 s
  - black frames, audio peak, duration and size
  - renders older than the source
- **Shows** the video as a 1-fps contact sheet, as frame strips (4 fps, or 30 fps
  to see easing) and as full frames, so the agent really looks at it.
- **Lints** the source before rendering:
  - `interpolate` without clamping
  - CSS animations
  - `Math.random`, `Date.now` and timers
  - hard-coded fps
  - raw `<img>`, `<video>` and `<audio>` tags
- **Checklist** of the things that make promo videos look cheap: dead pauses,
  weak or restless zooms, faded device mockups, double highlights, overlays
  repeating the screen, lone decorative lines, unreadable text, personal
  data, unmarked claims.
- **Fix loop:** the agent fixes craft issues itself and asks you about content
  decisions. It re-renders, re-checks the same timestamps, and keeps a
  `findings.json` per video so regressions show up. It stops after three
  rounds per issue.

## Install

You need `ffmpeg` and `ffprobe` on PATH and Node 18+. No npm packages are
needed.

For all your projects:

```bash
git clone https://github.com/Felipe3052/remotion-video-check ~/.claude/skills/remotion-video-check
```

For one project only, shared with your team via git:

```bash
git clone https://github.com/Felipe3052/remotion-video-check .claude/skills/remotion-video-check
rm -rf .claude/skills/remotion-video-check/.git
```

Update a global install with `git -C ~/.claude/skills/remotion-video-check pull`.

Optional: add `.claude/video-check-rules.md` to your project with your own rules,
such as brand spelling, allowed app stores, privacy, wording or claims. The
skill reads it and puts it before its defaults.

## Use

The skill triggers by itself after a render, or when you ask "check the video".
You can also run the scripts by hand:

```bash
node ~/.claude/skills/remotion-video-check/scripts/lint-remotion.mjs src
node ~/.claude/skills/remotion-video-check/scripts/qa-video.mjs out/video.mp4 --at=3,12.5 --strip=10-14 --strip-fps=30
```

Results land in `out/_qa/<name>/`. Add `out/` to `.gitignore`.

| Option | Meaning |
|---|---|
| `--at=s,s` | full-resolution frames at these seconds |
| `--strip=a-b` | frame strip of a time range (several ranges separated by commas) |
| `--strip-fps=n` | strip frame rate, default 4; 30 shows stutter and easing |
| `--freeze=s` | shortest static stretch to report, default 1.5 |
| `--hook=s` | first motion must happen within s seconds, default 0.5 |
| `--src=dir` | warn if a file in these folders is newer than the video, default `src` |
| `--out=dir` | output folder, default `out/_qa` |

The lint exits with code 1 when it finds something, so you can use it in a
pre-render script or CI. Its warnings are heuristics; judge each one.

## Works well with

- The official Remotion skills ([remotion-dev/skills](https://github.com/remotion-dev/skills))
  for writing compositions. This skill takes over once there is a render.

## Contributing

Issues and pull requests are welcome, especially new checklist items from
your own renders ("this went wrong and the skill didn't catch it").

## License

MIT, see `LICENSE`.

#!/usr/bin/env node
// Visual and technical QA material for rendered videos (Remotion or any MP4).
// Needs ffmpeg and ffprobe on PATH; no npm dependencies.
//
//   node qa-video.mjs out/video.mp4
//   node qa-video.mjs out/a.mp4 out/b.mp4 --at=5,8.5 --strip=36-48 --strip-fps=30 --src=src
//
// For every file it writes to <out>/<name>/ (default out: out/_qa):
//   sheet.png           one frame per second with timestamps (overview)
//   strip-<a>-<b>.png   frames of a time range, 4 fps by default
//                       (--strip-fps=30 for short ranges shows stutter and easing)
//   f-<t>.png           full-resolution frames at the given seconds
//   report.json         duration, size, black frames, stretches where nothing
//                       visibly changes, hook motion, peak level, stale render
//
// Options:
//   --at=s,s,…        full frames          --strip=a-b,c-d   strips
//   --strip-fps=n     strip frame rate     --freeze=s        min. static stretch (1.5)
//   --hook=s          motion must start within s seconds (0.5)
//   --src=dir,dir     warn if any file in these folders is newer than the video (src)
//   --out=dir         output folder (out/_qa)
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const list = (name, fallback = "") => opt(name, fallback).split(",").filter(Boolean);
const files = args.filter((a) => !a.startsWith("--"));
if (files.length === 0) {
  console.error("usage: node qa-video.mjs <video…> [--at=s,s] [--strip=a-b] [--strip-fps=n] [--freeze=s] [--hook=s] [--src=dir] [--out=dir]");
  process.exit(1);
}

const run = (cmd, a) => execFileSync(cmd, a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 });
// Analysis filters (blackdetect, freezedetect, volumedetect) only log, to stderr.
const ffmpegLog = (file, filter, audio = false) =>
  spawnSync("ffmpeg", ["-v", "info", "-nostats", "-i", file, audio ? "-af" : "-vf", filter, "-f", "null", "-"], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
  }).stderr;

const stamp = "drawtext=text='%{pts\\:hms}':x=8:y=8:fontsize=26:fontcolor=yellow:box=1:boxcolor=black@0.7";
const round = (v, d = 100) => Math.round(v * d) / d;

/** Newest file below the given folders (skips node_modules, out, .git). */
const newest = (dirs) => {
  let best = { file: null, mtime: 0 };
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (["node_modules", "out", ".git"].includes(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const m = statSync(p).mtimeMs;
        if (m > best.mtime) best = { file: p, mtime: m };
      }
    }
  };
  dirs.filter((d) => existsSync(d)).forEach(walk);
  return best;
};

for (const file of files) {
  const name = basename(file, extname(file));
  const dir = join(opt("out", join("out", "_qa")), name);
  mkdirSync(dir, { recursive: true });

  const probe = JSON.parse(
    run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate", "-of", "json", file]),
  );
  const video = probe.streams.find((s) => s.codec_type === "video");
  const duration = Number(probe.format.duration);
  const portrait = video.height > video.width;
  const [num, den] = video.r_frame_rate.split("/").map(Number);

  // Overview sheet: one frame per second.
  const cols = portrait ? 11 : 8;
  const rows = Math.ceil(Math.ceil(duration) / cols);
  run("ffmpeg", [
    "-v", "error", "-y", "-i", file,
    "-vf", `fps=1,scale=${portrait ? 240 : 480}:-1,${stamp},tile=${cols}x${rows}`,
    "-frames:v", "1", join(dir, "sheet.png"),
  ]);

  for (const t of list("at")) {
    run("ffmpeg", ["-v", "error", "-y", "-ss", t, "-i", file, "-frames:v", "1", join(dir, `f-${t}.png`)]);
  }

  const stripFps = Number(opt("strip-fps", "4"));
  for (const range of list("strip")) {
    const [a, b] = range.split("-").map(Number);
    const n = Math.ceil((b - a) * stripFps);
    const c = portrait ? 12 : 8;
    run("ffmpeg", [
      "-v", "error", "-y", "-ss", String(a), "-t", String(b - a), "-i", file,
      "-vf", `fps=${stripFps},scale=${portrait ? 200 : 360}:-1,${stamp},tile=${c}x${Math.ceil(n / c)}`,
      "-frames:v", "1", join(dir, `strip-${a}-${b}.png`),
    ]);
  }

  const black = [...ffmpegLog(file, "blackdetect=d=0.05:pix_th=0.08").matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map(
    (m) => [Number(m[1]), Number(m[2])],
  );
  // Downscaled and in grey, a slow drift or a blinking cursor still counts as
  // "nothing happens" – which is what a viewer perceives as a pause.
  const motion = (d) => {
    const log = ffmpegLog(file, `scale=192:-1,format=gray,freezedetect=n=0.01:d=${d}`);
    const starts = [...log.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => Number(m[1]));
    const ends = [...log.matchAll(/freeze_end: ([\d.]+)/g)].map((m) => Number(m[1]));
    return starts.map((s, i) => [round(s), round(ends[i] ?? duration)]);
  };
  const frozen = motion(Number(opt("freeze", "1.5")));
  // The hook: something must move right from the first frames.
  const hookLimit = Number(opt("hook", "0.5"));
  const opening = motion(0.2).find(([s]) => s < 0.05);
  const firstMotion = opening ? opening[1] : 0;

  const hasAudio = probe.streams.some((s) => s.codec_type === "audio");
  const peak = hasAudio ? Number(ffmpegLog(file, "volumedetect", true).match(/max_volume: (-?[\d.]+) dB/)?.[1]) : null;

  const rendered = statSync(file).mtimeMs;
  const src = newest(list("src", "src"));
  const warnings = [];
  if (src.mtime > rendered) warnings.push(`stale render: ${src.file} changed after the video was rendered`);
  if (firstMotion > hookLimit) warnings.push(`hook: first visible motion at ${firstMotion}s (limit ${hookLimit}s)`);
  if (black.length) warnings.push(`black frames: ${JSON.stringify(black)}`);
  for (const [a, b] of frozen) {
    warnings.push(`${b >= duration - 0.1 ? "static tail (end card hold or dead air?)" : "static"}: ${a}–${b}s`);
  }
  if (peak !== null && (peak > -0.5 || peak < -6)) warnings.push(`audio peak ${peak} dB (aim for −6 … −0.5)`);

  const report = {
    file,
    width: video.width,
    height: video.height,
    fps: num / den,
    duration: round(duration, 1000),
    sizeMB: round(statSync(file).size / 1e6, 10),
    blackFrames: black,
    staticStretches: frozen,
    firstMotion,
    peakDb: peak,
    staleRender: src.mtime > rendered ? src.file : null,
    warnings,
    material: dir,
  };
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

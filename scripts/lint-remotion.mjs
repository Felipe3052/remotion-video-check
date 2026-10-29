#!/usr/bin/env node
// Static checks for Remotion source before rendering. These are heuristics
// that print file:line warnings for a human or agent to judge; no
// dependencies.
//
//   node lint-remotion.mjs src            (default: src)
//
// Checks:
//   interpolate-clamp   interpolate() without extrapolate options: values run
//                       past the range, e.g. elements visible before their entrance
//   css-animation       CSS transition/animation/@keyframes: not frame-driven,
//                       so renders flicker or ignore the timeline
//   nondeterministic    Math.random / Date.now / setTimeout / setInterval:
//                       frames differ between render workers (use random(seed))
//   fps-literal         frame arithmetic with a hard-coded 24/25/30/60 instead of fps
//   raw-media           <img>/<video>/<audio> instead of Img/OffthreadVideo/Audio:
//                       Remotion cannot wait for them to load
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const roots = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const files = [];
const walk = (p) => {
  if (statSync(p).isDirectory()) {
    for (const e of readdirSync(p)) if (!["node_modules", "out", ".git"].includes(e)) walk(join(p, e));
  } else if ([".ts", ".tsx", ".js", ".jsx", ".mjs"].includes(extname(p))) files.push(p);
};
(roots.length ? roots : ["src"]).forEach(walk);

/** The argument text of every call to `name(`, with balanced parentheses. */
const calls = (text, name) => {
  const out = [];
  const re = new RegExp(`\\b${name}\\s*\\(`, "g");
  let m;
  while ((m = re.exec(text))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < text.length && depth > 0) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
      i++;
    }
    out.push({ index: m.index, args: text.slice(re.lastIndex, i - 1) });
  }
  return out;
};

const rules = [
  { id: "css-animation", re: /\b(transition|animation)\s*:|@keyframes/g, skip: /\/\/.*\b(transition|animation)\b/ },
  { id: "nondeterministic", re: /\bMath\.random\s*\(|\bDate\.now\s*\(|\bsetTimeout\s*\(|\bsetInterval\s*\(/g },
  { id: "fps-literal", re: /\b(frame|durationInFrames)\s*[/*]\s*(24|25|30|60)\b|\b(24|25|30|60)\s*\*\s*(seconds|secs|duration)\b/g },
  { id: "raw-media", re: /<(img|video|audio)[\s>]/g },
];

let count = 0;
const report = (file, text, index, id, note) => {
  const line = text.slice(0, index).split("\n").length;
  console.log(`${file}:${line}  ${id}  ${note}`);
  count++;
};

for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const c of calls(text, "interpolate")) {
    // A spread such as `...clamp` usually carries the extrapolate options.
    if (!/extrapolate|clamp/i.test(c.args)) {
      report(file, text, c.index, "interpolate-clamp", "no extrapolateLeft/Right – values continue outside the input range");
    }
  }
  for (const r of rules) {
    for (const m of text.matchAll(r.re)) {
      const lineText = text.slice(text.lastIndexOf("\n", m.index) + 1, text.indexOf("\n", m.index));
      if (lineText.trim().startsWith("//") || lineText.trim().startsWith("*")) continue;
      if (r.skip?.test(lineText)) continue;
      report(file, text, m.index, r.id, lineText.trim().slice(0, 100));
    }
  }
}
console.log(count ? `\n${count} warning(s) in ${files.length} file(s)` : `No warnings in ${files.length} file(s).`);
process.exitCode = count ? 1 : 0;

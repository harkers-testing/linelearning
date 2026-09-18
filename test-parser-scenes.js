// Fast, no-browser regression test for the "ghost empty scene" bug: a
// script that has two heading-style paragraphs back to back, with nothing
// (no dialogue, no stage direction) between them, used to produce a
// spurious 0-line scene immediately before the real one — e.g. Andy's
// report of "Scene 1" with 0 lines followed by "Scene 1 - the location of
// the scene" with 70-odd. See CLAUDE.md's "Organizing a script by Act and
// Scene" section for the full writeup.
//
// This talks to parser.js directly with hand-built "pages" (the same
// {str, x, y} shape pdf.js would hand it), so it runs in well under a
// second with no browser, no server, and no PDF file needed.
//
// Run with: node test-parser-scenes.js

const { parseScript } = require("./group-app/parser.js");

let failures = 0;
function check(name, fn) {
  let ok;
  let detail = "";
  try {
    ok = fn();
  } catch (err) {
    ok = false;
    detail = ` (threw: ${err.message})`;
  }
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail}`);
  if (!ok) failures++;
}

// Builds one "page" of {str, x, y} items from a list of paragraphs (each
// paragraph itself a list of text lines, for ones that wrap across more
// than one line). Mirrors test-group-app.js's fake PDF layout: a small
// (13) gap between lines that are part of the SAME paragraph, and a larger
// (30) gap before a new paragraph starts — parser.js's own paragraph-break
// heuristic (anything more than 1.5x the typical gap starts a new
// paragraph) needs that contrast to tell headings and speeches apart, the
// same way it does on real PDF text.
function page(paragraphs) {
  const items = [];
  let y = 1000;
  paragraphs.forEach((lines, pi) => {
    lines.forEach((str, li) => {
      if (pi > 0 && li === 0) y -= 30;
      else if (li > 0) y -= 13;
      items.push({ str, x: 50, y });
    });
  });
  return items;
}

// --- Scenario 1: Andy's exact report — an Act heading immediately
// followed by a bare "Scene 1" heading, immediately followed by a second,
// more descriptive heading for the SAME scene, then dialogue. -------------
{
  const pages = [
    page([
      ["ACT I"],
      ["Scene 1"],
      ["SCENE 1 - THE GARDEN OF MRS MALAPROP'S HOUSE"],
      ["ALICE", "Good morning, ma'am,", "and how are you", "keeping today?"],
      ["BOB", "And a fine one", "it is too,", "thank you kindly."],
    ]),
  ];
  const { scenes } = parseScript(pages);

  check("no ghost 0-line scene is created ahead of the real one", () => scenes.length === 1);
  check("the surviving scene has both lines of dialogue", () => scenes[0].lineCount === 2);
  check(
    "the more descriptive, later heading text wins as the label",
    () => scenes[0].defaultLabel === "SCENE 1 - THE GARDEN OF MRS MALAPROP'S HOUSE"
  );
}

// --- Scenario 2: an Act heading immediately followed by that act's own
// first scene heading (no bare "Scene 1" in between) — the most common
// real-world shape of this bug, since many scripts open every act straight
// into "Scene 1" with no separate title line. --------------------------
{
  const pages = [
    page([
      ["ACT II"],
      ["SCENE 1 - A STREET"],
      ["ALICE", "Let's go to", "the market", "this fine morning."],
      ["BOB", "A splendid", "idea indeed,", "let's away."],
    ]),
  ];
  const { scenes } = parseScript(pages);

  check("an Act heading directly followed by its scene heading stays one scene", () => scenes.length === 1);
  check("that scene keeps the real heading text, not a synthesized one", () =>
    scenes[0].defaultLabel === "SCENE 1 - A STREET");
}

// --- Scenario 3: a genuine second scene (with real content in between)
// must still be detected as two separate scenes — this fix must not make
// the parser under-detect real scene breaks. ----------------------------
{
  const pages = [
    page([
      ["ACT I"],
      ["ALICE", "Hello there,", "how do you do?"],
      ["BOB", "Hello yourself,", "and well enough."],
      ["SCENE 2"],
      ["ALICE", "A new scene now,", "let's begin afresh."],
    ]),
  ];
  const { scenes } = parseScript(pages);

  check("a scene break with real content before it is still detected", () => scenes.length === 2);
  check("the first scene keeps its own line", () => scenes[0].lineCount === 2);
  check("the second scene keeps its own line", () => scenes[1].lineCount === 1);
}

console.log(failures === 0 ? "\nAll scene-parsing checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

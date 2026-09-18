// parser.js — turns extracted PDF text (as an array of pages, each an array of
// {str, x, y, fontName, fontSize} text items from pdf.js) into a structured
// script: headings, stage directions, and character/line dialogue.
//
// This is the same parsing engine used by the solo Cue prototype
// (../parser.js) — copied here unchanged so group-app is self-contained.
// If you fix a bug or improve the parsing here, please also update the
// other copy (or better, turn this into a single shared file both apps
// load — not done yet, since it's still two separate small apps).
//
// This file has NO dependency on pdf.js or the browser — it is pure logic —
// so it can be unit-tested with plain Node and then reused as-is in the app.
// (function(){ ... })() wrapper below makes it work both as a Node module
// (for our test script) and as a plain <script> in the browser (where it
// attaches itself to window.ScriptParser).
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ScriptParser = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {

const STRUCTURAL_HEADINGS = [
  /^ACT\s+[IVXLCDM]+\b.*/i,
  /^SCENE\s*[—-].*/i,
  /^Scene\s+[IVXLCDM0-9]+\b.*/i,
  /^(PROLOGUE|EPILOGUE)\b.*/i,
  /^(DRAMATIS PERSONAE|PREFACE|THE END|FINIS)\.?\s*$/i,
];

// Anything past this point in the file is Project Gutenberg (or similar)
// boilerplate, not the play — stop treating text as dialogue once we see it.
const END_OF_TEXT_RE = /\*{3}\s*END OF (THE )?(THIS )?PROJECT GUTENBERG|^PLEASE READ THIS|PROJECT GUTENBERG LICENSE/i;

// A "speaker label" is an optional title word (Mrs., Sir, ...) followed by
// 1-4 ALL-CAPS words (letters, apostrophes, hyphens allowed), at the very
// start of a paragraph. Continuation words need at least 2 letters so a
// dialogue that starts right after the name with "I'll…"/"I've…" doesn't get
// swallowed into the name (e.g. "ABSOLUTE I'll tease him" is not "ABSOLUTE I'").
const SPEAKER_RE = /^\s*((?:Mrs\.|Mr\.|Miss|Sir|Lord|Lady|Dr\.)\s+)?([A-Z][A-Z']*(?:[-\s][A-Z]{2,}[A-Z']*){0,3})\b(.*)$/s;

function isStructuralHeading(line) {
  return STRUCTURAL_HEADINGS.some((re) => re.test(line.trim()));
}

// Which kind of structural heading this is, for Act/Scene tracking (G2,
// added 2026-09): "act" starts a new top-level section (an Act, or a
// Prologue/Epilogue treated the same way), "scene" starts a new scene
// within the current act, and "other" is meta text (DRAMATIS PERSONAE,
// PREFACE, THE END...) that doesn't change what act/scene we're in.
function classifyStructuralHeading(line) {
  const t = line.trim();
  if (/^ACT\s+[IVXLCDM]+\b/i.test(t) || /^(PROLOGUE|EPILOGUE)\b/i.test(t)) return "act";
  if (/^SCENE\s*[—-]/i.test(t) || /^Scene\s+[IVXLCDM0-9]+\b/i.test(t)) return "scene";
  return "other";
}

function isBracketedDirection(paragraph) {
  const t = paragraph.trim().replace(/\s+/g, " ");
  return /^\[.*\]$/.test(t);
}

// Groups of caps-words that should never be treated as a speaker label even
// though they're capitalized (stage-direction verbs used mid-sentence, etc.)
const NOT_A_NAME = new Set(["I", "O", "A"]);

function extractSpeaker(paragraph) {
  const m = paragraph.match(SPEAKER_RE);
  if (!m) return null;
  const [, title, capsRun, rest] = m;
  const words = capsRun.trim().split(/\s+/);
  if (words.length === 1 && NOT_A_NAME.has(words[0])) return null;
  const label = (title ? title.trim() + " " : "") + capsRun.trim();
  return { label, rest: rest || "" };
}

// --- paragraph reconstruction -------------------------------------------
// Takes pages: Array<Array<{str, x, y}>> (already sorted top-to-bottom,
// left-to-right within a line by the caller) and returns an array of
// { text, isPageStart } paragraph blocks.
function linesFromPage(items) {
  // group items into visual lines by y (rounded)
  const rows = new Map();
  for (const it of items) {
    const y = Math.round(it.y);
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(it);
  }
  const ys = [...rows.keys()].sort((a, b) => b - a); // pdf y grows upward
  return ys.map((y) => ({
    y,
    text: rows
      .get(y)
      .sort((a, b) => a.x - b.x)
      .map((i) => i.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  }));
}

function reconstructParagraphs(pages) {
  const paragraphs = [];
  let current = null;

  for (const page of pages) {
    const lines = linesFromPage(page).filter((l) => l.text.length > 0);
    if (lines.length === 0) continue;

    // Use the MODE of the line-to-line gaps, not the median: a page that
    // mixes normal dialogue spacing with a few widely-spaced headings/rules
    // has a median that lands between the two and misses everything. The
    // single most common gap is almost always "one ordinary line," which is
    // exactly the number we want to compare against.
    const gapCounts = new Map();
    for (let i = 1; i < lines.length; i++) {
      const g = Math.round(lines[i - 1].y - lines[i].y);
      gapCounts.set(g, (gapCounts.get(g) || 0) + 1);
    }
    let typicalGap = 14;
    let bestCount = 0;
    for (const [g, count] of gapCounts) {
      if (count > bestCount) {
        bestCount = count;
        typicalGap = g;
      }
    }

    lines.forEach((line, i) => {
      const isFirstOnPage = i === 0;
      const gapBefore = i === 0 ? Infinity : lines[i - 1].y - line.y;
      const isNewParagraph = isFirstOnPage || gapBefore > typicalGap * 1.5;

      if (isNewParagraph || !current) {
        if (current) paragraphs.push(current);
        current = { text: line.text, startedAtPageTop: isFirstOnPage };
      } else {
        current.text += " " + line.text;
      }
    });
  }
  if (current) paragraphs.push(current);
  return paragraphs;
}

// --- main parse -----------------------------------------------------------
function parseScript(pages) {
  const paragraphs = reconstructParagraphs(pages);

  const sequence = [];
  let started = false; // ignore everything before the first ACT heading
  let currentCharLabel = null;

  // Which Act/Scene we're currently inside, tracked as we walk through the
  // script (G2, added 2026-09) — every item pushed below (heading,
  // direction, line, or unassigned) gets tagged with whichever act/scene it
  // falls under, using the most recent ACT/SCENE heading seen so far.
  // sceneSeq is a simple counter that increases by one every time the act
  // or scene changes, in document order — that's what the app actually
  // uses to group and navigate scenes; act/scene are just the display text.
  let currentAct = null;
  let currentScene = null;
  let sceneSeq = -1;
  const tags = () => ({ act: currentAct, scene: currentScene, sceneSeq: sceneSeq < 0 ? null : sceneSeq });

  for (const para of paragraphs) {
    const text = para.text.trim();
    if (!text) continue;

    if (started && END_OF_TEXT_RE.test(text)) break;

    if (isStructuralHeading(text)) {
      if (/^ACT\s+[IVXLCDM]+/i.test(text)) started = true;
      if (started) {
        const kind = classifyStructuralHeading(text);
        if (kind === "act") {
          currentAct = text;
          currentScene = null;
          sceneSeq++;
        } else if (kind === "scene") {
          currentScene = text;
          sceneSeq++;
        }
        sequence.push({ type: "heading", text, ...tags() });
      }
      currentCharLabel = null;
      continue;
    }
    if (!started) continue;

    if (isBracketedDirection(text)) {
      sequence.push({ type: "direction", text, ...tags() });
      continue;
    }

    const found = extractSpeaker(text);
    if (found) {
      currentCharLabel = found.label;
      sequence.push({ type: "line", rawLabel: found.label, text: found.rest.trim(), ...tags() });
    } else if (currentCharLabel) {
      // continuation of the previous speech (no repeated name)
      const last = sequence[sequence.length - 1];
      if (last && last.type === "line" && last.rawLabel === currentCharLabel) {
        last.text += (last.text ? " " : "") + text;
      } else {
        sequence.push({ type: "line", rawLabel: currentCharLabel, text, ...tags() });
      }
    } else {
      sequence.push({ type: "unassigned", text, ...tags() });
    }
  }

  return { sequence, characters: groupCharacters(sequence), scenes: groupScenes(sequence) };
}

// --- one row per distinct speaker label -----------------------------------
// Earlier versions of this tried to guess when two labels (e.g. "ABSOLUTE"
// and "CAPTAIN ABSOLUTE") were the same character and merge them
// automatically. That guessing is gone: every distinct label the script
// actually uses gets its own row, and it's up to whoever is assigning parts
// to tick every label that's theirs. This is simpler, never silently
// mis-merges two different characters (say, a father and son sharing a
// surname), and it's exactly the mechanism an actor doubling up two
// different roles needs anyway.
function groupCharacters(sequence) {
  const rawLabels = new Map(); // label -> count
  for (const item of sequence) {
    if (item.type === "line") {
      rawLabels.set(item.rawLabel, (rawLabels.get(item.rawLabel) || 0) + 1);
    }
  }
  const characters = [...rawLabels.entries()].map(([name, count]) => ({ name, count }));
  return characters.sort((a, b) => b.count - a.count);
}

// --- one row per detected scene, in document order --------------------
// Walks the already-tagged sequence and collapses it down to one entry per
// distinct sceneSeq, with a line count and a sensible default label for
// scenes that had no explicit "SCENE n" heading of their own (lines that
// start right after an Act heading, with no separate scene marker).
function groupScenes(sequence) {
  const groups = [];
  let current = null;
  const sceneNumberByAct = new Map();

  for (const item of sequence) {
    if (item.sceneSeq == null) continue;
    if (!current || current.sceneSeq !== item.sceneSeq) {
      const actKey = item.act || "";
      const n = (sceneNumberByAct.get(actKey) || 0) + 1;
      sceneNumberByAct.set(actKey, n);
      current = {
        sceneSeq: item.sceneSeq,
        act: item.act || null,
        scene: item.scene || null,
        defaultLabel: item.scene || `Scene ${n}`,
        lineCount: 0,
      };
      groups.push(current);
    }
    if (item.type === "line") current.lineCount++;
  }
  return groups;
}

return {
  parseScript,
  extractSpeaker,
  isStructuralHeading,
  isBracketedDirection,
  classifyStructuralHeading,
  groupCharacters,
  groupScenes,
};
});

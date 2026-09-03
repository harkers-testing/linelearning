// build.js — assembles the single-file artifact (cue.html) from the real
// source files, instead of hand-copy-pasting them (which is exactly how a
// typo slipped in last time). Run: node build.js
const fs = require("fs");

const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const parserJs = fs.readFileSync("parser.js", "utf8");
const appJs = fs.readFileSync("app.js", "utf8");

let out = html
  // drop the outer document scaffolding — the Artifact host supplies its own
  .replace(/<!doctype html>\s*/i, "")
  .replace(/<html[^>]*>\s*/i, "")
  .replace(/<\/html>\s*/i, "")
  .replace(/<head>\s*/i, "")
  .replace(/<\/head>\s*/i, "")
  .replace(/<body>\s*/i, "")
  .replace(/<\/body>\s*/i, "")
  .replace(/<meta charset="utf-8">\s*/i, "")
  .replace(/<meta name="viewport"[^>]*>\s*/i, "")
  // inline the stylesheet
  .replace('<link rel="stylesheet" href="style.css">', `<style>\n${css}\n</style>`)
  // inline the two app scripts
  .replace('<script src="parser.js"></script>', `<script>\n${parserJs}\n</script>`)
  .replace('<script src="app.js"></script>', `<script>\n${appJs}\n</script>`);

fs.writeFileSync("dist-cue.html", out);
console.log("wrote dist-cue.html (" + out.length + " bytes)");

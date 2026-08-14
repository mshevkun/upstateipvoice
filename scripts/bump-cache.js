const fs = require("fs");
const path = require("path");

const VERSION = "20260813m10";
const ROOT = path.join(__dirname, "..");

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    if (entry.name === "node_modules" || entry.name === ".git") return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  });
  return out;
}

const files = walk(ROOT, []).filter(function (file) {
  return /\.(html|js)$/.test(file) && !file.includes(`${path.sep}compliance${path.sep}`);
});

files.forEach(function (file) {
  const t = fs.readFileSync(file, "utf8");
  const out = t
    .replace(/(href=")((?:\.\.\/)*)css\/style\.css(\?v=[^"]+)?"/g, '$1$2css/style.css?v=' + VERSION + '"')
    .replace(/(src=")((?:\.\.\/)*)js\/main\.js(\?v=[^"]+)?"/g, '$1$2js/main.js?v=' + VERSION + '"')
    .replace(/css\/style\.css\?v=20260813m\d+/g, "css/style.css?v=" + VERSION)
    .replace(/js\/main\.js\?v=20260813m\d+/g, "js/main.js?v=" + VERSION);
  if (out !== t) {
    fs.writeFileSync(file, out);
    console.log("updated", path.relative(ROOT, file));
  }
});

const fs = require("fs");
const path = require("path");
const files = [
  "index.html",
  "about.html",
  "privacy.html",
  "acceptable-use-policy.html",
  "privacy-policy/index.html",
  "terms/index.html",
];
for (const file of files) {
  const p = path.join(__dirname, "..", file);
  let t = fs.readFileSync(p, "utf8");
  const next = t
    .replace(/css\/style\.css(\?v=[^"'\s]+)?/g, "css/style.css?v=20260813m1")
    .replace(/js\/main\.js(\?v=[^"'\s]+)?/g, (m) =>
      m.startsWith("../") || t.includes('../js/main.js') && file.includes("/")
        ? m.replace(/js\/main\.js(\?v=[^"'\s]+)?/, "js/main.js?v=20260813m1")
        : "js/main.js?v=20260813m1"
    );
  // nested paths keep ../
  let out = t
    .replace(/(href=")(\.\.\/)?css\/style\.css(\?v=[^"]+)?"/g, '$1$2css/style.css?v=20260813m1"')
    .replace(/(src=")(\.\.\/)?js\/main\.js(\?v=[^"]+)?"/g, '$1$2js/main.js?v=20260813m1"');
  fs.writeFileSync(p, out);
  console.log("updated", file);
}

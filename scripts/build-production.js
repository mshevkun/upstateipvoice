/**
 * Production build: copy site to dist/ and point HTML to minified CSS/JS.
 * Run after: npm run build
 * Deploy the dist/ folder.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const srcPath = path.join(src, name);
    const destPath = path.join(dest, name);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// Create dist and copy assets
fs.mkdirSync(dist, { recursive: true });
copyDir(path.join(root, 'css'), path.join(dist, 'css'));
copyDir(path.join(root, 'js'), path.join(dist, 'js'));
copyDir(path.join(root, 'images'), path.join(dist, 'images'));

// Copy HTML and switch to minified assets
const htmlFiles = fs.readdirSync(root).filter((f) => f.endsWith('.html'));
for (const file of htmlFiles) {
  let html = fs.readFileSync(path.join(root, file), 'utf8');
  html = html.replace(/href="css\/style\.css"/g, 'href="css/style.min.css"');
  html = html.replace(/src="js\/main\.js"/g, 'src="js/main.min.js"');
  fs.writeFileSync(path.join(dist, file), html, 'utf8');
}

console.log('Production build written to dist/ (HTML uses style.min.css and main.min.js).');

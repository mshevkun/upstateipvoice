/**
 * Re-slice images/about/*.jpg from images/About-Us-figma.png.
 * Run after updating the Figma export: node scripts/slice-about.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const figma = path.join(root, 'images', 'About-Us-figma.png');
const outDir = path.join(root, 'images', 'about');

if (!fs.existsSync(figma)) {
  console.error('Missing Figma export:', figma);
  process.exit(1);
}

const py = `
from PIL import Image
import os

figma_path = r"${figma.replace(/\\/g, '\\\\')}"
out_dir = r"${outDir.replace(/\\/g, '\\\\')}"
im = Image.open(figma_path).convert('RGB')
w, h = im.size
os.makedirs(out_dir, exist_ok=True)

sections = [
    ('01-hero.jpg', 0, 160, w, 2080),
    ('02-mission.jpg', 0, 2080, w, 3180),
    ('03-came-from.jpg', 0, 3180, w, 5580),
    ('04-vision.jpg', 0, 5580, w, 7980),
    ('05-brand.jpg', 0, 7980, w, 10400),
    ('06-horse.jpg', 0, 10400, w, 12800),
    ('07-expertise.jpg', 0, 12800, w, 14320),
    ('09-wordmark.jpg', 0, 15520, w, h),
]

for name, x0, y0, x1, y1 in sections:
    crop = im.crop((x0, y0, x1, y1))
    crop.save(os.path.join(out_dir, name), quality=92, optimize=True)
    print(name, crop.size)
`;

execSync(`python -c "${py.replace(/"/g, '\\"')}"`, { stdio: 'inherit', cwd: root });
console.log('About Us slices updated from About-Us-figma.png');

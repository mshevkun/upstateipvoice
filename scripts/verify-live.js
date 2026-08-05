/**
 * Compare localhost (npm run dev) with the live site byte-for-byte.
 * Exit 0 only when every checked URL is identical.
 *
 * Usage: node scripts/verify-live.js [--local http://localhost:3000] [--live https://www.upstateipvoice.com]
 */
const http = require('http');
const https = require('https');

const LOCAL_BASE = getArg('--local', process.env.LOCAL_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
const LIVE_BASE = getArg('--live', process.env.LIVE_SITE_URL || 'https://www.upstateipvoice.com').replace(/\/$/, '');

const PAGES = [
  'index.html',
  'about.html',
  'solutions.html',
  'support.html',
  'privacy.html',
  'acceptable-use-policy.html',
  'privacy-policy/index.html',
  'terms/index.html',
];

const ASSETS = [
  'css/style.css',
  'js/main.js',
  'js/live-stats.js',
  'js/partnerships-intro.js',
  'images/index/hero.mp4',
  'images/index/video12.mp4',
  'images/index/science-hardware.png',
  'images/index/science-mobile-app.png',
  'images/index/science-automations.png',
  'images/index/why-choose-call-flow.png',
  'images/index/why-choose-any-device.png',
  'images/index/why-choose-anywhere.png',
  'images/index/mission-crowd.png',
  'images/index/mobile-connection.jpg',
  'images/index/mobile-connection@2x.jpg',
  'images/about/01-hero.jpg',
  'images/about/came-from.png',
  'images/about/vision.png',
  'images/about/brand.png',
  'images/about/apart.png',
  'images/footer/instagram.svg',
  'images/footer/wordmark-1920.png',
  'images/footer/wordmark@2x.png',
];

function getArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, { timeout: 120000 }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        fetchUrl(new URL(response.headers.location, url).href).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`${url} returned HTTP ${response.statusCode}`));
        response.resume();
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    request.on('timeout', () => request.destroy(new Error(`${url} timed out`)));
    request.on('error', reject);
  });
}

function compareBuffers(local, live, label) {
  if (local.length !== live.length) {
    return `${label}: size mismatch (local ${local.length} vs live ${live.length})`;
  }
  if (!local.equals(live)) {
    return `${label}: content mismatch (same size, different bytes)`;
  }
  return null;
}

async function main() {
  const failures = [];

  console.log(`Local: ${LOCAL_BASE}`);
  console.log(`Live:  ${LIVE_BASE}`);
  console.log('');

  for (const page of PAGES) {
    const path = page.startsWith('/') ? page : `/${page}`;
    const label = page;
    try {
      const [local, live] = await Promise.all([
        fetchUrl(`${LOCAL_BASE}${path}`),
        fetchUrl(`${LIVE_BASE}${path}`),
      ]);
      const error = compareBuffers(local, live, label);
      if (error) failures.push(error);
      else console.log(`OK  ${label}`);
    } catch (error) {
      failures.push(`${label}: ${error.message}`);
    }
  }

  for (const asset of ASSETS) {
    const path = `/${asset}`;
    const label = asset;
    try {
      const [local, live] = await Promise.all([
        fetchUrl(`${LOCAL_BASE}${path}`),
        fetchUrl(`${LIVE_BASE}${path}`),
      ]);
      const error = compareBuffers(local, live, label);
      if (error) failures.push(error);
      else console.log(`OK  ${label} (${local.length} bytes)`);
    } catch (error) {
      failures.push(`${label}: ${error.message}`);
    }
  }

  console.log('');
  if (failures.length) {
    console.error('LIVE VERIFICATION FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error('');
    console.error('Live site is NOT identical to localhost. Do not consider deploy complete.');
    process.exit(1);
  }

  console.log('Live site matches localhost for all checked pages and assets.');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

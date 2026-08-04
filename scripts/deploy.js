/**
 * Deploy the current folder to GitHub Pages (mshevkun/upstateipvoice).
 *
 * Rules:
 * - Deploy ONLY from this folder (single source of truth).
 * - Push to origin/master.
 * - Wait for GitHub Pages build.
 * - Verify live site matches localhost before reporting success.
 *
 * Usage: npm run deploy -- "commit message"
 * Prereq: npm run dev running in another terminal for verify step.
 */
const { execSync, spawnSync } = require('child_process');
const path = require('path');
const verifyLive = path.join(__dirname, 'verify-live.js');

const ROOT = path.join(__dirname, '..');
const REMOTE = 'origin';
const BRANCH = 'master';
const REPO = 'mshevkun/upstateipvoice';

const message = process.argv.slice(2).join(' ').trim() || 'Deploy site updates';

function run(command, options = {}) {
  return execSync(command, {
    cwd: ROOT,
    stdio: options.silent ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
}

function runSilent(command) {
  return run(command, { silent: true }).trim();
}

function ensureGitRepo() {
  try {
    runSilent('git rev-parse --git-dir');
  } catch {
    throw new Error('This folder is not a git repository. Run: git init && git remote add origin https://github.com/mshevkun/upstateipvoice.git');
  }
}

function ensureCleanDeploySource() {
  const legacyGithubDir = path.resolve(ROOT, '..', 'upstateipvoice-github');
  const fs = require('fs');
  if (fs.existsSync(legacyGithubDir)) {
    console.warn('');
    console.warn('WARNING: Legacy folder detected:', legacyGithubDir);
    console.warn('Edit and deploy from THIS folder only. The duplicate github folder causes drift.');
    console.warn('');
  }
}

function stageAndCommit() {
  run('git add -A');
  const status = runSilent('git status --porcelain');
  if (!status) {
    console.log('No changes to deploy.');
    return false;
  }
  run(`git commit -m ${JSON.stringify(message)}`);
  return true;
}

function push() {
  run(`git push ${REMOTE} ${BRANCH}`);
}

function getLocalHead() {
  return runSilent('git rev-parse HEAD');
}

function waitForPagesBuild(expectedCommit, timeoutMs = 300000) {
  const start = Date.now();
  console.log('');
  console.log(`Waiting for GitHub Pages build (${expectedCommit.slice(0, 7)})...`);

  while (Date.now() - start < timeoutMs) {
    try {
      const json = runSilent(`gh api repos/${REPO}/pages/builds --jq ".[0]"`);
      const build = JSON.parse(json);
      const buildCommit = (build.commit || '').slice(0, 7);
      const expected = expectedCommit.slice(0, 7);
      process.stdout.write(`\r  status=${build.status} commit=${buildCommit}`);

      if (build.status === 'built' && buildCommit === expected) {
        console.log('\nGitHub Pages build complete.');
        return;
      }
      if (build.status === 'errored') {
        throw new Error('GitHub Pages build failed. Check repo Actions/Pages settings.');
      }
    } catch (error) {
      if (String(error.message).includes('Pages build failed')) throw error;
    }

    execSync('powershell -Command "Start-Sleep -Seconds 10"');
  }

  throw new Error('Timed out waiting for GitHub Pages build.');
}

function verifyLiveSite() {
  console.log('');
  console.log('Verifying live site matches localhost...');
  const result = spawnSync(process.execPath, [verifyLive], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error('Live verification failed after deploy.');
  }
}

function main() {
  ensureGitRepo();
  ensureCleanDeploySource();

  console.log('Deploy source:', ROOT);
  const hadCommit = stageAndCommit();
  if (!hadCommit) {
    console.log('Checking if live site still matches localhost...');
    verifyLiveSite();
    return;
  }

  push();
  const head = getLocalHead();
  waitForPagesBuild(head);

  // CDN can lag briefly even after build.status= built
  execSync('powershell -Command "Start-Sleep -Seconds 15"');
  verifyLiveSite();

  console.log('');
  console.log('Deploy complete and verified.');
  console.log(`https://www.upstateipvoice.com/ (${head.slice(0, 7)})`);
}

try {
  main();
} catch (error) {
  console.error('');
  console.error(error.message || error);
  process.exit(1);
}

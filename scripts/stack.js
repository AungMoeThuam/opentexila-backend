const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { parseEnv } = require('node:util');

const DEFAULT_FRONTEND_REPO = 'https://github.com/AungMoeThuam/opentexila.git';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.signal || result.status}).`);
}

function ensureEnvironment(root) {
  const destination = path.join(root, '.env');
  if (existsSync(destination)) return false;
  const template = readFileSync(path.join(root, '.env.example'), 'utf8')
    .replace('replace-with-local-app-password', randomBytes(24).toString('hex'))
    .replace(
      'replace-with-local-root-password',
      randomBytes(24).toString('hex'),
    );
  writeFileSync(destination, template, { flag: 'wx', mode: 0o600 });
  return true;
}

function ensureFrontend(frontendPath, repoUrl, runCommand = run) {
  if (!existsSync(frontendPath)) {
    console.log(`Cloning the frontend into ${frontendPath}...`);
    runCommand('git', ['clone', '--', repoUrl, frontendPath]);
  } else {
    console.log(`Using existing frontend at ${frontendPath}; no Git changes.`);
  }

  const required = [
    '.git',
    'package.json',
    'package-lock.json',
    'vite.config.js',
    'index.html',
    'src',
    'public',
  ];
  for (const entry of required) {
    if (!existsSync(path.join(frontendPath, entry)))
      throw new Error(
        `Frontend is missing ${entry}. Check FRONTEND_DIR; existing files were not replaced.`,
      );
  }
  const pkg = JSON.parse(
    readFileSync(path.join(frontendPath, 'package.json'), 'utf8'),
  );
  if (pkg.name !== 'opentexila-frontend' || !pkg.scripts?.dev)
    throw new Error(
      'FRONTEND_DIR must point to the OpenTexila frontend repository.',
    );
}

function main() {
  const action = process.argv[2] || 'up';
  if (!['up', 'down', 'logs'].includes(action))
    throw new Error('Usage: node scripts/stack.js [up|down|logs]');
  const root = path.resolve(__dirname, '..');
  run('docker', ['compose', 'version']);
  if (action === 'up') {
    run('docker', ['info'], { stdio: 'ignore' });
    if (ensureEnvironment(root))
      console.log('Created backend/.env with random local database passwords.');
  }
  const envPath = path.join(root, '.env');
  const env = {
    ...(existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {}),
    ...process.env,
  };
  // Resolve from the backend checkout, regardless of the caller's directory.
  env.FRONTEND_DIR = path.resolve(root, env.FRONTEND_DIR || '../frontend');
  if (action === 'up') {
    ensureFrontend(
      env.FRONTEND_DIR,
      env.FRONTEND_REPO_URL || DEFAULT_FRONTEND_REPO,
    );
  }
  const args = {
    up: ['up', '--build', '-d', '--wait', '--wait-timeout', '180'],
    down: ['down'],
    logs: ['logs', '-f', '--tail', '100'],
  }[action];
  run('docker', ['compose', ...args], { cwd: root, env });
  if (action === 'up') {
    console.log(
      `Frontend: http://localhost:${env.FRONTEND_DEV_PORT || '5173'}`,
    );
    console.log(`API: http://localhost:${env.BACKEND_PORT || '3000'}/api/v1`);
    console.log('Use npm run stack:logs for logs; npm run stack:down to stop.');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Stack setup failed: ${error.message}`);
    console.error(
      'See docs/DOCKER.md. Existing checkouts and database volumes are preserved.',
    );
    process.exitCode = 1;
  }
}

module.exports = { ensureEnvironment, ensureFrontend };

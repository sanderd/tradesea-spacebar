import replace from '@rollup/plugin-replace';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

// ── Determine version from git tags ─────────────────────────────────
function getVersion() {
  try {
    const desc = execSync('git describe --tags --match "v*" --long', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    // Format: v2.7-5-gabcdef  →  2.7.5
    const m = desc.match(/^v(\d+\.\d+)-(\d+)-g/);
    if (m) return `${m[1]}.${m[2]}`;
  } catch (_) {}
  try {
    const count = execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim();
    return `0.0.${count}`;
  } catch (_) {}
  return '0.0.0-dev';
}

const isDev = process.env.BUILD === 'dev';
let version = getVersion();
if (isDev) {
  version += '-dev.' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

// ── Read the UserScript header from src/header.js ───────────────────
const header = readFileSync('src/header.js', 'utf8')
  .replace('{{VERSION}}', version);

export default {
  input: 'src/index.js',
  output: {
    file: 'dist/tradesea-spacebar.user.js',
    format: 'iife',
    banner: header,
    // No exports — the IIFE just runs
    name: undefined,
    // Prevent Rollup from adding 'use strict' (we add our own in the banner)
    strict: false,
  },
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        '__VERSION__': version,
      },
    }),
  ],
};

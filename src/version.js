// ─── Platform Version Check ─────────────────────────────────────────
// Shows a one-time warning popup when the host platform version
// is outside the known-compatible range.

import { log, warn } from './logging.js';
import { S } from './state.js';

const STORAGE_KEY = 'ts-spacebar-dismissed-version';

/**
 * Check if the platform version is compatible.
 * Shows a styled popup if it's outside the known-compatible range
 * and the user hasn't dismissed this major.minor version before.
 */
export function checkPlatformVersion() {
  const provider = S.provider;
  if (!provider?.getAppVersion || !provider.compatPrefix) return;

  const version = provider.getAppVersion();
  if (!version) return;

  log(`Platform version: ${version} (known: ${provider.knownVersion})`);

  // Compatible if version matches the known prefix (e.g. all 2.2.x.x)
  if (version.startsWith(provider.compatPrefix)) return;

  // Extract major.minor from detected version for dismiss tracking
  // "2.3.1.0" → "2.3."
  const parts = version.split('.');
  const versionPrefix = parts.length >= 2 ? `${parts[0]}.${parts[1]}.` : version;

  // Check if user already dismissed this major.minor
  try {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (dismissed === versionPrefix) return;
  } catch (_) {}

  warn(`Unknown platform version ${version} (expected ${provider.compatPrefix}x.x)`);
  _showWarningPopup(version, provider, versionPrefix);
}

function _showWarningPopup(version, provider, versionPrefix) {
  const overlay = document.createElement('div');
  overlay.id = 'ts-sb-version-warn';
  overlay.innerHTML = `
    <div class="ts-vw-backdrop"></div>
    <div class="ts-vw-dialog">
      <div class="ts-vw-icon">⚠️</div>
      <div class="ts-vw-title">Spacebar Trading — Version Notice</div>
      <div class="ts-vw-body">
        <p>The platform is running version <strong>${version}</strong>,
        which is newer than the last verified version <strong>${provider.knownVersion}</strong>.</p>
        <p>The script may still work, but some features could break if internal
        APIs have changed. Please report any issues.</p>
      </div>
      <div class="ts-vw-actions">
        <button class="ts-vw-btn ts-vw-dismiss" id="ts-vw-dismiss">Dismiss for all ${versionPrefix}x versions</button>
        <button class="ts-vw-btn ts-vw-close" id="ts-vw-close">Close</button>
      </div>
    </div>`;

  const style = document.createElement('style');
  style.textContent = `
    #ts-sb-version-warn { position:fixed; inset:0; z-index:999999; display:flex; align-items:center; justify-content:center; font-family:Inter,system-ui,sans-serif; }
    .ts-vw-backdrop { position:absolute; inset:0; background:rgba(0,0,0,0.6); backdrop-filter:blur(4px); }
    .ts-vw-dialog { position:relative; background:#1a1a2e; border:1px solid rgba(255,180,0,0.3); border-radius:12px; padding:28px 32px; max-width:460px; width:90%; box-shadow:0 8px 32px rgba(0,0,0,0.5); }
    .ts-vw-icon { font-size:32px; margin-bottom:8px; }
    .ts-vw-title { font-size:15px; font-weight:700; color:#ffb400; margin-bottom:14px; letter-spacing:0.3px; }
    .ts-vw-body { font-size:12.5px; color:#bbb; line-height:1.6; }
    .ts-vw-body strong { color:#fff; }
    .ts-vw-body p { margin:0 0 8px; }
    .ts-vw-actions { display:flex; gap:10px; margin-top:20px; }
    .ts-vw-btn { flex:1; padding:9px 14px; border-radius:8px; border:1px solid rgba(255,255,255,0.12); font-size:11.5px; font-weight:600; cursor:pointer; transition:all 0.15s; font-family:inherit; }
    .ts-vw-dismiss { background:rgba(255,180,0,0.15); color:#ffb400; }
    .ts-vw-dismiss:hover { background:rgba(255,180,0,0.25); }
    .ts-vw-close { background:rgba(255,255,255,0.06); color:#999; }
    .ts-vw-close:hover { background:rgba(255,255,255,0.12); color:#ccc; }
  `;

  document.head.appendChild(style);
  document.body.appendChild(overlay);

  const remove = () => { overlay.remove(); style.remove(); };

  overlay.querySelector('#ts-vw-close').addEventListener('click', remove);
  overlay.querySelector('#ts-vw-dismiss').addEventListener('click', () => {
    try { localStorage.setItem(STORAGE_KEY, versionPrefix); } catch (_) {}
    log(`Version warning dismissed for ${versionPrefix}x.x`);
    remove();
  });
  overlay.querySelector('.ts-vw-backdrop').addEventListener('click', remove);
}

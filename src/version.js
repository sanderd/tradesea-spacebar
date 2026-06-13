// ─── Platform Version Check ─────────────────────────────────────────
// Shows a warning popup when the host platform version differs from the
// last verified version. The user chooses how broadly to dismiss.

import { log, warn } from './logging.js';
import { S } from './state.js';

const STORAGE_KEY = 'ts-spacebar-dismissed-version';

/**
 * Check if the platform version matches the last known version.
 * Any change triggers a popup — the user picks their dismiss scope:
 *   • exact version only
 *   • all minor updates (same major.minor prefix)
 */
export function checkPlatformVersion() {
  const provider = S.provider;
  if (!provider?.getAppVersion || !provider.knownVersion) return;

  const version = provider.getAppVersion();
  if (!version) return;

  log(`Platform version: ${version} (known: ${provider.knownVersion})`);

  // Exact match — nothing to warn about
  if (version === provider.knownVersion) return;

  // Check if user previously dismissed this version or prefix
  try {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (dismissed && (dismissed === version || version.startsWith(dismissed))) return;
  } catch (_) {}

  warn(`Platform version changed: ${version} (script verified on ${provider.knownVersion})`);
  _showWarningPopup(version, provider);
}

function _showWarningPopup(version, provider) {
  // Derive major.minor prefix from the detected version: "2.3.1.0" → "2.3."
  const parts = version.split('.');
  const minorPrefix = parts.length >= 2 ? `${parts[0]}.${parts[1]}.` : null;

  const overlay = document.createElement('div');
  overlay.id = 'ts-sb-version-warn';
  overlay.innerHTML = `
    <div class="ts-vw-backdrop"></div>
    <div class="ts-vw-dialog">
      <div class="ts-vw-icon">⚠️</div>
      <div class="ts-vw-title">Spacebar Trading — Version Notice</div>
      <div class="ts-vw-body">
        <p>The platform is running version <strong>${version}</strong>,
        which differs from the last verified version <strong>${provider.knownVersion}</strong>.</p>
        <p>The script may still work, but some features could break if internal
        APIs have changed. Please report any issues.</p>
      </div>
      <div class="ts-vw-actions">
        ${minorPrefix ? `<button class="ts-vw-btn ts-vw-minor" id="ts-vw-minor">Allow all ${minorPrefix}x updates</button>` : ''}
        <button class="ts-vw-btn ts-vw-exact" id="ts-vw-exact">Allow ${version}</button>
        <button class="ts-vw-btn ts-vw-close" id="ts-vw-close">Close</button>
      </div>
    </div>`;

  const style = document.createElement('style');
  style.textContent = `
    #ts-sb-version-warn { position:fixed; inset:0; z-index:999999; display:flex; align-items:center; justify-content:center; font-family:Inter,system-ui,sans-serif; }
    .ts-vw-backdrop { position:absolute; inset:0; background:rgba(0,0,0,0.6); backdrop-filter:blur(4px); }
    .ts-vw-dialog { position:relative; background:#1a1a2e; border:1px solid rgba(255,180,0,0.3); border-radius:12px; padding:28px 32px; max-width:480px; width:90%; box-shadow:0 8px 32px rgba(0,0,0,0.5); }
    .ts-vw-icon { font-size:32px; margin-bottom:8px; }
    .ts-vw-title { font-size:15px; font-weight:700; color:#ffb400; margin-bottom:14px; letter-spacing:0.3px; }
    .ts-vw-body { font-size:12.5px; color:#bbb; line-height:1.6; }
    .ts-vw-body strong { color:#fff; }
    .ts-vw-body p { margin:0 0 8px; }
    .ts-vw-actions { display:flex; gap:8px; margin-top:20px; flex-wrap:wrap; }
    .ts-vw-btn { flex:1; min-width:120px; padding:9px 14px; border-radius:8px; border:1px solid rgba(255,255,255,0.12); font-size:11px; font-weight:600; cursor:pointer; transition:all 0.15s; font-family:inherit; }
    .ts-vw-minor { background:rgba(255,180,0,0.15); color:#ffb400; }
    .ts-vw-minor:hover { background:rgba(255,180,0,0.25); }
    .ts-vw-exact { background:rgba(100,200,255,0.1); color:#6ac4ff; border-color:rgba(100,200,255,0.2); }
    .ts-vw-exact:hover { background:rgba(100,200,255,0.2); }
    .ts-vw-close { background:rgba(255,255,255,0.06); color:#999; }
    .ts-vw-close:hover { background:rgba(255,255,255,0.12); color:#ccc; }
  `;

  document.head.appendChild(style);
  document.body.appendChild(overlay);

  const remove = () => { overlay.remove(); style.remove(); };

  overlay.querySelector('#ts-vw-close').addEventListener('click', remove);

  overlay.querySelector('#ts-vw-exact')?.addEventListener('click', () => {
    try { localStorage.setItem(STORAGE_KEY, version); } catch (_) {}
    log(`Version warning dismissed for exact version ${version}`);
    remove();
  });

  overlay.querySelector('#ts-vw-minor')?.addEventListener('click', () => {
    try { localStorage.setItem(STORAGE_KEY, minorPrefix); } catch (_) {}
    log(`Version warning dismissed for all ${minorPrefix}x versions`);
    remove();
  });

  overlay.querySelector('.ts-vw-backdrop').addEventListener('click', remove);
}

// ─── Account Nickname System ────────────────────────────────────────
import { log, warn } from './logging.js';
import { S } from './state.js';
import { saveConfig } from './config.js';

// ─── Account Nicknames ────────────────────────────────────────────

function getNicknameMap() {
  return (S.userConfig && S.userConfig.accountNicknames) ? S.userConfig.accountNicknames : {};
}

function getNickname(brokerName, accountName) {
  const key = brokerName + ':' + accountName;
  return getNicknameMap()[key] || null;
}

function setNickname(brokerName, accountName, nickname) {
  if (!S.userConfig) return;
  if (!S.userConfig.accountNicknames) S.userConfig.accountNicknames = {};
  const map = S.userConfig.accountNicknames;
  const key = brokerName + ':' + accountName;
  if (!nickname) {
    delete map[key];
  } else {
    // Check if this nickname is already in use by another account
    for (const [k, v] of Object.entries(map)) {
      if (v === nickname && k !== key) {
        // Steal the nickname from the other account
        delete map[k];
        log(`Nickname "${nickname}" taken from ${k}`);
        break;
      }
    }
    map[key] = nickname;
  }
  saveConfig(S.userConfig);
  log(`Nickname set: ${key} → "${nickname || '(cleared)'}"`);
  // Auto-refresh display
  forceRefreshNicknames();
}

function clearAllNicknames() {
  if (!S.userConfig) return;
  S.userConfig.accountNicknames = {};
  saveConfig(S.userConfig);
  log('All nicknames cleared');
  forceRefreshNicknames();
}

/**
 * Force a full re-render of nickname UI by stripping all processed markers
 * and re-running applyNicknames().
 */
function forceRefreshNicknames() {
  // Remove our header nickname sibling elements and unhide original spans
  document.querySelectorAll('.ts-header-nick').forEach(el => el.remove());
  // Restore visibility on any original spans we hid
  document.querySelectorAll('div[class*="font-semibold"] > span[style*="display: none"]').forEach(el => {
    el.style.display = '';
  });
  // Clear all processed markers so elements get re-processed
  document.querySelectorAll('[data-ts-header-processed]').forEach(el => {
    el.removeAttribute('data-ts-header-processed');
  });
  document.querySelectorAll('.ts-nick-pencil').forEach(el => el.remove());
  // Reset name spans to their original text, then remove the cache attribute
  // so the next applyNicknames() call reads fresh DOM state
  document.querySelectorAll('[data-ts-original-name]').forEach(el => {
    const origName = el.dataset.tsOriginalName;
    el.textContent = origName; // Wipes any injected child elements
    el.removeAttribute('data-ts-original-name');
  });
  // Reset date spans we may have modified
  document.querySelectorAll('[data-ts-original-date]').forEach(el => {
    el.textContent = el.dataset.tsOriginalDate;
    el.removeAttribute('data-ts-original-date');
  });
  setTimeout(() => applyNicknames(), 30);
}

// ─── Nickname CSS ─────────────────────────────────────────────────
const NICKNAME_CSS = `
  .ts-nick-pencil {
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border-radius: 4px; border: none;
    background: transparent; color: #666; cursor: pointer;
    font-size: 12px; flex-shrink: 0; transition: all .15s;
    margin-left: 4px; padding: 0; vertical-align: middle;
  }
  .ts-nick-pencil:hover { background: rgba(255,0,255,0.15); color: #ff00ff; }
  .ts-nick-edit-input {
    padding: 2px 6px; border-radius: 4px;
    background: rgba(40,40,55,0.95); border: 1px solid rgba(255,0,255,0.4);
    color: #e0e0ec; font-size: 12px; font-family: inherit;
    outline: none; min-width: 80px; max-width: 160px;
  }
  .ts-nick-edit-input:focus { border-color: rgba(255,0,255,0.7); }
  .ts-nick-badge {
    color: #666; font-size: 0.85em; font-weight: 400;
    margin-left: 4px;
  }
  .ts-nick-name {
    font-weight: 500;
  }
`;

function injectNicknameCSS() {
  if (document.getElementById('ts-nick-style')) return;
  const style = document.createElement('style');
  style.id = 'ts-nick-style';
  style.textContent = NICKNAME_CSS;
  document.head.appendChild(style);
}

/**
 * Detect the currently active broker name from the account switcher
 * dropdown or from the header.
 */
function detectActiveBrokerFromSwitcher(container) {
  // Look for the active broker button inside the dropdown
  const brokerBtns = container.querySelectorAll('button');
  for (const btn of brokerBtns) {
    const span = btn.querySelector('span');
    if (!span) continue;
    // Active broker has distinctive styling (bg-primary or similar)
    if (btn.className.includes('primary') || btn.className.includes('accent')) {
      return span.textContent.trim();
    }
  }
  // Fallback: look in the header bar
  const headerChip = document.querySelector('[class*="chip"], [class*="badge"]');
  if (headerChip) return headerChip.textContent.trim();
  return null;
}

/**
 * Create a pencil button element.
 */
function createPencilBtn() {
  const btn = document.createElement('button');
  btn.className = 'ts-nick-pencil';
  btn.innerHTML = '&#9998;';  // ✎ pencil
  btn.title = 'Set nickname';
  btn.type = 'button';
  return btn;
}

/**
 * Start inline editing for a nickname.
 * @param {HTMLElement} nameContainer - The element holding the account name text
 * @param {string} brokerName - e.g. "FundedSeat"
 * @param {string} originalName - e.g. "6306351" or "Demo Account"
 * @param {Function} onDone - callback(newNickname) after editing
 */
function startNicknameEdit(nameContainer, brokerName, originalName, onDone) {
  // Prevent double-editing
  if (nameContainer.querySelector('.ts-nick-edit-input')) return;

  const currentNick = getNickname(brokerName, originalName);
  const input = document.createElement('input');
  input.className = 'ts-nick-edit-input';
  input.type = 'text';
  input.value = currentNick || '';
  input.placeholder = originalName;
  input.setAttribute('data-ts-nick-editing', 'true');

  // Replace content temporarily
  const savedHTML = nameContainer.innerHTML;
  nameContainer.textContent = '';
  nameContainer.appendChild(input);
  input.focus();
  input.select();

  function finish(save) {
    if (!input.parentNode) return; // already removed
    if (save) {
      const val = input.value.trim();
      setNickname(brokerName, originalName, val || null);
      // setNickname calls forceRefreshNicknames() automatically
    }
    nameContainer.innerHTML = savedHTML;
    if (onDone) onDone(save ? input.value.trim() : null);
  }

  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // Prevent spacebar trading etc.
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  // Prevent click-through to account switching
  input.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); });
  input.addEventListener('mousedown', (e) => { e.stopPropagation(); });
}

// ─── Account Switcher Nickname Injection ───────────────────────────

/**
 * Detect the active broker name from broker selector buttons.
 * In both the account switcher dropdown and account center sidebar,
 * broker buttons use class `rounded-4xl` and the selected one has
 * `bg-primary` in its class list.
 *
 * Broker chips come in two forms:
 *  - Text chip (Sandbox):     <div class="...bg-primary/10..."><span>Sandbox-2</span></div>
 *  - Image chip (FundedSeat): <div class="..."><img alt="FundedSeat" src="..."></div>
 */
function detectActiveBroker() {
  const brokerBtns = document.querySelectorAll('button[class*="rounded-4xl"]');
  for (const btn of brokerBtns) {
    if (!btn.className.includes('bg-primary')) continue;
    // Try text span first (Sandbox-style)
    const span = btn.querySelector('span');
    if (span && span.textContent.trim()) return span.textContent.trim();
    // Try image alt (FundedSeat-style)
    const img = btn.querySelector('img[alt]');
    if (img && img.alt.trim()) return img.alt.trim();
  }
  // Fallback: read from the collapsed header chip area
  // Try image alt first (more specific)
  const headerArea = document.querySelector('div[class*="cursor-pointer"][class*="rounded-xl"]');
  if (headerArea) {
    const img = headerArea.querySelector('img[alt]');
    if (img && img.alt.trim()) return img.alt.trim();
    // Try text span inside a chip (bg-primary)
    const chipSpan = headerArea.querySelector('[class*="bg-primary"] span');
    if (chipSpan && chipSpan.textContent.trim()) return chipSpan.textContent.trim();
  }
  // Last resort: any colored badge near the top
  const chip = document.querySelector('[class*="text-xs"][class*="rounded"][class*="bg-"]');
  if (chip) {
    const t = chip.textContent.trim();
    if (t) return t;
  }
  return 'Unknown';
}

/**
 * Process the account switcher dropdown to add nicknames and pencil icons.
 *
 * DOM structure (verified via browser inspection):
 *   <button class="h-16 w-full py-3 px-2 flex items-center border rounded-2xl ...">
 *     <div class="flex flex-col items-start">
 *       <div class="flex items-center gap-2">
 *         <span class="font-semibold text-sm ...">Demo Account</span>
 *       </div>
 *       <span class="font-normal text-sm ... text-text-muted">2/19/2026</span>
 *     </div>
 *     <div class="ml-auto ..."><span ...>Active</span></div>
 *   </button>
 */
function processAccountSwitcherDropdown() {
  // Account items in the dropdown are buttons with both rounded-2xl and w-full
  const acctBtns = document.querySelectorAll('button[class*="rounded-2xl"][class*="w-full"][class*="items-center"]');
  if (acctBtns.length === 0) return;

  const activeBroker = detectActiveBroker();

  for (const acctBtn of acctBtns) {
    // Skip if already processed
    if (acctBtn.querySelector('.ts-nick-pencil')) continue;
    // Skip non-account buttons (e.g. "+ CONNECT NEW")
    if (acctBtn.textContent.includes('CONNECT NEW')) continue;

    // The account name span is the font-semibold one
    const nameSpan = acctBtn.querySelector('span[class*="font-semibold"]');
    if (!nameSpan) continue;

    const rawText = nameSpan.textContent.trim();
    if (!rawText) continue;

    // Store original name as data attribute (first time only)
    if (!nameSpan.dataset.tsOriginalName) {
      nameSpan.dataset.tsOriginalName = rawText;
    }
    const storedOriginal = nameSpan.dataset.tsOriginalName;

    // The date/secondary span is the text-muted sibling
    const colDiv = nameSpan.closest('div[class*="flex-col"]');
    const dateSpan = colDiv?.querySelector('span[class*="text-text-muted"], span[class*="text-muted"]');

    const nick = getNickname(activeBroker, storedOriginal);
    if (nick) {
      // Display nickname as the primary name
      nameSpan.textContent = nick;
      // Show original name next to the date on the second line
      if (dateSpan) {
        if (!dateSpan.dataset.tsOriginalDate) {
          dateSpan.dataset.tsOriginalDate = dateSpan.textContent.trim();
        }
        dateSpan.innerHTML = `${dateSpan.dataset.tsOriginalDate} <span class="ts-nick-badge">(${storedOriginal})</span>`;
      }
    } else {
      nameSpan.textContent = storedOriginal;
      // Restore date span if it was modified
      if (dateSpan && dateSpan.dataset.tsOriginalDate) {
        dateSpan.textContent = dateSpan.dataset.tsOriginalDate;
      }
    }

    // Inject pencil button next to the name span
    const nameRow = nameSpan.closest('div[class*="flex"][class*="items-center"]');
    if (nameRow && !nameRow.querySelector('.ts-nick-pencil')) {
      const pencil = createPencilBtn();
      pencil.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        startNicknameEdit(nameSpan, activeBroker, storedOriginal, () => {
          forceRefreshNicknames();
        });
      });
      pencil.addEventListener('mousedown', (e) => e.stopPropagation());
      nameRow.appendChild(pencil);
    }
  }
}

/**
 * Update the account switcher trigger in the header bar to show nickname.
 * Actual DOM structure (collapsed state):
 *
 * Sandbox broker:
 *   <div class="flex items-center gap-1 rounded-xl cursor-pointer ...">
 *     <div class="text-xs font-semibold text-grey-700 flex items-center gap-2">
 *       <div class="flex gap-1 items-center">
 *         <div class="...bg-primary/10..."><span>Sandbox-2</span></div>  ← text chip
 *       </div>
 *       <span>Demo Account</span>  ← account name
 *     </div>
 *     <svg>...</svg>  ← dropdown caret
 *   </div>
 *
 * FundedSeat broker:
 *   <div class="flex items-center gap-1 rounded-xl cursor-pointer ...">
 *     <div class="text-xs font-semibold text-grey-700 flex items-center gap-2">
 *       <div class="flex items-center justify-center" style="width:16px;height:16px">
 *         <img alt="FundedSeat" src="...fundedSeat_dark.png">  ← image chip
 *       </div>
 *       <span>Account Name</span>  ← account name
 *     </div>
 *     <svg>...</svg>  ← dropdown caret
 *   </div>
 */
function updateAccountSwitcherHeader() {
  const DBG = (...a) => console.log('[TS-HEADER-DBG]', ...a);

  // Placeholders to skip — these appear briefly during page load
  const PLACEHOLDERS = ['select account', 'loading', 'connecting'];

  // Find the header trigger: div with cursor-pointer + rounded-xl in the top bar
  const triggers = document.querySelectorAll('div[class*="cursor-pointer"][class*="rounded-xl"]');
  let nameSpan = null;
  let semiboldDiv = null;

  for (const trigger of triggers) {
    const rect = trigger.getBoundingClientRect();
    if (rect.top > 50 || rect.height > 40) continue;

    const semibold = trigger.querySelector('div[class*="font-semibold"]');
    if (!semibold) continue;

    // Find the account name span — it's a direct <span> child of the semibold div
    // that is NOT inside a broker chip (bg-primary, bg-surface, etc.)
    // Also skip our own injected .ts-header-nick sibling
    const directSpans = Array.from(semibold.querySelectorAll(':scope > span'));
    nameSpan = directSpans.find(s => {
      if (s.classList.contains('ts-header-nick')) return false; // skip our sibling
      const chip = s.closest('[class*="bg-primary"], [class*="bg-surface"], [class*="rounded-4xl"]');
      return !chip || chip === semibold || chip.contains(semibold);
    });

    if (!nameSpan && directSpans.length > 0) {
      // Fallback: first direct span that isn't our injected sibling
      nameSpan = directSpans.find(s => !s.classList.contains('ts-header-nick'));
    }

    if (nameSpan) { semiboldDiv = semibold; break; }
  }

  if (!nameSpan || !semiboldDiv) {
    DBG('No account name span found in header');
    return;
  }

  // IMPORTANT: Always read from the ORIGINAL span's textContent.
  // We never modify this span's innerHTML, so React can freely update it.
  const accountName = nameSpan.textContent.trim();

  // Skip placeholders
  if (!accountName || PLACEHOLDERS.includes(accountName.toLowerCase())) {
    DBG('Skipping placeholder:', accountName);
    // Also remove any stale sibling if present
    const stale = semiboldDiv.querySelector('.ts-header-nick');
    if (stale) { stale.remove(); nameSpan.style.display = ''; }
    return;
  }

  // Detect broker
  const broker = detectActiveBroker();
  DBG('Lookup:', broker + ':' + accountName);

  const nick = getNickname(broker, accountName);

  // Find or create our sibling display element
  let nickEl = semiboldDiv.querySelector('.ts-header-nick');

  if (nick) {
    // Hide original span (React still controls it, just not visible)
    nameSpan.style.display = 'none';

    if (!nickEl) {
      // Create sibling span right after the original
      nickEl = document.createElement('span');
      nickEl.className = 'ts-header-nick';
      nameSpan.after(nickEl);
    }
    nickEl.innerHTML = `<span class="ts-nick-name">${nick}</span> <span class="ts-nick-badge">(${accountName})</span>`;
    DBG('→ Applied:', nick);
  } else {
    // No nickname — show original span, remove our sibling
    nameSpan.style.display = '';
    if (nickEl) { nickEl.remove(); }
    DBG('→ No nickname for', accountName);
  }
}

// ─── Account Center Nickname Injection ─────────────────────────────

/**
 * Process the account center table to add nicknames and pencil icons.
 *
 * DOM structure (verified):
 *   <tr class="h-14 border-t border-outline cursor-pointer ..." role="button">
 *     <td class="pl-3.5">
 *       <span class="font-normal text-sm font-sans text-text-secondary">Demo Account</span>
 *     </td>
 *     ...
 *   </tr>
 */
function processAccountCenterTable() {
  const activeBroker = detectActiveBroker();

  // Process table rows with role="button" (account data rows)
  const rows = document.querySelectorAll('tr[role="button"]');
  for (const row of rows) {
    const firstTd = row.querySelector('td:first-child');
    if (!firstTd) continue;

    const nameSpan = firstTd.querySelector('span');
    if (!nameSpan) continue;
    if (firstTd.querySelector('.ts-nick-pencil')) continue; // Already processed

    const rawText = nameSpan.textContent.trim();
    if (!rawText || rawText === 'Account Name') continue; // Skip header

    // Store original name
    if (!nameSpan.dataset.tsOriginalName) {
      nameSpan.dataset.tsOriginalName = rawText;
    }
    const storedOriginal = nameSpan.dataset.tsOriginalName;

    // Apply nickname display (in account center: "OriginalName (nickname)")
    const nick = getNickname(activeBroker, storedOriginal);
    if (nick) {
      nameSpan.innerHTML = `${storedOriginal} <span class="ts-nick-badge">(${nick})</span>`;
    } else {
      nameSpan.textContent = storedOriginal;
    }

    // Add pencil button — use flex layout on the td
    const pencil = createPencilBtn();
    pencil.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      startNicknameEdit(nameSpan, activeBroker, storedOriginal, () => {
        forceRefreshNicknames(); // Auto-refresh all displays
      });
    });
    pencil.addEventListener('mousedown', (e) => e.stopPropagation());
    firstTd.style.display = 'flex';
    firstTd.style.alignItems = 'center';
    firstTd.appendChild(pencil);
  }
}

// ─── Unified Nickname Applicator ───────────────────────────────────

function applyNicknames() {
  injectNicknameCSS();

  // Account switcher dropdown (if open — look for the rounded-2xl account btns)
  const switcherAccounts = document.querySelectorAll('button[class*="rounded-2xl"][class*="w-full"][class*="items-center"]');
  if (switcherAccounts.length > 0) {
    processAccountSwitcherDropdown();
  }

  // Header trigger nickname
  updateAccountSwitcherHeader();

  // Account center table (if on that page)
  if (window.location.pathname.includes('account-center')) {
    processAccountCenterTable();
  }
}

// ─── MutationObserver for Nickname Injection ───────────────────────
let _nicknameObserver = null;
let _nicknameDebounce = null;

function startNicknameObserver() {
  if (_nicknameObserver) return;
  injectNicknameCSS();

  _nicknameObserver = new MutationObserver(() => {
    // Debounce to avoid excessive processing
    if (_nicknameDebounce) clearTimeout(_nicknameDebounce);
    _nicknameDebounce = setTimeout(() => {
      // Don't process while editing
      if (document.querySelector('.ts-nick-edit-input')) return;
      applyNicknames();
    }, 150);
  });

  _nicknameObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Initial pass
  setTimeout(applyNicknames, 500);
  log('Nickname observer started');
}

function stopNicknameObserver() {
  if (_nicknameObserver) {
    _nicknameObserver.disconnect();
    _nicknameObserver = null;
  }
  if (_nicknameDebounce) {
    clearTimeout(_nicknameDebounce);
    _nicknameDebounce = null;
  }
}

export {
  getNicknameMap, getNickname, setNickname, clearAllNicknames,
  forceRefreshNicknames, detectActiveBroker,
  applyNicknames, startNicknameObserver, stopNicknameObserver,
};

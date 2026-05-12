// Quick encoding check
const fs = require('fs');
const c = fs.readFileSync('dist/tradesea-spacebar.user.js', 'utf8');

// Check for common UTF-8 mojibake patterns
const bad = ['\u00e2\u0080\u0093', '\u00e2\u0080\u0099', '\u00e2\u0086\u0092', '\u00e2\u009c\u0085', '\u00e2\u0095\u0090', '\u00e2\u0094\u0080'];
let found = false;
for (const b of bad) {
  if (c.includes(b)) {
    console.log('MOJIBAKE:', JSON.stringify(b));
    found = true;
  }
}

// Check for correct characters
const good = ['→', '✅', '═', '─'];
for (const g of good) {
  console.log(g, ':', c.includes(g) ? 'OK' : 'MISSING');
}

if (!found) console.log('\nNo mojibake detected!');

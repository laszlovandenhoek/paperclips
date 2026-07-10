// Static scanner: finds every bare-identifier assignment target across a set
// of ES5 source files (no let/const/arrow functions — this codebase is pure
// ES5 var/function). Used by harness.js to build the wrapper's predeclare
// prologue (see harness.js for why blanket predeclaration is the safe
// choice, not just the identifiers that are *never* `var`-declared anywhere).
'use strict';

const IDENT = '[A-Za-z_$][\\w$]*';

// Strip comments, string literals, and regex literals down to single spaces
// so the assignment/declaration regexes below don't false-match inside them.
// Distinguishing a regex literal from a division operator is the one
// genuinely ambiguous case; the heuristic here only needs to be correct for
// this codebase's actual style, not general JS.
function stripNonCode(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  function lastSignificant() {
    for (let j = out.length - 1; j >= 0; j--) {
      if (!/\s/.test(out[j])) return out[j];
    }
    return '';
  }
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += ' ';
      i++;
      while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      i++;
      out += ' ';
      continue;
    }
    if (c === '/') {
      const ls = lastSignificant();
      const regexOk = ls === '' || '([{,;=:!&|?+-*%^~<>'.includes(ls) ||
        /\breturn$/.test(out) || /\btypeof$/.test(out);
      if (regexOk) {
        let j = i + 1;
        let inClass = false;
        while (j < n) {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') inClass = true;
          else if (src[j] === ']') inClass = false;
          else if (src[j] === '/' && !inClass) break;
          else if (src[j] === '\n') break;
          j++;
        }
        if (j < n && src[j] === '/') {
          j++;
          while (j < n && /[a-z]/i.test(src[j])) j++;
          out += ' ';
          i = j;
          continue;
        }
      }
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function findAssignedIdentifiers(code) {
  const assigned = new Set();
  const assignRe = new RegExp(
    `(?<![.\\w$])(${IDENT})\\s*(?:\\+\\+|--)|(?<![.\\w$])(${IDENT})\\s*(=[^=]|\\+=|-=|\\*=|/=|%=|\\*\\*=|<<=|>>=|>>>=|&=|\\|=|\\^=)`,
    'g'
  );
  let m;
  while ((m = assignRe.exec(code)) !== null) assigned.add(m[1] || m[2]);
  const forInRe = new RegExp(`for\\s*\\(\\s*(${IDENT})\\s+(?:in|of)\\s`, 'g');
  while ((m = forInRe.exec(code)) !== null) assigned.add(m[1]);
  return assigned;
}

const SHIMS = new Set([
  'document', 'window', 'localStorage', 'Audio', 'location', 'confirm', 'alert',
  'console', 'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout', 'Math',
  'JSON', 'Date', 'Object', 'Array', 'String', 'Number', 'Boolean', 'parseInt',
  'parseFloat', 'isNaN', 'isFinite', 'undefined', 'NaN', 'Infinity', 'RegExp',
  'Error', 'this', 'arguments', 'eval',
]);

// Returns the sorted list of identifiers to predeclare with `var` at the
// wrapper's top level: every bare-identifier assignment target across all
// given sources, minus JS/host globals. See harness.js for why this
// blanket set (rather than a precisely-scoped "truly undeclared" subset) is
// the correct thing to predeclare.
function collectPredeclareNames(sources) {
  const all = new Set();
  for (const src of sources) {
    const code = stripNonCode(src);
    for (const name of findAssignedIdentifiers(code)) all.add(name);
  }
  for (const s of SHIMS) all.delete(s);
  return [...all].sort();
}

module.exports = { collectPredeclareNames, stripNonCode, findAssignedIdentifiers, SHIMS };

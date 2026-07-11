// Headless Universal Paperclips simulator.
// Loads the UNMODIFIED game source from src/ as one big function-wrapper
// closure (no Node `vm` — vm's contextified sandbox intercepts every global
// variable access through C++, which measured ~1,600 ticks/sec; the plain
// closure below runs at native V8 speed). Provides a fake DOM, virtual-time
// scheduler, and seedable RNG. Player input is modeled as button clicks: a
// click only fires if the game itself has the button attached and enabled
// (buttonUpdate()/manageProjects() manage `disabled` every tick), so action
// legality is enforced by the game's own logic.
'use strict';

const fs = require('fs');
const path = require('path');
const { mulberry32, Scheduler, FakeDocument, FakeAudio, FakeLocalStorage } = require('./env');
const { collectPredeclareNames } = require('./scan-globals');

const SRC_DIR = path.join(__dirname, '..', 'src');
const LOAD_ORDER = ['combat.js', 'globals.js', 'projects.js', 'main.js']; // index2.html order
const TICK_MS = 10; // main loop interval

// Curated state snapshot for determinism checks / logging. Anything not listed
// is still reachable via sim.ctx.<name>.
const SNAPSHOT_VARS = [
  // core
  'ticks', 'clips', 'unusedClips', 'unsoldClips', 'clipRate', 'funds', 'margin', 'demand',
  'wire', 'wireCost', 'wireSupply', 'wireBasePrice', 'wirePurchase',
  'clipmakerLevel', 'megaClipperLevel', 'clipperBoost', 'megaClipperBoost', 'clipperCost', 'megaClipperCost',
  'marketingLvl', 'adCost', 'marketingEffectiveness', 'demandBoost',
  // compute
  'trust', 'nextTrust', 'processors', 'memory', 'standardOps', 'tempOps', 'creativity', 'creativityOn',
  'qClock', 'qChipCost', 'nextQchip',
  // engines
  'bankroll', 'investLevel', 'portfolioSize', 'riskiness', 'yomi', 'yomiBoost', 'tourneyCost', 'tourneyInProg',
  // phase flags
  'humanFlag', 'spaceFlag', 'milestoneFlag', 'compFlag', 'projectsFlag',
  // stage 2
  'factoryLevel', 'harvesterLevel', 'wireDroneLevel', 'farmLevel', 'batteryLevel',
  'factoryCost', 'harvesterCost', 'wireDroneCost', 'farmCost', 'batteryCost',
  'availableMatter', 'acquiredMatter', 'processedMatter', 'foundMatter', 'storedPower', 'powMod', 'momentum',
  'swarmFlag', 'swarmGifts', 'swarmStatus', 'sliderPos', 'boredomLevel', 'disorgCounter', 'nanoWire',
  // stage 3
  'probeCount', 'probeCost', 'probeTrust', 'probeUsedTrust', 'maxTrust', 'probeTrustCost',
  'probeSpeed', 'probeNav', 'probeRep', 'probeHaz', 'probeFac', 'probeHarv', 'probeWire', 'probeCombat',
  'drifterCount', 'probesLostHaz', 'probesLostDrift', 'probesLostCombat', 'honor', 'battleFlag',
  // endgame
  'dismantle', 'endTimer1', 'endTimer2', 'endTimer3', 'endTimer4', 'endTimer5', 'endTimer6', 'finalClips',
  'prestigeU', 'prestigeS',
];

// Params of the wrapper factory function. `__ids` carries the id->element
// map for browser "named access" replication (see buildFactory). Names are
// double-underscore-prefixed to keep them out of scan-globals's shadow.
const WRAPPER_PARAMS = [
  'document', 'window', 'localStorage', 'Audio', 'location', 'confirm', 'alert', 'console',
  'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout', 'Math', '__ids',
];

// HTML5 void elements: no closing tag, never push onto the nesting stack.
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

function tokenizeHtml(html) {
  // Returns [{type: 'open'|'close'|'selfclose', tag, attrs}] in document
  // order. Strips comments first — the old regex-only parser had no comment
  // awareness and would register ids from index2.html's several commented-out
  // debug/cheat blocks, which a real browser never renders at all.
  const stripped = html.replace(/<!--[\s\S]*?-->/g, '');
  const tokens = [];
  const tagRe = /<(\/?)([\w-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  const attrRe = /([\w-]+)\s*=\s*"([^"]*)"|([\w-]+)(?=[\s>])/g;
  let m;
  while ((m = tagRe.exec(stripped)) !== null) {
    const tag = m[2].toLowerCase();
    if (m[1] === '/') {
      tokens.push({ type: 'close', tag, attrs: {} });
      continue;
    }
    const attrs = {};
    let a;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(m[3])) !== null) {
      if (a[1] !== undefined) attrs[a[1]] = a[2];
      else if (a[3] !== undefined && !(a[3] in attrs)) attrs[a[3]] = '';
    }
    const isVoid = m[4] === '/' || VOID_TAGS.has(tag);
    tokens.push({ type: isVoid ? 'selfclose' : 'open', tag, attrs });
  }
  return tokens;
}

function parseHtmlTags(html) {
  // Flat [{tag, attrs}] for every opening (incl. self-closing/void) tag —
  // used where nesting doesn't matter (predeclare id collection). See
  // _buildDomFromHtml for the nesting-aware consumer of tokenizeHtml().
  return tokenizeHtml(html)
    .filter((t) => t.type !== 'close')
    .map((t) => ({ tag: t.tag, attrs: t.attrs }));
}

// Module-level cache: the wrapper source is parsed/compiled once (via
// indirect eval, so it runs in plain global scope) and reused as a factory
// function. Each `new Sim()` just *calls* that factory, which is a fresh
// execution — fresh closure variables — so instances stay fully isolated
// despite sharing compiled bytecode.
let cachedFactory = null;
let cachedSrcDir = null;

function buildFactory(srcDir) {
  const fileSources = LOAD_ORDER.map((f) => fs.readFileSync(path.join(srcDir, f), 'utf8'));
  const predeclare = collectPredeclareNames(fileSources);

  const html = fs.readFileSync(path.join(srcDir, 'index2.html'), 'utf8');
  const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
  const idNames = new Set();
  for (const { tag, attrs } of parseHtmlTags(html)) {
    if (attrs.id && IDENT_RE.test(attrs.id)) idNames.add(attrs.id);
  }

  // Declare+initialize id-backed names from __ids (browser named access);
  // predeclare the rest bare. If the game later has its own top-level
  // `var sameName = ...;` for a name in either group, that's a legal
  // redeclaration in the same scope — its assignment naturally overwrites
  // the id-element placeholder in source order, exactly matching real
  // browser behavior (confirmed collisions in this game: adCost,
  // batteryCost, batteryLevel are both element ids and state variables).
  const predeclareOnly = predeclare.filter((n) => !idNames.has(n));
  const declParts = [];
  for (const id of idNames) declParts.push(`${id} = __ids[${JSON.stringify(id)}]`);
  for (const name of predeclareOnly) declParts.push(name);

  // Deliberately NOT strict mode: the original source has no "use strict"
  // anywhere and, in at least one place (combat.js createBattle() calling
  // `Battle()` without `new`), relies on sloppy-mode `this` defaulting to
  // the global object rather than throwing. Implicit-global safety doesn't
  // depend on strict mode here — every bare assignment target is already
  // predeclared with `var` above, so sloppy-mode "helpfully" creating a
  // global for an undeclared identifier never actually triggers.
  let src = `(function(${WRAPPER_PARAMS.join(',')}) {\n`;
  if (declParts.length) src += `var ${declParts.join(',')};\n`;
  for (let i = 0; i < LOAD_ORDER.length; i++) {
    src += `\n//region ${LOAD_ORDER[i]}\n${fileSources[i]}\n//endregion\n`;
  }
  src += '\nreturn {\n';
  src += '  get: function(__expr){ return eval(__expr); },\n';
  src += '  set: function(__expr, __val){ return eval(__expr + " = __val"); },\n';
  src += '  call: function(__code){ return eval(__code); },\n';
  src += `  snap: function(){ return {${SNAPSHOT_VARS.map((v) => `${v}:${v}`).join(',')}}; }\n`;
  src += '};\n})';

  // Indirect eval: compiles in global scope, independent of this module's
  // closure. One-time cost; every `new Sim()` after this just calls the
  // resulting function.
  return (0, eval)(src); // eslint-disable-line no-eval
}

function getFactory(srcDir) {
  if (cachedFactory && cachedSrcDir === srcDir) return cachedFactory;
  cachedFactory = buildFactory(srcDir);
  cachedSrcDir = srcDir;
  return cachedFactory;
}

let toLocaleStringPatched = false;
function patchToLocaleString() {
  if (toLocaleStringPatched) return;
  // Display-only in the game but very slow in Node; this is a real,
  // process-wide mutation of Number.prototype (can't be scoped per-Sim),
  // so it's applied once and is idempotent.
  Number.prototype.toLocaleString = function () { return String(this); }; // eslint-disable-line no-extend-native
  toLocaleStringPatched = true;
}

class Sim {
  constructor({ seed = 1, fastFormat = true, localStorageData = null, srcDir = SRC_DIR } = {}) {
    this.seed = seed;
    this.scheduler = new Scheduler();
    this.document = new FakeDocument();
    this.localStorage = new FakeLocalStorage(localStorageData);
    this.resetRequested = false;
    this.messages = []; // {t, msg} from displayMessage
    this.htmlOnclick = new Map(); // button id -> onclick source string
    this._clickFns = new Map(); // id -> compiled closure

    this._buildDomFromHtml(path.join(srcDir, 'index2.html'));

    if (fastFormat) patchToLocaleString();

    const ids = Object.create(null);
    for (const el of this.document._registry.values()) ids[el.id] = el;

    const rng = mulberry32(seed);
    const mathShim = Object.create(null);
    for (const k of Object.getOwnPropertyNames(Math)) {
      const v = Math[k];
      mathShim[k] = typeof v === 'function' ? v.bind(Math) : v;
    }
    mathShim.random = rng;

    const simRef = this;
    const setIntervalShim = (fn, ms) => this.scheduler.setInterval(fn, ms);
    const setTimeoutShim = (fn, ms) => this.scheduler.setTimeout(fn, ms);
    const clearIntervalShim = (id) => this.scheduler.clear(id);
    const clearTimeoutShim = (id) => this.scheduler.clear(id);
    const windowShim = { setInterval: setIntervalShim }; // only window.setInterval is used in src/

    const factory = getFactory(srcDir);
    this._api = factory(
      this.document, windowShim, this.localStorage, FakeAudio,
      { reload: () => { simRef.resetRequested = true; } },
      () => true, () => {}, console,
      setIntervalShim, setTimeoutShim, clearIntervalShim, clearTimeoutShim,
      mathShim, ids
    );

    this.ctx = new Proxy({}, {
      get: (_t, prop) => (typeof prop === 'string' ? this._api.get(prop) : undefined),
      set: (_t, prop, value) => {
        if (typeof prop === 'string') this._api.set(prop, value);
        return true;
      },
      has: (_t, prop) => typeof prop === 'string',
    });

    // Capture narrative messages (useful for tests/debugging); keep original behavior.
    const origDisplayMessage = this._api.get('displayMessage');
    this._api.set('displayMessage', function (msg) {
      simRef.messages.push({ t: simRef.scheduler.now, msg: String(msg) });
      return origDisplayMessage.call(this, msg);
    });

    this.document._loadPhase = false;
  }

  // Builds a REAL parent/child tree (not a flat body-children list) — needed
  // so ancestor-chain visibility checks (bot/adapters/*'s isVisible(), used
  // to catch sections gated purely by a container's `style.display`, like
  // the tournament UI before Strategic Modeling — see git history) see the
  // same structure a real browser would. Stack-based: 'open' pushes,
  // 'close' pops back to the nearest matching ancestor (tolerant of
  // mismatched/unclosed tags — searches for a match rather than assuming
  // perfect balance, and simply no-ops if none is found).
  _buildDomFromHtml(htmlPath) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    let currentSelect = null;
    const stack = [this.document.body]; // stack[0] is the permanent root
    for (const tok of tokenizeHtml(html)) {
      const { type, tag, attrs } = tok;
      if (type === 'close') {
        if (tag === 'body') continue; // never pop the root
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].tagName.toLowerCase() === tag) {
            stack.length = i;
            break;
          }
        }
        continue;
      }
      if (tag === 'html' || tag === 'head' || tag === 'body' || tag === 'script' || tag === 'link' || tag === 'meta') continue;

      const parent = stack[stack.length - 1];
      let el = null;
      if (attrs.id) {
        // NOT this.document.getElementById(): during _loadPhase (true for
        // the entire duration of this method — it's only cleared once the
        // game scripts have also finished running) getElementById() has a
        // tolerance fallback that auto-creates ANY missing id as a flat
        // child of body (see env.js) — meant for ids the HTML parse missed
        // entirely, but it silently fires on every id's first occurrence
        // right here too, which defeated the nesting this method exists to
        // build (every element ended up flat under body regardless of the
        // stack). Read the registry directly to skip that fallback.
        el = this.document._registry.get(attrs.id) || null;
        if (!el) {
          el = this.document.createElement(tag);
          el.setAttribute('id', attrs.id);
          parent.appendChild(el);
        }
        if ('disabled' in attrs) el.disabled = true;
        if ('value' in attrs) el.value = attrs.value;
        if (attrs.onclick) this.htmlOnclick.set(attrs.id, attrs.onclick);
      } else {
        // No id, but still a real node in the tree — needed so id'd
        // descendants nest under the correct (possibly hidden) ancestor.
        el = this.document.createElement(tag);
        parent.appendChild(el);
      }
      if (tag === 'select') currentSelect = el;
      if (tag === 'option' && currentSelect && currentSelect.value === '' && 'value' in attrs) {
        currentSelect.value = attrs.value; // browser default: first option selected
      }
      if (type === 'open') stack.push(el);
    }
  }

  // --- time -------------------------------------------------------------------
  get now() { return this.scheduler.now; }
  tick(n = 1) { this.scheduler.advanceTo(this.scheduler.now + n * TICK_MS); }
  runSeconds(s) { this.tick(Math.round(s * 100)); }

  // --- input ------------------------------------------------------------------
  // Click a button by element id. Fires only if the element is attached and
  // enabled — same conditions under which a real player could click it.
  click(id) {
    const el = this.document.getElementById(id);
    if (!el || el.disabled) return false;
    if (typeof el.onclick === 'function') { el.onclick(); return true; }
    const code = this.htmlOnclick.get(id);
    if (!code) return false;
    let fn = this._clickFns.get(id);
    if (!fn) {
      fn = this._api.call(`(function(){${code}})`);
      this._clickFns.set(id, fn);
    }
    fn();
    return true;
  }
  clickProject(n) { return this.click(`projectButton${n}`); }
  projectAvailable(n) {
    const el = this.document.getElementById(`projectButton${n}`);
    return !!el && !el.disabled;
  }
  setValue(id, value) {
    const el = this.document.getElementById(id);
    if (!el) throw new Error(`setValue: no element ${id}`);
    el.value = String(value);
  }
  // Arbitrary expression/statement in game scope (read or call anything).
  eval(code) { return this._api.call(code); }

  // --- state ------------------------------------------------------------------
  snapshot() { return this._api.snap(); }
}

module.exports = { Sim, SNAPSHOT_VARS, TICK_MS };

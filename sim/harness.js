// Headless Universal Paperclips simulator.
// Loads the UNMODIFIED game source from src/ into a Node vm context with a fake
// DOM, virtual-time scheduler, and seedable RNG. Player input is modeled as
// button clicks: a click only fires if the game itself has the button attached
// and enabled (buttonUpdate()/manageProjects() manage `disabled` every tick),
// so action legality is enforced by the game's own logic.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { mulberry32, Scheduler, FakeDocument, FakeAudio, FakeLocalStorage } = require('./env');

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

function parseHtmlButtons(html) {
  // Returns [{tag, attrs}] for every opening tag; tolerant of newlines and
  // `id = "..."` spacing used throughout index2.html.
  const tags = [];
  const tagRe = /<(\w+)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  const attrRe = /([\w-]+)\s*=\s*"([^"]*)"|([\w-]+)(?=[\s>])/g;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const attrs = {};
    let a;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(m[2])) !== null) {
      if (a[1] !== undefined) attrs[a[1]] = a[2];
      else if (a[3] !== undefined && !(a[3] in attrs)) attrs[a[3]] = '';
    }
    tags.push({ tag: m[1].toLowerCase(), attrs });
  }
  return tags;
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
    this._clickScripts = new Map(); // id -> vm.Script

    this._buildDomFromHtml(path.join(srcDir, 'index2.html'));

    const sandbox = {
      document: this.document,
      localStorage: this.localStorage,
      Audio: FakeAudio,
      location: { reload: () => { this.resetRequested = true; } },
      confirm: () => true,
      alert: () => {},
      console,
      setInterval: (fn, ms) => this.scheduler.setInterval(fn, ms),
      setTimeout: (fn, ms) => this.scheduler.setTimeout(fn, ms),
      clearInterval: (id) => this.scheduler.clear(id),
      clearTimeout: (id) => this.scheduler.clear(id),
      __rng: mulberry32(seed),
    };
    sandbox.window = sandbox;

    // Browser named access: every element with an id is reachable as a global
    // variable, unless a script-declared global of the same name exists (var
    // declarations shadow named access — load order gives the same result here).
    const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
    const exposeElement = (el) => {
      if (IDENT_RE.test(el.id) && !(el.id in sandbox)) sandbox[el.id] = el;
    };
    for (const el of this.document._registry.values()) exposeElement(el);
    this.document._onRegister = exposeElement;

    this.ctx = vm.createContext(sandbox);

    // Must run before game scripts: top-level code calls Math.random /
    // toLocaleString (e.g. priceTag strings) during load.
    vm.runInContext('Math.random = __rng;', this.ctx);
    if (fastFormat) {
      // toLocaleString is display-only in the game but very slow in Node.
      vm.runInContext('Number.prototype.toLocaleString = function () { return String(this); };', this.ctx);
    }

    for (const file of LOAD_ORDER) {
      const code = fs.readFileSync(path.join(srcDir, file), 'utf8');
      vm.runInContext(code, this.ctx, { filename: file });
    }
    this.document._loadPhase = false;

    // Capture narrative messages (useful for tests/debugging); keep original behavior.
    const simRef = this;
    const origDisplayMessage = this.ctx.displayMessage;
    this.ctx.displayMessage = function (msg) {
      simRef.messages.push({ t: simRef.scheduler.now, msg: String(msg) });
      return origDisplayMessage.call(this, msg);
    };
  }

  _buildDomFromHtml(htmlPath) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    let currentSelect = null;
    for (const { tag, attrs } of parseHtmlButtons(html)) {
      if (tag === 'script' || tag === 'link' || tag === 'meta') continue;
      let el = null;
      if (attrs.id) {
        el = this.document.getElementById(attrs.id) || null;
        if (!el) {
          el = this.document.createElement(tag);
          el.setAttribute('id', attrs.id);
          this.document.body.appendChild(el);
        }
        if ('disabled' in attrs) el.disabled = true;
        if ('value' in attrs) el.value = attrs.value;
        if (attrs.onclick) this.htmlOnclick.set(attrs.id, attrs.onclick);
      }
      if (tag === 'select') currentSelect = el;
      if (tag === 'option' && currentSelect && currentSelect.value === '' && 'value' in attrs) {
        currentSelect.value = attrs.value; // browser default: first option selected
      }
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
    let script = this._clickScripts.get(id);
    if (!script) {
      script = new vm.Script(code, { filename: `onclick:${id}` });
      this._clickScripts.set(id, script);
    }
    script.runInContext(this.ctx);
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
  // Arbitrary expression in game scope (read or call anything).
  eval(code) { return vm.runInContext(code, this.ctx); }

  // --- state ------------------------------------------------------------------
  snapshot() {
    const out = {};
    for (const k of SNAPSHOT_VARS) out[k] = this.ctx[k];
    return out;
  }
}

module.exports = { Sim, SNAPSHOT_VARS, TICK_MS };

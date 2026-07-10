// Environment shim for running the unmodified game source (src/*.js) headlessly.
// Provides: fake DOM (only the surface the game touches), virtual-time scheduler,
// seedable RNG, localStorage, Audio, location. No game logic lives here.
'use strict';

// --- Seedable RNG (mulberry32) ---------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Virtual-time scheduler --------------------------------------------------
// Replaces setInterval/setTimeout. Time only advances via advanceTo(); due
// callbacks run in (dueTime, registrationId) order, like a browser event loop
// with zero execution time per callback.
class Scheduler {
  constructor() {
    this.now = 0;
    this.timers = new Map();
    this.nextId = 1;
  }
  _add(fn, ms, repeating) {
    const interval = Math.max(Number(ms) || 0, 1);
    const id = this.nextId++;
    this.timers.set(id, { id, fn, interval, due: this.now + interval, repeating });
    return id;
  }
  setInterval(fn, ms) { return this._add(fn, ms, true); }
  setTimeout(fn, ms) { return this._add(fn, ms, false); }
  clear(id) { this.timers.delete(id); }
  advanceTo(target) {
    for (;;) {
      let next = null;
      for (const t of this.timers.values()) {
        if (t.due <= target && (next === null || t.due < next.due || (t.due === next.due && t.id < next.id))) {
          next = t;
        }
      }
      if (!next) break;
      this.now = next.due;
      if (next.repeating) next.due += next.interval;
      else this.timers.delete(next.id);
      next.fn();
    }
    this.now = target;
  }
}

// --- Fake DOM ----------------------------------------------------------------
const CANVAS_CTX_STUB = new Proxy(
  {},
  {
    get(target, prop) {
      if (prop in target) return target[prop];
      return function () {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }
);

class FakeElement {
  constructor(tagName, doc, id) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this._doc = doc;
    this.id = id || '';
    this.children = [];
    this.parentNode = null;
    this._innerHTML = '';
    this.disabled = false;
    this.value = '';
    this.checked = false;
    this.width = 0;
    this.height = 0;
    this.onclick = null;
    this.attributes = {};
    this.style = { display: '', visibility: '', opacity: '', fontWeight: '', color: '' };
    if (id) doc._register(this);
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) {
    this._innerHTML = String(v);
    // Real DOM replaces children when innerHTML is assigned.
    for (const c of this.children) c.parentNode = null;
    this.children.length = 0;
  }
  get firstChild() { return this.children[0] || null; }
  get childNodes() { return this.children; }
  setAttribute(k, v) {
    this.attributes[k] = v;
    if (k === 'id') { this.id = v; this._doc._register(this); }
    if (k === 'disabled') this.disabled = true;
    if (k === 'value') this.value = v;
  }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child, ref) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i >= 0) this.children.splice(i, 0, child);
    else this.children.push(child);
    return child;
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i < 0) throw new Error(`removeChild: node not found (parent ${this.id || this.tagName}, child ${child.id || child.tagName})`);
    this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  getContext() { return CANVAS_CTX_STUB; }
  _isAttached() {
    let node = this;
    while (node) {
      if (node === this._doc.body) return true;
      node = node.parentNode;
    }
    return false;
  }
}

class FakeDocument {
  constructor() {
    this._registry = new Map();
    this._loadPhase = true;
    this._onRegister = null; // hook: mirrors browser named-access (window.<id> = element)
    this.body = null; // set below; FakeElement needs doc ref
    this.body = new FakeElement('body', this, '');
  }
  _register(el) {
    if (!el.id) return;
    this._registry.set(el.id, el);
    if (this._onRegister) this._onRegister(el);
  }
  getElementById(id) {
    const el = this._registry.get(id);
    if (el && (this._loadPhase || el._isAttached())) return el;
    if (this._loadPhase && !el) {
      // Tolerate ids referenced by the scripts at load time that our HTML
      // parse missed; in the browser these exist in index2.html.
      const created = new FakeElement('div', this, id);
      this.body.appendChild(created);
      return created;
    }
    return null;
  }
  createElement(tag) { return new FakeElement(tag, this, ''); }
  createTextNode(text) { return { nodeType: 3, nodeValue: String(text), parentNode: null }; }
}

// --- Misc browser stubs --------------------------------------------------------
class FakeAudio {
  constructor() { this.src = ''; }
  addEventListener(event, fn) { if (event === 'canplaythrough') fn(); }
  play() {}
  pause() {}
}

class FakeLocalStorage {
  constructor(initial) {
    this._map = new Map(initial || []);
  }
  getItem(k) { return this._map.has(k) ? this._map.get(k) : null; }
  setItem(k, v) { this._map.set(k, String(v)); }
  removeItem(k) { this._map.delete(k); }
  dump() { return [...this._map]; }
}

module.exports = { mulberry32, Scheduler, FakeElement, FakeDocument, FakeAudio, FakeLocalStorage };

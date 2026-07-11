// Adapter wrapping sim/harness.js's Sim for the autoplay policy. Runs at
// full simulator speed (no wall-clock rate limiting needed for correctness,
// but the 30 clicks/sec human-realistic cap - settled in ROUTES.md - is
// still enforced here, measured against the SIMULATOR's own virtual clock,
// so headless runs stay comparable to a real playthrough's click budget
// rather than silently assuming superhuman input.
'use strict';

const MIN_CLICK_INTERVAL_MS = 1000 / 30;

class SimAdapter {
  constructor(sim) {
    this.sim = sim;
    this._lastClickTime = -Infinity;
  }

  get(name) {
    return this.sim.ctx[name];
  }

  isClickable(id) {
    const el = this.sim.document.getElementById(id);
    return !!el && !el.disabled;
  }

  click(id) {
    const now = this.sim.now;
    if (now - this._lastClickTime < MIN_CLICK_INTERVAL_MS) return false;
    if (!this.isClickable(id)) return false;
    const ok = this.sim.click(id);
    if (ok) this._lastClickTime = now;
    return ok;
  }

  setValue(id, value) {
    this.sim.setValue(id, value);
  }

  now() {
    return this.sim.now;
  }
}

module.exports = { SimAdapter, MIN_CLICK_INTERVAL_MS };

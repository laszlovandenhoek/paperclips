// Adapter wrapping sim/harness.js's Sim for the autoplay policy. Runs at
// full simulator speed (no wall-clock rate limiting needed for correctness,
// but the 30 clicks/sec human-realistic cap - settled in ROUTES.md - is
// still enforced here, measured against the SIMULATOR's own virtual clock,
// so headless runs stay comparable to a real playthrough's click budget
// rather than silently assuming superhuman input.
'use strict';

const MIN_CLICK_INTERVAL_MS = 1000 / 30;

// Several sections of the page (tournament UI, investment engine, megaclippers,
// etc.) are gated purely by `el.style.display = "none"`/`""` on a CONTAINER
// element - NOT by disabling the button itself (main.js:1198-1206 is a typical
// example: strategyEngineFlag gates strategyEngineElement/tournamentManagement
// Element's display, while btnNewTournament/btnRunTournament's `.disabled` is
// managed separately, or not at all). A `.disabled`-only isClickable() check
// misses this entirely and will click buttons a real player couldn't even see
// yet - confirmed in practice: the bot was running tournaments before
// Strategic Modeling was purchased. Walk up parentNode checking every
// ancestor's inline style, matching how the game actually toggles visibility.
function isVisible(el) {
  let node = el;
  while (node) {
    if (node.style) {
      if (node.style.display === 'none') return false;
      if (node.style.visibility === 'hidden') return false;
    }
    node = node.parentNode;
  }
  return true;
}

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
    if (!el || el.disabled) return false;
    return isVisible(el);
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

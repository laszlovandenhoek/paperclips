// Adapter driving the REAL game page for the autoplay policy. Mirrors
// sim-adapter.js's interface exactly so bot/policy.js is unaware which one
// it's talking to. Rate-limited to 30 clicks/sec (human-realistic
// keyboard-repeat rate, settled in ROUTES.md), measured against real
// wall-clock time here (vs. the sim adapter's virtual clock).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PaperclipsBrowserAdapter = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MIN_CLICK_INTERVAL_MS = 1000 / 30;

  function BrowserAdapter(win) {
    this.win = win || window;
    this.doc = this.win.document;
    this._lastClickTime = -Infinity;
  }

  BrowserAdapter.prototype.get = function (name) {
    return this.win[name];
  };

  BrowserAdapter.prototype.isClickable = function (id) {
    var el = this.doc.getElementById(id);
    return !!el && !el.disabled;
  };

  BrowserAdapter.prototype.click = function (id) {
    var now = this.now();
    if (now - this._lastClickTime < MIN_CLICK_INTERVAL_MS) return false;
    if (!this.isClickable(id)) return false;
    this.doc.getElementById(id).click();
    this._lastClickTime = now;
    return true;
  };

  BrowserAdapter.prototype.setValue = function (id, value) {
    var el = this.doc.getElementById(id);
    if (el) el.value = String(value);
  };

  BrowserAdapter.prototype.now = function () {
    return (this.win.performance && this.win.performance.now) ? this.win.performance.now() : Date.now();
  };

  return { BrowserAdapter: BrowserAdapter, MIN_CLICK_INTERVAL_MS: MIN_CLICK_INTERVAL_MS };
});

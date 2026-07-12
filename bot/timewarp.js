// Fast-forward for the REAL game page. Loaded BEFORE the game scripts in
// index2.html, so every window.setInterval() the game registers (the 10ms
// main loop, the 100ms slow loop, the stock/strategy timers, blink effects,
// and the bot panel's own decision loop) is captured into a virtual
// scheduler instead of the browser's native one. A single native driver
// interval then advances a VIRTUAL clock at `speed` x real time and fires
// each captured callback the number of times it would have fired in that
// much game time - i.e. the whole game (and the bot driving it) genuinely
// runs faster, it isn't a skip-ahead cheat that teleports state.
//
// Honesty guarantee under load: if the CPU can't keep up (high speeds fire
// the 10ms main loop up to speed*100 times/sec), the frame budget runs out
// and the virtual clock is NOT advanced past the last executed callback -
// virtual time always equals executed game time, so the panel's game-time
// display and the 30-clicks-per-game-second budget (browser-adapter.js
// reads this clock when present) stay truthful; the page just runs below
// the requested multiplier.
(function () {
  'use strict';

  var realSetInterval = window.setInterval.bind(window);
  var timers = {};
  var nextId = 1;
  var speed = 1;
  var virtualNow = 0;
  // ~600 callbacks per 4ms frame = up to ~150k callbacks/sec ceiling, far
  // above what the game's ~10 registered intervals need even at 20x.
  var MAX_CALLBACKS_PER_FRAME = 600;

  window.setInterval = function (fn, ms) {
    var period = Math.max(Number(ms) || 0, 1);
    var id = nextId++;
    timers[id] = { fn: fn, period: period, due: virtualNow + period };
    return id;
  };
  window.clearInterval = function (id) { delete timers[id]; };

  var lastReal = performance.now();
  realSetInterval(function () {
    var nowReal = performance.now();
    var dt = nowReal - lastReal;
    lastReal = nowReal;
    // Background tabs throttle timers to ~1/sec; without this clamp,
    // returning to the tab would try to replay the whole absence in one
    // frame. Cap the real-time step instead (game time pauses with the tab).
    if (dt > 250) dt = 250;

    var target = virtualNow + dt * speed;
    var budget = MAX_CALLBACKS_PER_FRAME;
    while (budget > 0) {
      // Earliest-due-first across all timers keeps relative loop phase
      // (10ms main loop fires 10x per 100ms slow loop fire) exactly as the
      // native scheduler would.
      var bestId = null;
      var bestDue = Infinity;
      for (var id in timers) {
        if (timers[id].due < bestDue) { bestDue = timers[id].due; bestId = id; }
      }
      if (bestId === null || bestDue > target) break;
      var t = timers[bestId];
      virtualNow = bestDue;
      t.due += t.period;
      try { t.fn(); } catch (e) {
        // A throwing game callback shouldn't kill the whole scheduler
        // (native setInterval survives exceptions too).
      }
      budget--;
    }
    if (budget > 0) virtualNow = target;
  }, 4);

  window.PaperclipsTimeWarp = {
    setSpeed: function (s) { speed = Math.max(0, Number(s) || 1); },
    getSpeed: function () { return speed; },
    now: function () { return virtualNow; },
  };
})();

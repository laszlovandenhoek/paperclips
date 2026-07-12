// Side panel: renders the autoplay bot's status into #botPanel and drives
// the decision loop against the real page via BrowserAdapter. Loaded after
// main.js in index2.html, so all game globals already exist by the time
// this runs.
//
// Time model: if bot/timewarp.js is present (loaded before the game
// scripts), our own setInterval below is ALSO virtualized, so the decision
// cadence, the 30 clicks/sec budget (browser-adapter reads the virtual
// clock), and every game loop all scale together under fast-forward - a
// 10x run is behaviorally identical to a 1x run, just faster on the wall.
(function () {
  'use strict';

  var adapter = new PaperclipsBrowserAdapter.BrowserAdapter(window);
  var running = true;
  var logEntries = []; // {t, phase, reason, count}
  var MAX_LOG = 40;
  var DECISION_INTERVAL_MS = 50; // well under the 33.3ms click cap; clicks are still adapter-rate-limited
  var STATUS_INTERVAL_MS = 500; // milestones/epoch/wire redraw cadence

  var timeWarp = window.PaperclipsTimeWarp || null;
  var startGameMs = adapter.now();

  var toggleBtn = document.getElementById('botPanelToggle');
  var timerEl = document.getElementById('botTimerValue');
  var speedEl = document.getElementById('botSpeed');
  var epochEl = document.getElementById('botEpochValue');
  var wireEl = document.getElementById('botWireValue');
  var decisionPhaseEl = document.getElementById('botDecisionPhase');
  var decisionReasonEl = document.getElementById('botDecisionReason');
  var milestonesEl = document.getElementById('botMilestones');
  var logEl = document.getElementById('botLog');

  function formatElapsed(ms) {
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    return (h > 0 ? h + ':' + pad(m) : m) + ':' + pad(sec);
  }

  function updateToggleButton() {
    toggleBtn.textContent = running ? 'Running (click to pause)' : 'Paused (click to resume)';
    toggleBtn.className = running ? 'running' : 'paused';
  }

  toggleBtn.addEventListener('click', function () {
    running = !running;
    updateToggleButton();
  });
  updateToggleButton();

  if (speedEl) {
    if (timeWarp) {
      speedEl.addEventListener('change', function () {
        timeWarp.setSpeed(parseFloat(speedEl.value));
      });
    } else {
      speedEl.disabled = true;
      speedEl.title = 'timewarp.js not loaded';
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function renderLog() {
    var html = '';
    for (var i = logEntries.length - 1; i >= 0; i--) {
      var e = logEntries[i];
      var countSuffix = e.count > 1 ? ' <span class="t">(x' + e.count + ')</span>' : '';
      html += '<div class="entry"><span class="t">' + e.t + '</span>' +
        '<span class="phase">' + e.phase + '</span>' + escapeHtml(e.reason) + countSuffix + '</div>';
    }
    logEl.innerHTML = html;
  }

  // Milestones + epoch + wire reserve, straight from policy.status() - the
  // same data the headless runner prints as its split table, rendered live.
  function renderStatus() {
    var st;
    try { st = PaperclipsPolicy.status(adapter); } catch (e) { return; }

    epochEl.textContent = st.epoch;
    if (st.wire) {
      wireEl.textContent = 'wire: ' + (st.wire.minutes === Infinity ? 'inf' : st.wire.minutes.toFixed(1)) +
        ' min @ $' + st.wire.cost + ' (' + st.wire.verdict + ')';
    } else {
      wireEl.textContent = '';
    }

    var html = '<div class="label">Milestones (actual / target)</div>';
    for (var i = 0; i < st.milestones.length; i++) {
      var m = st.milestones[i];
      var cls, actual;
      if (m.reachedAtMs !== null) {
        var atSec = (m.reachedAtMs - startGameMs) / 1000;
        cls = atSec <= m.targetSec ? 'ms-ahead' : 'ms-behind';
        actual = formatElapsed(atSec * 1000);
      } else {
        cls = 'ms-pending';
        actual = '--';
      }
      html += '<div class="ms ' + cls + '"><span class="ms-name">' + escapeHtml(m.label) + '</span>' +
        '<span class="ms-times">' + actual + ' / ' + formatElapsed(m.targetSec * 1000) + '</span></div>';
    }
    milestonesEl.innerHTML = html;
  }

  function step() {
    timerEl.textContent = formatElapsed(adapter.now() - startGameMs) +
      (timeWarp && timeWarp.getSpeed() !== 1 ? ' (' + timeWarp.getSpeed() + 'x)' : '');

    if (!running) return;

    var result;
    try {
      result = PaperclipsPolicy.decide(adapter);
    } catch (e) {
      result = { action: 'wait', phase: 'error', reason: 'Policy threw: ' + e.message };
      running = false;
      updateToggleButton();
    }

    decisionPhaseEl.textContent = result.phase;
    decisionReasonEl.textContent = result.reason;
    if (result.action === 'wait') return;

    // Repeated identical actions (bootstrap clicking especially) would
    // otherwise fill the log with dozens of literally-identical lines -
    // collapse consecutive repeats into a counter instead.
    var t = formatElapsed(adapter.now() - startGameMs);
    var last = logEntries[logEntries.length - 1];
    if (last && last.phase === result.phase && last.reason === result.reason) {
      last.count = (last.count || 1) + 1;
      last.t = t;
    } else {
      logEntries.push({ t: t, phase: result.phase, reason: result.reason, count: 1 });
      if (logEntries.length > MAX_LOG) logEntries.shift();
    }
    renderLog();
  }

  setInterval(step, DECISION_INTERVAL_MS);
  setInterval(renderStatus, STATUS_INTERVAL_MS);
})();

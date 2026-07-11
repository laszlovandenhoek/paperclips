// Side panel: renders the autoplay bot's status into #botPanel and drives
// the decision loop against the real page via BrowserAdapter. Loaded after
// main.js in index2.html, so all game globals already exist by the time
// this runs.
(function () {
  'use strict';

  var adapter = new PaperclipsBrowserAdapter.BrowserAdapter(window);
  var running = true;
  var startTime = Date.now();
  var logEntries = []; // {t, phase, reason}
  var MAX_LOG = 40;
  var DECISION_INTERVAL_MS = 50; // well under the 33.3ms click cap; clicks are still adapter-rate-limited

  var toggleBtn = document.getElementById('botPanelToggle');
  var timerEl = document.getElementById('botTimerValue');
  var decisionPhaseEl = document.getElementById('botDecisionPhase');
  var decisionReasonEl = document.getElementById('botDecisionReason');
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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function step() {
    timerEl.textContent = formatElapsed(Date.now() - startTime);

    if (!running) return;

    var result;
    try {
      result = PaperclipsPolicy.decide(adapter);
    } catch (e) {
      result = { phase: 'error', reason: 'Policy threw: ' + e.message };
      running = false;
      updateToggleButton();
    }

    if (result.action === 'wait') {
      decisionPhaseEl.textContent = result.phase;
      decisionReasonEl.textContent = result.reason;
      return;
    }

    decisionPhaseEl.textContent = result.phase;
    decisionReasonEl.textContent = result.reason;

    // Repeated identical actions (bootstrap clicking especially) would
    // otherwise fill the log with dozens of literally-identical lines -
    // collapse consecutive repeats into a counter instead.
    var last = logEntries[logEntries.length - 1];
    if (last && last.phase === result.phase && last.reason === result.reason) {
      last.count = (last.count || 1) + 1;
      last.t = formatElapsed(Date.now() - startTime);
    } else {
      logEntries.push({ t: formatElapsed(Date.now() - startTime), phase: result.phase, reason: result.reason, count: 1 });
      if (logEntries.length > MAX_LOG) logEntries.shift();
    }
    renderLog();
  }

  setInterval(step, DECISION_INTERVAL_MS);
})();

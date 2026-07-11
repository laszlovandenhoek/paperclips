// Engine-agnostic autoplay policy for Universal Paperclips.
//
// Deliberately naive first pass (per user request: "doesn't have to be
// perfect in first go, we can iterate"). Goal is COMPLETENESS (reach
// credits) more than optimality. A handful of decisions are backed by the
// P3 always/never-take lemmas in ROUTES.md; everything else is a simple
// affordability-gated default, clearly labelled below as a placeholder for
// future iteration.
//
// Works against two adapters (bot/adapters/*), both exposing the same
// small interface:
//   get(name)                -> reads a game global by name (any name -
//                                the sim adapter proxies through the whole
//                                game closure scope, the browser adapter
//                                reads window[name] - both see the same
//                                variables the actual game code uses)
//   isClickable(id)           -> true if the element exists and isn't disabled
//   click(id)                 -> attempts a click; false if refused (missing/
//                                disabled/rate-limited). Rate limiting (the
//                                30 clicks/sec human-realistic cap settled in
//                                ROUTES.md) lives in the adapter, not here.
//   setValue(id, value)       -> sets an element's value (used for the
//                                tournament strategy <select>)
//
// UMD-style export: works via require() in Node and as a plain <script> in
// the browser (attaches to window.PaperclipsPolicy).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PaperclipsPolicy = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // --- P3 results this policy encodes directly -------------------------------
  // RevTracker (projectButton42): proven strict never-take (its only effect is
  // a display toggle - ROUTES.md P3). Accept (projectButton147): never taken
  // for a single completion (P1/C1 - prestige loop is dominated). Reject
  // (projectButton148): the only path to actually finishing, always prioritized.
  var NEVER_TAKE_PROJECTS = ['projectButton42'];
  var ACCEPT_ID = 'projectButton147';
  var REJECT_ID = 'projectButton148';

  // --- P3's adaptive tournament pick (analysis/tourney_exact.js, condensed) --
  // Exact E[score|grid] for each of the 8 strategies, given the currently
  // revealed payoff grid. Only RANDOM is stochastic per-move; the rest are
  // deterministic given the grid and/or move history, which collapses the
  // process to a 4-state (hMovePrev,vMovePrev) Markov chain - exactly
  // solvable, no sampling. See analysis/tourney_exact.js for the derivation
  // and analysis/tourney_adaptive.js for why grid-aware picking beats any
  // fixed strategy by ~24-48%. Kept as a self-contained copy here so this
  // file has no dependency on analysis/ and loads standalone in a browser.
  var STRAT_NAMES = ['RANDOM', 'A100', 'B100', 'GREEDY', 'GENEROUS', 'MINIMAX', 'TITFORTAT', 'BEATLAST'];
  var STRAT_N = 8;

  function findBiggestPayoff(aa, ab, ba, bb) {
    if (aa >= ab && aa >= ba && aa >= bb) return 1;
    if (ab >= aa && ab >= ba && ab >= bb) return 2;
    if (ba >= aa && ba >= ab && ba >= bb) return 3;
    return 4;
  }
  function whatBeatsLast(myPos, aa, ab, ba, bb, hMovePrev, vMovePrev) {
    var oppsPos = myPos === 1 ? 2 : 1;
    if (oppsPos === 1 && hMovePrev === 1) return aa > ba ? 1 : 2;
    if (oppsPos === 1 && hMovePrev === 2) return ab > bb ? 1 : 2;
    if (oppsPos === 2 && vMovePrev === 1) return aa > ba ? 1 : 2;
    return ab > bb ? 1 : 2;
  }
  function moveDist(idx, pos, aa, ab, ba, bb, hp, vp) {
    switch (idx) {
      case 0: return [[1, 0.5], [2, 0.5]];
      case 1: return [[1, 1]];
      case 2: return [[2, 1]];
      case 3: { var x3 = findBiggestPayoff(aa, ab, ba, bb); return [[x3 < 3 ? 1 : 2, 1]]; }
      case 4: { var x4 = findBiggestPayoff(aa, ab, ba, bb); return [[(x4 === 1 || x4 === 3) ? 1 : 2, 1]]; }
      case 5: { var x5 = findBiggestPayoff(aa, ab, ba, bb); return [[(x5 === 1 || x5 === 3) ? 2 : 1, 1]]; }
      case 6: return [[pos === 1 ? vp : hp, 1]];
      case 7: return [[whatBeatsLast(pos, aa, ab, ba, bb, hp, vp), 1]];
      default: throw new Error('bad strategy index');
    }
  }
  function payoff(hm, vm, aa, ab, ba, bb) {
    if (hm === 1 && vm === 1) return [aa, aa];
    if (hm === 1 && vm === 2) return [ab, ba];
    if (hm === 2 && vm === 1) return [ba, ab];
    return [bb, bb];
  }
  function pairingSequence() {
    var seq = [];
    var stratCounter = 0;
    for (var roundNum = 0; roundNum < STRAT_N * STRAT_N; roundNum++) {
      var h, v;
      if (roundNum < STRAT_N) { h = 0; v = roundNum; }
      else {
        stratCounter++;
        if (stratCounter >= STRAT_N) stratCounter -= STRAT_N;
        h = Math.floor(roundNum / STRAT_N); v = stratCounter;
      }
      seq.push([h, v]);
    }
    return seq;
  }
  var PAIRINGS = pairingSequence();

  function exactScoresForGrid(aa, ab, ba, bb) {
    var score = new Array(STRAT_N).fill(0);
    var dist = [[1, 0], [0, 0]];
    for (var p2 = 0; p2 < PAIRINGS.length; p2++) {
      var h = PAIRINGS[p2][0], v = PAIRINGS[p2][1];
      var posH = h === v ? 2 : 1;
      var posV = 2;
      for (var sub = 0; sub < 10; sub++) {
        var next = [[0, 0], [0, 0]];
        var evH = 0, evV = 0;
        for (var hp = 1; hp <= 2; hp++) {
          for (var vp = 1; vp <= 2; vp++) {
            var pr = dist[hp - 1][vp - 1];
            if (pr === 0) continue;
            var hMoves = moveDist(h, posH, aa, ab, ba, bb, hp, vp);
            var vMoves = moveDist(v, posV, aa, ab, ba, bb, hp, vp);
            for (var i1 = 0; i1 < hMoves.length; i1++) {
              for (var i2 = 0; i2 < vMoves.length; i2++) {
                var hm = hMoves[i1][0], ph = hMoves[i1][1];
                var vm = vMoves[i2][0], pv = vMoves[i2][1];
                var jp = pr * ph * pv;
                var pay = payoff(hm, vm, aa, ab, ba, bb);
                evH += jp * pay[0];
                evV += jp * pay[1];
                next[hm - 1][vm - 1] += jp;
              }
            }
          }
        }
        score[h] += evH;
        score[v] += evV;
        dist = next;
      }
    }
    return score;
  }

  // argmax_X E[score_X | grid] - see analysis/tourney_adaptive.js for why
  // this beats any fixed strategy (including always-BEATLAST) by ~24-48%.
  function bestPickForGrid(aa, ab, ba, bb) {
    var scores = exactScoresForGrid(aa, ab, ba, bb);
    var best = 0;
    for (var i = 1; i < STRAT_N; i++) if (scores[i] > scores[best]) best = i;
    return best;
  }

  // --- decision helpers --------------------------------------------------
  function act(adapter, id, phase, reason) {
    var ok = adapter.click(id);
    return { action: ok ? 'click' : 'blocked', target: id, phase: phase, reason: reason };
  }
  function actSetValue(adapter, id, value, phase, reason) {
    adapter.setValue(id, value);
    return { action: 'setValue', target: id, value: value, phase: phase, reason: reason };
  }
  function wait(phase, reason) {
    return { action: 'wait', phase: phase, reason: reason };
  }

  // --- price-matching (main.js:4564-4576, the 100ms "Slow Loop") -----------
  // Every 100ms: with probability demand/100, a sale of floor(0.7*demand^1.15)
  // clips happens, at $margin each (sellClips() literally uses `margin` as
  // the per-clip price - confirmed against the UI's "Price per Clip: $
  // .25" at the default margin=0.25). So in expectation (while unsoldClips
  // isn't the binding constraint):
  //   salesRate/sec = 10 * (demand/100) * 0.7 * demand^1.15
  //                 = SALES_COEFFICIENT * demand^SALES_EXPONENT
  // and demand = (.8/margin)*marketing*marketingEffectiveness*demandBoost*(1+prestigeU/10)
  // is (at a fixed instant) inversely proportional to margin - i.e.
  // demand*margin is invariant under a margin change. That lets us solve for
  // the margin that makes expected sales rate match production (clipRate,
  // the game's own smoothed clips/sec figure) WITHOUT re-deriving the
  // marketing/demandBoost/prestige formula ourselves: read the current
  // (demand, margin) pair to get that invariant, then solve for the margin
  // that would produce the target demand.
  var SALES_COEFFICIENT = 0.07; // = 10 ticks/sec * (1/100 probability scale) * 0.7
  var SALES_EXPONENT = 2.15; // = 1 (probability~demand) + 1.15 (sale-size exponent)
  function demandForSalesRate(ratePerSec) {
    return Math.pow(ratePerSec / SALES_COEFFICIENT, 1 / SALES_EXPONENT);
  }

  // Naive stage-2 build order: whichever of these is currently affordable,
  // in this fixed priority order. No attempt yet at balancing ratios (e.g.
  // the drone:harvester ratio ceiling mentioned in ROUTES.md) - placeholder
  // for a future iteration.
  var STAGE2_BUILDINGS = ['btnMakeFactory', 'btnMakeHarvester', 'btnMakeWireDrone', 'btnMakeFarm', 'btnMakeBattery'];

  // Naive stage-3 probe stat priority: combat first (mandatory per ROUTES.md
  // G-gates - drifter casualties scale with probeCombat^1.7, probeCombat=0
  // kills nothing), then a simple fixed order for the rest. Placeholder -
  // OQ3 (maxTrust-20 feasibility) and the honor-stack conjecture C3 aren't
  // resolved yet, so this isn't claiming to be the optimal allocation.
  var PROBE_STAT_BUTTONS = [
    'btnRaiseProbeCombat', 'btnRaiseProbeHaz', 'btnRaiseProbeSpeed',
    'btnRaiseProbeNav', 'btnRaiseProbeRep', 'btnRaiseProbeFac', 'btnRaiseProbeHarv',
  ];

  function decide(adapter) {
    var g = function (name) { return adapter.get(name); };

    // 1. Endgame: Reject the instant it's available. Never Accept.
    if (adapter.isClickable(REJECT_ID)) {
      return act(adapter, REJECT_ID, 'endgame',
        'Reject: the only path that actually finishes the game (P1/C1 - Accept loops back via ' +
        'prestige, dominated for a single completion).');
    }

    var dismantle = g('dismantle');

    // 2. Forced hand-clicking during final disassembly.
    if (dismantle >= 4 && adapter.isClickable('btnMakePaperclip')) {
      return act(adapter, 'btnMakePaperclip', 'endgame',
        'Hand-clicking the last wire into clips (finalClips=' + g('finalClips') + '/100).');
    }

    // 3. Wire: keep the core production loop alive. Deliberately the FIRST
    // economy decision, above buying clippers/marketing - an earlier version
    // of this policy prioritized clipper purchases first and hit a genuine
    // soft-lock: funds got spent on a clipper, wire ran to 0, and the
    // resulting trickle of sales revenue from existing inventory was never
    // enough to afford the next wire purchase (clips can't be made without
    // wire, so it's a real dead end, not just a slowdown). Protecting the
    // wire supply first avoids that deadlock at the cost of occasionally
    // delaying a clipper purchase by a cycle. No price-timing yet (known
    // gap - see ROUTES.md's continuous-controls note on the sine-wave
    // wireCost formula).
    // This has to GATE spending on anything else, not just go first: the bug
    // above happened even with wire checked first, because when wire itself
    // wasn't yet affordable this tick, control fell through to the (cheaper)
    // clipper purchase below, which kept draining funds a few dollars at a
    // time before they could ever accumulate to wireCost. So: whenever wire
    // is low, either buy it, or hold funds and skip straight to bootstrap
    // clicking below (which doesn't cost money - spending down whatever
    // wire is left into sellable clips is still useful while we wait).
    var humanFlag = g('humanFlag');
    var wireShortage = humanFlag === 1 && g('wire') < 100;
    if (wireShortage && adapter.isClickable('btnBuyWire')) {
      return act(adapter, 'btnBuyWire', 'economy', 'Restocking wire (below 100 inches buffer).');
    }

    // 4. Generic project purchase: trigger-gating in projects.js already
    // sequences the tech tree correctly, so "buy whatever is currently
    // affordable" gets almost the whole game right for free. Explicit
    // exceptions: RevTracker (never-take, P3) and Accept (never - handled
    // by Reject's priority above; skip here so we don't race a
    // simultaneously-available Reject on some future call ordering).
    // Ahead of the routine economy purchases below (autoclippers etc.) -
    // confirmed by running it that placing this AFTER them (the original
    // order) let repeatable, marginal $ purchases perpetually preempt
    // one-time, ops-gated gateway projects: Creativity became affordable at
    // t=286.8s in one run but wasn't bought until t=483.7s, a ~3.3 minute
    // stall on a project that unlocks the entire rest of the tech tree.
    // Projects spend ops, not funds, so promoting them here doesn't reopen
    // the wire-deadlock risk above - there's no shared resource to starve.
    var activeProjects = g('activeProjects') || [];
    for (var i = 0; i < activeProjects.length; i++) {
      var proj = activeProjects[i];
      if (!proj || !proj.element || proj.element.disabled) continue;
      if (NEVER_TAKE_PROJECTS.indexOf(proj.id) !== -1) continue;
      if (proj.id === ACCEPT_ID) continue;
      return act(adapter, proj.id, 'project',
        'Buying project: ' + (proj.title || proj.id) +
        ' (generic rule - trigger-gating already sequences the tree; see NEVER_TAKE_PROJECTS for exceptions).');
    }

    // 5. Core stage-1 economy purchases: autoclippers, megaclippers, marketing.
    // These are NOT projects (not in activeProjects) - always-available
    // buttons with their own escalating cost, must be handled explicitly.
    // Naive: buy whenever affordable, no payback-time comparison yet between
    // the three (placeholder - P5-level continuous-control optimization).
    // Priority ABOVE bootstrap clicking below: getting the first autoclipper
    // running matters far more than one more manual click, and putting this
    // after bootstrap would starve it forever, since the bootstrap condition
    // stays true until clipmakerLevel rises - which only buying does.
    // Skipped entirely during a wire shortage (see above) so cheap purchases
    // can't keep funds from ever reaching wireCost.
    if (humanFlag === 1 && !wireShortage) {
      if (adapter.isClickable('btnMakeClipper')) {
        return act(adapter, 'btnMakeClipper', 'economy', 'Buying an AutoClipper.');
      }
      if (adapter.isClickable('btnMakeMegaClipper')) {
        return act(adapter, 'btnMakeMegaClipper', 'economy', 'Buying a MegaClipper.');
      }
      if (adapter.isClickable('btnExpandMarketing')) {
        return act(adapter, 'btnExpandMarketing', 'economy', 'Expanding marketing (raises demand).');
      }
    }

    // 6. Bootstrap manual clicking before autoclippers are doing the work
    // (or whenever nothing above was affordable this cycle - manual clicks
    // are how the very first purchase gets funded at all).
    if (humanFlag === 1 && g('clipmakerLevel') < 5 && g('wire') >= 1 && adapter.isClickable('btnMakePaperclip')) {
      return act(adapter, 'btnMakePaperclip', 'bootstrap',
        'Manually clicking clips - autoclippers not yet doing meaningful volume (clipmakerLevel=' +
        g('clipmakerLevel') + ').');
    }

    // 7. Tournament: adaptive grid-aware pick (P3). btnRunTournament is only
    // enabled in the "grid generated, waiting for a pick+run" window
    // (newTourney() enables it, runTourney() disables it for the rest of the
    // automatic 64-pairing chain) - a clean game-state signal, no bot-side
    // state needed to track tournament phase.
    //
    // bestPickForGrid() models the FULL 8-strategy round-robin (P3's exact
    // analysis) - only valid once all 8 are unlocked. Before that, `strats`
    // has fewer entries and picking an out-of-range index would set `pick`
    // to a value with no corresponding <option> (real <select> silently
    // ignores it; our FakeElement doesn't validate and would happily set an
    // out-of-bounds pick, crashing pickStrats() the moment strats[pick] is
    // read) - so fall back to the always-valid, always-present RANDOM (0)
    // until the round-robin actually has all 8 seats filled.
    if (adapter.isClickable('btnRunTournament')) {
      var strats = g('strats') || [];
      var aa = g('aa'), ab = g('ab'), ba = g('ba'), bb = g('bb');
      var pickIdx = strats.length === STRAT_N ? bestPickForGrid(aa, ab, ba, bb) : 0;
      actSetValue(adapter, 'stratPicker', pickIdx, 'tournament',
        'Grid revealed: [[' + aa + ',' + ab + '],[' + ba + ',' + bb + ']]. ' +
        (strats.length === STRAT_N
          ? 'Adaptive pick (argmax exact E[score|grid], P3): ' + STRAT_NAMES[pickIdx] + '.'
          : 'Only ' + strats.length + '/8 strategies unlocked - adaptive model needs all 8; defaulting to RANDOM.'));
      return act(adapter, 'btnRunTournament', 'tournament',
        'Running tournament with pick=' + STRAT_NAMES[pickIdx] + ' (grid-aware choice beats any fixed ' +
        'strategy by ~24-48%, P3).');
    }
    if (adapter.isClickable('btnNewTournament')) {
      return act(adapter, 'btnNewTournament', 'tournament', 'Starting a new tournament round.');
    }

    // 8. Processor/memory allocation. Naive 1:1 split - D6 (compute banking)
    // is explicitly still open in ROUTES.md, including the just-added finding
    // that creativity only accrues while operations>=memory*1000, so more
    // memory without more processors lengthens the post-purchase dead zone.
    // Placeholder pending a real P4 A/B on the schedule.
    if (g('trust') > g('processors') + g('memory')) {
      var wantProc = g('processors') <= g('memory');
      var procId = wantProc ? 'btnAddProc' : 'btnAddMem';
      if (adapter.isClickable(procId)) {
        return act(adapter, procId, 'compute',
          'Allocating spare trust to ' + (wantProc ? 'processors' : 'memory') +
          ' (naive 1:1 split - D6 still open).');
      }
    }

    // 9. Price matching: set margin so expected sales volume tracks
    // production (clipRate), while enforcing a profit floor above the live
    // marginal cost per clip (every clip - hand, autoclipper, or
    // megaclipper - consumes exactly 1 wire inch, `clipClick()`, so cost per
    // clip is wireCost/wireSupply; wireSupply-upgrade projects raise that
    // denominator over time and are picked up automatically here since we
    // always read the current values, no separate accounting needed).
    // Lower priority than purchases: a price nudge is never urgent, and
    // funds/project decisions matter more when both are pending.
    // Known imprecision: clipRate counts ALL clips including our own
    // bootstrap manual clicking (step 5), so before clipmakerLevel clears
    // that threshold, "production" here transiently includes our own
    // clicks rather than only sustainable autoclipper output. Self-corrects
    // once bootstrap clicking stops and clipRate settles, since this is
    // recomputed fresh every cycle - not worth extra machinery to fix for a
    // first pass.
    if (humanFlag === 1 && g('clipRate') > 0) {
      var wireSupply = g('wireSupply');
      var costPerClip = wireSupply > 0 ? g('wireCost') / wireSupply : 0;
      var minProfitableMargin = Math.max(0.01, costPerClip * 1.1); // 10% over material cost
      var demandConstant = g('demand') * g('margin'); // invariant under margin changes at a fixed instant
      var targetDemand = demandForSalesRate(g('clipRate'));
      var targetMargin = targetDemand > 0 ? demandConstant / targetDemand : minProfitableMargin;
      var desiredMargin = Math.max(targetMargin, minProfitableMargin);
      var currentMargin = g('margin');
      var PRICE_STEP = 0.01; // raisePrice()/lowerPrice() always move margin by exactly this
      var PRICE_TOLERANCE = 1.5 * PRICE_STEP; // avoid oscillating over sub-step differences
      if (currentMargin < desiredMargin - PRICE_TOLERANCE && adapter.isClickable('btnRaisePrice')) {
        return act(adapter, 'btnRaisePrice', 'pricing',
          'Raising price ($' + currentMargin.toFixed(2) + ' -> target $' + desiredMargin.toFixed(2) +
          ') to slow sales toward production rate (clipRate=' + g('clipRate').toFixed(1) + '/s), staying above ' +
          'cost-per-clip $' + costPerClip.toFixed(4) + '.');
      }
      if (currentMargin > desiredMargin + PRICE_TOLERANCE && adapter.isClickable('btnLowerPrice')) {
        return act(adapter, 'btnLowerPrice', 'pricing',
          'Lowering price ($' + currentMargin.toFixed(2) + ' -> target $' + desiredMargin.toFixed(2) +
          ') to grow sales toward production rate (clipRate=' + g('clipRate').toFixed(1) + '/s), staying above ' +
          'cost-per-clip $' + costPerClip.toFixed(4) + '.');
      }
    }

    // 10. Stage 2: naive fixed-priority build order (placeholder, see comment above).
    if (humanFlag === 0 && g('spaceFlag') === 0) {
      for (var b2 = 0; b2 < STAGE2_BUILDINGS.length; b2++) {
        if (adapter.isClickable(STAGE2_BUILDINGS[b2])) {
          return act(adapter, STAGE2_BUILDINGS[b2], 'stage2',
            'Building (naive fixed-priority order: factory > harvester > wire drone > farm > battery).');
        }
      }
    }

    // 11. Stage 3: launch probes, allocate stat points, buy more probe trust.
    if (g('spaceFlag') === 1) {
      if (adapter.isClickable('btnMakeProbe')) {
        return act(adapter, 'btnMakeProbe', 'stage3', 'Launching a probe.');
      }
      for (var b3 = 0; b3 < PROBE_STAT_BUTTONS.length; b3++) {
        if (adapter.isClickable(PROBE_STAT_BUTTONS[b3])) {
          return act(adapter, PROBE_STAT_BUTTONS[b3], 'stage3',
            'Allocating a probe stat point (naive fixed priority: combat > hazard > speed > nav > rep > fac > harv; ' +
            'OQ3/C3 not yet resolved).');
        }
      }
      if (adapter.isClickable('btnIncreaseProbeTrust')) {
        return act(adapter, 'btnIncreaseProbeTrust', 'stage3', 'Buying more probe stat points with yomi.');
      }
    }

    return wait('idle', 'Nothing actionable this cycle.');
  }

  return {
    decide: decide,
    bestPickForGrid: bestPickForGrid,
    exactScoresForGrid: exactScoresForGrid,
    STRAT_NAMES: STRAT_NAMES,
    NEVER_TAKE_PROJECTS: NEVER_TAKE_PROJECTS,
    ACCEPT_ID: ACCEPT_ID,
    REJECT_ID: REJECT_ID,
  };
});

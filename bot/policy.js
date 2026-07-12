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
  // Community speedrun guide's avoid-list, added after confirming each in
  // projects.js: AutoTourney (118, 50k creativity for automation that would
  // override our per-grid adaptive pick - P3's whole ~24-48% yomi edge),
  // The OODA Loop (120, 175k ops + 45k yomi to boost probe speed/nav, both
  // of which we run at 0), Glory (134, 200k ops + 30k yomi for a combat
  // bonus the guide rates a waste). Threnody (133) deliberately NOT listed:
  // it's the honor source that raises maxTrust in stage 3.
  var NEVER_TAKE_PROJECTS = ['projectButton42', 'projectButton118', 'projectButton120', 'projectButton134'];
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

  // Stage-2 build order. Only factories produce clips (clipClick() is only
  // called with factoryLevel*factoryRate, main.js:4281); harvesters/wire
  // drones just convert matter into wire for factories to consume, and
  // farms/batteries just supply the power factories need to run
  // (powMod = supply/demand, zero if farmLevel=0 - main.js:2952-3000). A
  // flat priority list (factory > harvester > wireDrone > farm > battery)
  // looked right but had a real bootstrap bug: on the exact tick humanFlag
  // flips to 0, btnMakeFactory's container can still read display:none for
  // one more buttonUpdate() cycle while farm/battery's containers (gated by
  // a different flag) are already visible - so the "first affordable"
  // button that tick was farm, not factory. That one lucky tick was enough
  // to buy 2 farms (a farm's cost is Math.pow(farmLevel+1,2.78)*1e8 - the
  // 2nd one alone cost $686M) before factory's container ever unhid,
  // permanently draining the ~$832M of unusedClips carried over from stage
  // 1 - none left for a single $100M factory, the only thing that produces
  // more. Caught via headless run: stage 2 entered at t=9835s and then
  // flatlined for 20,000+ simulated seconds with 0 factories.
  var STAGE2_BUILDING_ORDER = ['btnMakeFactory', 'btnMakeHarvester', 'btnMakeWireDrone', 'btnMakeFarm', 'btnMakeBattery'];

  var AUTOCLIPPER_CAP = 75; // community speedrun guide; referenced by both the investment withdraw check and the purchase cap below

  // --- Milestones -----------------------------------------------------------
  // Target times are paced against the Any% Desktop world record (5,662s =
  // 1h34m22s, speedrun.com - see WIP.md) with a little slack per split.
  // These are OUR schedule targets, not the game's own milestoneFlag
  // thresholds - the panel and the headless runner both render actual-vs-
  // target so it's obvious which phase of a run is losing time.
  var MILESTONES = [
    { id: 'trading', label: 'Algorithmic Trading', targetSec: 480, reached: function (g) { return g('investmentEngineFlag') === 1; } },
    { id: 'clips100k', label: '100k clips', targetSec: 720, reached: function (g) { return g('clips') >= 1e5; } },
    { id: 'quantum', label: 'Quantum computing', targetSec: 1200, reached: function (g) { return g('qFlag') === 1; } },
    { id: 'takeover', label: 'Hostile Takeover', targetSec: 1500, reached: function (g) { var p = g('project37'); return !!(p && p.flag === 1); } },
    { id: 'monopoly', label: 'Full Monopoly', targetSec: 1800, reached: function (g) { var p = g('project38'); return !!(p && p.flag === 1); } },
    { id: 'hypno', label: 'HypnoDrones (stage 2)', targetSec: 2700, reached: function (g) { return g('humanFlag') === 0; } },
    { id: 'factory', label: 'First clip factory', targetSec: 2950, reached: function (g) { return g('humanFlag') === 0 && g('factoryLevel') > 0; } },
    { id: 'earth', label: 'Earth consumed', targetSec: 4200, reached: function (g) { return g('humanFlag') === 0 && g('availableMatter') <= 0; } },
    { id: 'space', label: 'Space Exploration (stage 3)', targetSec: 4500, reached: function (g) { return g('spaceFlag') === 1; } },
    { id: 'universe', label: 'Universe consumed', targetSec: 5300, reached: function (g) { return g('milestoneFlag') >= 15; } },
    { id: 'credits', label: 'Final clips + Reject', targetSec: 5662, reached: function (g) { return g('dismantle') >= 4 && g('finalClips') >= 100; } },
  ];

  // First-reached times are recorded per adapter (adapter.now() is virtual
  // sim time headless, wall/warped time in the browser) so both the panel
  // and the headless runner can print actual-vs-target splits.
  function recordMilestones(adapter, g) {
    var times = adapter.__milestoneTimes || (adapter.__milestoneTimes = {});
    for (var i = 0; i < MILESTONES.length; i++) {
      var m = MILESTONES[i];
      if (times[m.id] === undefined && m.reached(g)) times[m.id] = adapter.now();
    }
    return times;
  }

  // --- Epochs ---------------------------------------------------------------
  // Coarse phases of a run, used to slot actions "at/before/after" a boundary
  // (e.g. wire pre-buying matters before the WireBuyer/megaclipper era;
  // quantum-pumping tempOps matters from the quantum epoch on; swarm think-
  // vs-work matters only in stage2-buildout). Derived purely from game state
  // so sim and browser agree with zero extra bookkeeping.
  function currentEpoch(g) {
    if (g('spaceFlag') === 1) return g('milestoneFlag') >= 15 ? 'endgame' : 'stage3';
    if (g('humanFlag') === 0) return g('availableMatter') > 0 ? 'stage2-buildout' : 'stage2-exodus';
    if (g('qFlag') === 1) return 'quantum';
    if (g('investmentEngineFlag') === 1) return 'invest';
    if (g('clipmakerLevel') >= 5) return 'economy';
    return 'bootstrap';
  }

  // --- Wire price wave ------------------------------------------------------
  // adjustWirePrice() (main.js:695-710, called from the 100ms slow loop):
  // with p=1.5% per call, wireCost = ceil(wireBasePrice + 6*sin(counter)),
  // counter incrementing once per adjustment - so price swings +/-6 around
  // base on a ~40s pseudo-period, and the base itself decays 0.1% per 25s
  // (only while >$15 and no purchases, each purchase adds +$0.05). Both
  // wireCost and wireBasePrice are plain globals, so "are we in a trough?"
  // is directly observable - no phase estimation needed.
  var WIRE_CHEAP_DELTA = -4; // sin < ~ -0.5: bottom third of the wave
  var WIRE_RESERVE_TARGET_MIN = 10; // stop stockpiling beyond this many minutes of production
  var WIRE_EMERGENCY_MIN = 0.25; // below this, buy at ANY price (production must not stop)
  function wireStatus(g) {
    var clipRate = Math.max(g('clipRate') || 0, 1);
    var minutes = g('wire') / clipRate / 60;
    var delta = g('wireCost') - g('wireBasePrice');
    return {
      minutes: minutes,
      cost: g('wireCost'),
      base: g('wireBasePrice'),
      delta: delta,
      verdict: delta <= WIRE_CHEAP_DELTA ? 'cheap' : (delta >= 4 ? 'expensive' : 'fair'),
    };
  }

  // --- Stage-2 purchase helpers --------------------------------------------
  // Multi-buy buttons (x10/x100/x1000 in index2.html) matter at scale: the
  // 30 clicks/sec budget cannot buy hundreds of thousands of drones one at
  // a time (that alone would take hours of clicking). Pick the biggest
  // affordable batch; the game pre-disables each batch button when
  // unusedClips can't cover it (updateDroneButtons, main.js:2562-2600), so
  // isClickable() is the affordability check.
  function biggestAffordable(adapter, ordered) {
    for (var i = 0; i < ordered.length; i++) {
      if (adapter.isClickable(ordered[i][0])) return ordered[i];
    }
    return null;
  }

  // Buy whichever drone type is behind, biggest affordable batch. Keeping
  // the two levels close matters beyond production balance: droneRatio
  // (max+1)/(min+1) > 1.5 accrues disorganization (main.js:2683-2700) which
  // eventually stalls all swarm gifts. A transiently large batch on the
  // lower side is fine (the counter moves at most 0.01/tick and decays as
  // soon as the other side's batch lands a cycle later); just don't let a
  // batch overshoot to 3x the other side.
  function pickDroneBuy(adapter, g, harvesterLevel, wireDroneLevel) {
    var harvBehind = harvesterLevel <= wireDroneLevel;
    var lowLevel = harvBehind ? harvesterLevel : wireDroneLevel;
    var highLevel = harvBehind ? wireDroneLevel : harvesterLevel;
    var buttons = harvBehind
      ? [['btnHarvesterx1000', 1000], ['btnHarvesterx100', 100], ['btnHarvesterx10', 10], ['btnMakeHarvester', 1]]
      : [['btnWireDronex1000', 1000], ['btnWireDronex100', 100], ['btnWireDronex10', 10], ['btnMakeWireDrone', 1]];
    for (var i = 0; i < buttons.length; i++) {
      var count = buttons[i][1];
      if (count > 1 && (lowLevel + count + 1) > (highLevel + 1) * 3 && highLevel > 0) continue;
      if (adapter.isClickable(buttons[i][0])) return [buttons[i][0], count, harvBehind];
    }
    return null;
  }

  // Full observability snapshot for the panel and headless logging - one
  // call returns everything the UI shows: epoch, milestone splits, wire
  // reserve state. Read-only (no clicks), safe to call every frame.
  function status(adapter) {
    var g = function (name) { return adapter.get(name); };
    var times = recordMilestones(adapter, g);
    var ms = [];
    for (var i = 0; i < MILESTONES.length; i++) {
      var m = MILESTONES[i];
      ms.push({ id: m.id, label: m.label, targetSec: m.targetSec, reachedAtMs: times[m.id] !== undefined ? times[m.id] : null });
    }
    return {
      epoch: currentEpoch(g),
      milestones: ms,
      wire: g('humanFlag') === 1 ? wireStatus(g) : null,
    };
  }

  function decide(adapter) {
    var g = function (name) { return adapter.get(name); };

    // Record milestone first-reached times on every decision cycle, so
    // split data exists even if nothing ever calls status() (headless runs
    // print them at the end; the panel renders them live).
    recordMilestones(adapter, g);

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
    // Reserve accounting is in MINUTES of production (wire/clipRate/60), not
    // raw inches - "1000 inches" means 16 minutes at hand-click pace but
    // 20ms in the megaclipper era, so an absolute threshold can't serve both.
    // Emergency (reserve nearly empty): buy at ANY price, and gate all other
    // spending below (the original soft-lock protection). Opportunistic
    // (price in the sine trough, see wireStatus above): pre-buy up to the
    // reserve target, but only with a 3x funds cushion so a cheap-wire
    // window can never starve the next clipper/marketing purchase - beyond
    // the target the money is better invested than parked in inventory.
    var humanFlag = g('humanFlag');
    var wireNow = wireStatus(g);
    var wireShortage = humanFlag === 1 && (g('wire') < 100 || wireNow.minutes < WIRE_EMERGENCY_MIN);
    if (wireShortage && adapter.isClickable('btnBuyWire')) {
      return act(adapter, 'btnBuyWire', 'economy',
        'Restocking wire at any price (' + wireNow.minutes.toFixed(2) + ' min of production left).');
    }
    // Pre-buy only once the investment-engine era has started and there's
    // real wealth (run E1, RUNS.md: with just a 3x-cost cushion this rule
    // drained every early dollar into wire inventory - a ~15% cost saving -
    // before clippers could compound - a >100%/cycle return. Cheap wire is
    // strictly a surplus-cash optimization).
    if (humanFlag === 1 && !wireShortage &&
        g('investmentEngineFlag') === 1 &&
        wireNow.delta <= WIRE_CHEAP_DELTA &&
        wireNow.minutes < WIRE_RESERVE_TARGET_MIN &&
        g('funds') >= wireNow.cost * 10 &&
        adapter.isClickable('btnBuyWire')) {
      return act(adapter, 'btnBuyWire', 'economy',
        'Pre-buying wire in a price trough ($' + wireNow.cost + ' vs base $' + wireNow.base.toFixed(0) +
        '; reserve ' + wireNow.minutes.toFixed(1) + '/' + WIRE_RESERVE_TARGET_MIN + ' min).');
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

    // 5. Investment engine (unlocked by project21, "Algorithmic Trading",
    // trust>=8 - itself just bought by the generic rule above, nothing
    // special needed there). Research from the speedrunning community
    // (community strategy guide, see WIP.md) flagged this as "where the
    // problem of the game for a good speedrun lies" - highest-variance part
    // of the run - but also as the main funding source for the trust-via-
    // tokens path (below) once trust>=85, so it's worth running even simply.
    // stockShop()/sellStock()/updateStocks() are all automatic once bankroll
    // has funds (main.js:1666-1686, timers) - our only levers are how much
    // to keep deposited, the risk level, and when to withdraw for a
    // purchase.
    if (humanFlag === 1 && adapter.isClickable('btnInvest')) {
      var bankroll = g('bankroll');
      var fundsNow = g('funds');

      // Withdraw if it would clear a big-ticket funds-gated purchase.
      // NO buffer on the mega-projects: run A1 (RUNS.md) showed the original
      // 2x buffer delayed Full Monopoly - the single biggest revenue
      // multiplier in stage 1 (demandBoost x10) - until t=9,028s, 4x its
      // target split, because the engine had to grow to $20M before cashing
      // out for a $10M purchase. The engine refills fast AFTER the demand
      // boost lands; waiting for a cushion first has the causality backwards.
      // Full Monopoly's threshold is also gated on its yomi co-requirement
      // (3,000) being met - without that check, withdraw would fire with
      // yomi short, step 7 would sweep the cash back in next cycle, and the
      // two would ping-pong burning the click budget until yomi caught up.
      var withdrawThreshold = null;
      function considerThreshold(t) { if (t !== null && (withdrawThreshold === null || t < withdrawThreshold)) withdrawThreshold = t; }
      var project37 = g('project37'); // Hostile Takeover, $1,000,000
      var project38 = g('project38'); // Full Monopoly, $10,000,000 + 3,000 yomi (needs project37 first)
      var project40 = g('project40'); // A Token of Goodwill, $500,000
      var project40b = g('project40b'); // Another Token of Goodwill, doubles from $1,000,000
      if (project37 && !project37.flag) considerThreshold(1000000);
      else if (project37 && project37.flag && project38 && !project38.flag && g('yomi') >= 3000) considerThreshold(10000000);
      if (project40 && !project40.flag) considerThreshold(500000);
      if (project40 && project40.flag && project40b && !project40b.flag && g('trust') < 100) considerThreshold(g('bribe'));
      if (g('clipmakerLevel') < AUTOCLIPPER_CAP) considerThreshold(g('clipperCost'));
      considerThreshold(g('megaClipperCost'));
      considerThreshold(g('adCost'));
      if (withdrawThreshold !== null && bankroll > 0 && fundsNow + bankroll >= withdrawThreshold && fundsNow < withdrawThreshold) {
        return act(adapter, 'btnWithdraw', 'invest',
          'Withdrawing $' + bankroll.toFixed(0) + ' - clears a pending purchase needing $' + withdrawThreshold.toFixed(0) + '.');
      }
      // Remember the pending target so the deposit sweep (step 7) can hold
      // funds destined for an imminent purchase instead of re-depositing.
      adapter.__pendingThreshold = withdrawThreshold;

      // Risk level: med until clips are flowing well, then high (community
      // guide's timing heuristic - "shifting to High Risk around 100,000
      // clips" - used as a simple readable proxy for "economy is established").
      // Read back via `riskiness` (main.js:1433), not a nonexistent
      // `investStrat` global - the select's value only exists as
      // investStratElement.value (a DOM element property, not window-scoped),
      // synced into `riskiness` by a 100ms timer (main.js:1619-1625). Reading
      // g('investStrat') always returned undefined, so this comparison never
      // matched and the click fired on every single decide() call forever
      // once clips>=100000 - starving every lower-priority step (deposits,
      // autoclipper purchases) for the rest of the run. Caught by a stalled
      // headless run: trust stuck at 29 with $44M of unspent funds after 53+
      // simulated hours.
      var desiredRisk = g('clips') >= 100000 ? 'hi' : 'med';
      var desiredRiskiness = desiredRisk === 'hi' ? 1 : 5;
      if (g('riskiness') !== desiredRiskiness) {
        return actSetValue(adapter, 'investStrat', desiredRisk, 'invest',
          'Setting risk level to ' + desiredRisk + ' (clips=' + Math.floor(g('clips')) + ').');
      }

      // Upgrade (raises stockGainThreshold, i.e. win probability) whenever
      // affordable - lower priority than withdrawing capital when needed.
      if (adapter.isClickable('btnImproveInvestments')) {
        return act(adapter, 'btnImproveInvestments', 'invest', 'Upgrading investment engine (raises trade win rate).');
      }
      // Deposits are handled separately, AFTER the routine economy
      // purchases below (step 6) - investDeposit() moves ALL of funds into
      // bankroll in one shot (main.js:1454-1461, no partial-deposit
      // control), so depositing here (before those purchases get a chance
      // to spend what they need) would starve them the same way the
      // project-purchase-ordering bug did earlier. Giving economy purchases
      // first claim on `funds` each cycle, then sweeping whatever's left,
      // avoids that without needing a hand-tuned "keep this much liquid"
      // buffer that would go stale as costs scale up.
    }

    // 6. Core stage-1 economy purchases: autoclippers, megaclippers, marketing.
    // These are NOT projects (not in activeProjects) - always-available
    // buttons with their own escalating cost, must be handled explicitly.
    // AutoClippers capped at 75 per the community speedrun guide (each
    // additional one past that point earns less than the same funds put
    // toward MegaClippers/Marketing/investment) - beyond the cap, skip
    // straight to MegaClipper/Marketing. No payback-time comparison between
    // MegaClipper vs Marketing yet (placeholder - P5-level optimization).
    // Priority ABOVE bootstrap clicking below: getting the first autoclipper
    // running matters far more than one more manual click, and putting this
    // after bootstrap would starve it forever, since the bootstrap condition
    // stays true until clipmakerLevel rises - which only buying does.
    // Skipped entirely during a wire shortage (see above) so cheap purchases
    // can't keep funds from ever reaching wireCost.
    // ROI-ranked purchases (run C1 fix, see RUNS.md): the fixed order
    // (clipper > megaclipper > marketing) starved marketing, but the real
    // finding from C1's numbers is that profit per second scales with the
    // demand constant K = demand*margin (marketing levels, slogan/jingle,
    // demandBoost), while extra PRODUCTION only nets 0.535*margin - cost
    // per clip/s (selling more forces the match price down: profit(V) =
    // V*(K/D(V)-c) with D ~ V^(1/2.15), so marginal profit per unit rate is
    // margin*(1 - 1/2.15) - c). Rank all three purchases by marginal
    // profit-per-second per dollar and buy the best payback under a window;
    // this replaces hand-tuned ordering with the actual economics, and
    // naturally handles both regimes (early: clippers pay back in seconds;
    // saturated: marketing is the only thing worth money).
    if (humanFlag === 1 && !wireShortage) {
      var margin6 = g('margin');
      var ws6 = g('wireSupply');
      var cpc6 = ws6 > 0 ? g('wireCost') / ws6 : 0; // wire cost per clip
      var vol6 = Math.max(g('clipRate') || 0, 1);
      var marginalClipProfit = Math.max(margin6 * (1 - 1 / SALES_EXPONENT) - cpc6, 0);
      // Window learned the hard way (run D1, RUNS.md): 600s froze ALL
      // clipper purchases at t=0 - hand-click volume drags the match-margin
      // to ~$0.05, making a $6 clipper look like a 900s payback - and the
      // whole run collapsed (trading at 3,723s vs 1,475s). Early money has
      // ~zero opportunity cost (the engine pre-upgrades is EV-flat), and
      // production compounds; the window exists only to stop truly absurd
      // late-game purchases, so it must be generous. The argmax ordering is
      // where the actual optimization lives.
      var PAYBACK_WINDOW_SEC = 3600;
      var candidates = [];
      if (g('clipmakerLevel') < AUTOCLIPPER_CAP && adapter.isClickable('btnMakeClipper')) {
        candidates.push(['btnMakeClipper', 'an AutoClipper',
          (g('clipperBoost') || 1) * marginalClipProfit / Math.max(g('clipperCost'), 0.01)]);
      }
      if (adapter.isClickable('btnMakeMegaClipper')) {
        candidates.push(['btnMakeMegaClipper', 'a MegaClipper',
          (g('megaClipperBoost') || 1) * 500 * marginalClipProfit / Math.max(g('megaClipperCost'), 0.01)]);
      }
      if (adapter.isClickable('btnExpandMarketing')) {
        // Each level multiplies the demand constant by 1.1 -> profit lifts
        // ~10% of current margin on the full sales volume.
        candidates.push(['btnExpandMarketing', 'marketing',
          (vol6 * margin6 * 0.1) / Math.max(g('adCost'), 0.01)]);
      }
      var best6 = null;
      for (var b6 = 0; b6 < candidates.length; b6++) {
        if (best6 === null || candidates[b6][2] > best6[2]) best6 = candidates[b6];
      }
      if (best6 && best6[2] * PAYBACK_WINDOW_SEC >= 1) {
        return act(adapter, best6[0], 'economy',
          'Buying ' + best6[1] + ' (best ROI: pays back in ' + Math.round(1 / best6[2]) + 's, window ' + PAYBACK_WINDOW_SEC + 's).');
      }
    }

    // 7. Investment deposit: sweep whatever funds economy purchases (and
    // wire, and any project just bought) didn't need this cycle into the
    // investment engine, rather than leaving it idle. Split from the
    // withdraw/risk/upgrade logic in step 5 - see the comment there for why
    // (investDeposit() takes everything in one shot, no partial control).
    // Hold the sweep when funds are already earmarked for a pending
    // threshold purchase (set in step 5) - otherwise a fresh withdrawal
    // would bounce straight back into the engine before the project/economy
    // click lands next cycle.
    var pendingThreshold = adapter.__pendingThreshold;
    var fundsEarmarked = pendingThreshold !== null && pendingThreshold !== undefined && g('funds') >= pendingThreshold * 0.9;
    if (humanFlag === 1 && !wireShortage && !fundsEarmarked && adapter.isClickable('btnInvest') && g('funds') > 0) {
      return act(adapter, 'btnInvest', 'invest',
        'Depositing $' + g('funds').toFixed(0) + ' into the investment engine (nothing more urgent to spend it on this cycle).');
    }

    // 8. Bootstrap manual clicking before autoclippers are doing the work
    // (or whenever nothing above was affordable this cycle - manual clicks
    // are how the very first purchase gets funded at all).
    if (humanFlag === 1 && g('clipmakerLevel') < 5 && g('wire') >= 1 && adapter.isClickable('btnMakePaperclip')) {
      return act(adapter, 'btnMakePaperclip', 'bootstrap',
        'Manually clicking clips - autoclippers not yet doing meaningful volume (clipmakerLevel=' +
        g('clipmakerLevel') + ').');
    }

    // 9. Tournament: adaptive grid-aware pick (P3). btnRunTournament is only
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

    // 10. Processor/memory allocation. Community speedrun guide's schedule:
    // get processors up to 6 first (unlocks quantum computing at
    // processors>=5, project50), then put everything else into memory,
    // topping out around 25 processors by the end of stage 1 (rest memory,
    // needed for the 70k/120k ops gates - G5/G14 in ROUTES.md). D6 (compute
    // banking) is otherwise still open, including the earlier finding that
    // creativity only accrues while operations>=memory*1000, so this
    // schedule is a concrete guess informed by that research, not yet a
    // from-scratch derivation of our own.
    // Gate-driven schedule (run C1 fix): the old "6 processors first" start
    // delayed the 10k-ops Algorithmic Trading gate (needs memory 10) by
    // several hundred seconds. Order the early points by the actual unlock
    // gates: memory 10 (trading) -> processors 5 (quantum + a creativity
    // trickle for New Slogan/Catchy Jingle, the early demand multipliers)
    // -> memory 12 (Strategic Modeling, 12k ops, the yomi engine) ->
    // processors 10 (creativity rate) -> then the community guide's
    // end-of-stage-1 shape (~25 processors, rest memory).
    var PROCESSOR_TARGET = 25;
    if (g('trust') > g('processors') + g('memory')) {
      // Run E1 (RUNS.md) killed the mem-first experiment: starting memory-
      // heavy left the run on 1 processor until t=6,300s - no ops regen, no
      // creativity, every project gated. The original proc-6-first shape
      // (best observed trading split, 1,475s in C1) restored.
      var procNow = g('processors'), memNow = g('memory');
      var wantProc = procNow < 6 || (procNow < PROCESSOR_TARGET && procNow <= memNow / 10);
      var procId = wantProc ? 'btnAddProc' : 'btnAddMem';
      if (adapter.isClickable(procId)) {
        return act(adapter, procId, 'compute',
          'Allocating spare trust to ' + (wantProc ? 'processors' : 'memory') +
          ' (gate schedule: mem10=trading, proc5=quantum, mem12=strategic modeling, proc10=creativity, then ~25/75).');
      }
    }

    // 11. Quantum computing: bonus ops from clicking qComp() at good times
    // (main.js:829-864). Each active photonic chip contributes
    // sin(qClock*waveSeed) - different waveSeeds per chip mean they drift
    // in and out of phase with each other, no simple shared period. Chips
    // themselves are bought automatically by the generic project rule
    // (project51, repeatable, ops-only cost) - the only thing needed here
    // is clicking at decent moments. No cost to click (never gated by
    // affordability, only visibility), so click whenever the aggregate
    // signal is reasonably close to its per-chip max (some chips will
    // always lag out of phase - a threshold heuristic, not exact
    // peak-finding) and there's ops headroom to actually bank the gain
    // (excess beyond the memory cap decays as tempOps instead of banking
    // permanently, main.js:3419-3432, so clicking when already at the cap
    // is mostly wasted). Stays relevant through stage 3 (only hidden at
    // dismantle>=5, deep in the endgame), not just stage 1.
    if (g('qFlag') === 1 && adapter.isClickable('btnQcompute')) {
      var qChips = g('qChips') || [];
      var qSum = 0, qActiveCount = 0;
      for (var qi = 0; qi < qChips.length; qi++) {
        if (qChips[qi].active) { qSum += qChips[qi].value; qActiveCount++; }
      }
      var headroom = g('memory') * 1000 - g('standardOps');
      // In stage 2 the 70k-175k ops project gates (drone flocking chain,
      // Space Exploration's 120k) sit near or above the memory cap, and
      // tempOps overflow (a few thousand at saturation, given qComp()'s
      // damper) is exactly the top-up that closes the gap - so there,
      // clicking at the cap is the point, not a waste.
      var wantOverflowPump = humanFlag === 0 && g('spaceFlag') === 0;
      if (qActiveCount > 0 && qSum >= qActiveCount * 0.6 && (headroom > 50 || wantOverflowPump)) {
        return act(adapter, 'btnQcompute', 'quantum',
          'Clicking quantum compute (signal ' + qSum.toFixed(2) + '/' + qActiveCount +
          ' active chips, ' + (headroom > 50 ? 'headroom=' + Math.floor(headroom) + ' ops' : 'pumping tempOps for stage-2 ops gates') + ').');
      }
    }

    // 12. Price matching: set margin so expected sales volume tracks
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
      // Profit-max floor, not just break-even: sales scale as demand^2.15
      // and demand ~ 1/margin, so when demand can't absorb production,
      // profit (m-c)*m^-2.15 peaks at m* = 2.15c/(2.15-1) = 1.87c. Below
      // that, cutting price buys volume worth less than the margin given
      // up. (The old 1.1c floor left ~40% of achievable profit on the
      // table in the wire-cost-dominated early game - run F1, RUNS.md.)
      var minProfitableMargin = Math.max(0.01, costPerClip * (SALES_EXPONENT / (SALES_EXPONENT - 1)));
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

    // 13. Stage 2: bootstrap-first, power-ratio-balanced build order (see
    // STAGE2_BUILDING_ORDER's comment for the bootstrap bug this replaced).
    if (humanFlag === 0 && g('spaceFlag') === 0) {
      // Bootstrap: one farm (so powMod is nonzero once a factory exists -
      // main.js:2998) and one battery, then STOP spending on power
      // infrastructure until the production chain is actually unlocked.
      // btnMakeFactory doesn't just cost unusedClips - it's invisible
      // (isClickable() false) until project45 "Clip Factories" is bought,
      // which itself requires project43 "Harvester Drones" AND project44
      // "Wire Drones" first (both ops-gated, projects.js:990-1054) - all
      // three take real time to unlock via the generic project-purchase
      // step (step 4) after the stage-2 transition, they're not available
      // instantly. The first version of this fix bootstrapped 1 farm+1
      // battery, found btnMakeFactory still (correctly) not clickable, and
      // fell through to an unbounded "buy more farms" fallback - which
      // bought a 2nd farm (cost formula Math.pow(farmLevel+1,2.78)*1e8,
      // $686M at farmLevel=1) while genuinely waiting on those unlocks,
      // recreating the same stockpile-drain bug one level down. Checking
      // the unlock flags directly (not just isClickable, which can't tell
      // "not yet unlocked" from "unlocked but unaffordable") avoids that:
      // don't grow power infrastructure further until there's a real
      // factory/drone to power.
      var farmLevel = g('farmLevel'), batteryLevel = g('batteryLevel'), factoryLevel = g('factoryLevel');
      var chainUnlocked = g('harvesterFlag') === 1 && g('wireDroneFlag') === 1 && g('factoryFlag') === 1;
      if (farmLevel === 0 && adapter.isClickable('btnMakeFarm')) {
        return act(adapter, 'btnMakeFarm', 'stage2', 'Bootstrap: first Solar Farm (powMod is 0 with zero farms - main.js:2998).');
      }
      if (batteryLevel === 0 && adapter.isClickable('btnMakeBattery')) {
        return act(adapter, 'btnMakeBattery', 'stage2', 'Bootstrap: first Battery Tower (minimal power storage buffer).');
      }
      if (!chainUnlocked) {
        return wait('stage2', 'Waiting on the Harvester/Wire Drone/Clip Factory unlock chain (ops-gated projects) ' +
          'before spending unusedClips on more power infrastructure.');
      }
      if (factoryLevel === 0 && adapter.isClickable('btnMakeFactory')) {
        return act(adapter, 'btnMakeFactory', 'stage2', 'Bootstrap: first Factory (the only building that produces clips).');
      }

      // -- Swarm gifts: the ONLY source of processors/memory in stage 2
      // (trust is zeroed by the HypnoDrones event, so step 10's trust-gated
      // allocation never fires here - a real blocker found by reading
      // main.js:1171: btnAddProc/btnAddMem are enabled by swarmGifts>0).
      // Memory first up to 125 (Space Exploration needs operations>=120,000,
      // and standardOps caps at memory*1000 - qComp's tempOps overflow
      // saturates at a few thousand, so ~120 memory is genuinely mandatory,
      // see the damper math in main.js:850-860), then processors (ops regen
      // + creativity for Entertain the Swarm).
      if (g('swarmGifts') > 0) {
        var giftBtn = g('memory') < 125 ? 'btnAddMem' : 'btnAddProc';
        if (adapter.isClickable(giftBtn)) {
          return act(adapter, giftBtn, 'stage2',
            'Spending a swarm gift on ' + (giftBtn === 'btnAddMem' ? 'memory (' + g('memory') + '/125 toward the 120k-ops Space Exploration gate)' : 'a processor (creativity for Momentum/Entertain)') + '.');
        }
      }
      var computeHungry = g('memory') < 125 || g('processors') < 40;
      var exodus = g('availableMatter') <= 0; // Earth harvested clean - but see workDone below
      // Run H1 (RUNS.md): "exodus -> think full-time" froze the run 0.3e27
      // clips short of Space Exploration's 5e27 - wire DRONES still had
      // 2.3e27 grams of acquiredMatter backlog to convert (processMatter is
      // scaled by the same work multiplier), and slider 200 zeroes work.
      // The swarm's work is only done when the backlog is drained too.
      var workDone = exodus && g('acquiredMatter') < 1e15;

      // -- Swarm work/think slider: sliderPos throttles DRONES only
      // (acquireMatter/processMatter scale by (200-sliderPos)/100;
      // factories are unaffected) while gift speed scales UP with it
      // (main.js:2763). The HTML default is 0 = never any gifts, another
      // hard stage-2 blocker. Rule: while memory is still short, think
      // whenever the wire buffer is fat (drones idling costs nothing if
      // factories have minutes of wire queued) and work when it runs low;
      // once memory target is met, work permanently.
      var swarmFlag = g('swarmFlag');
      var fbst = g('factoryBoost') > 1 ? g('factoryBoost') * factoryLevel : 1;
      var clipsPerSec = g('powMod') * fbst * Math.floor(factoryLevel) * g('factoryRate') * 100; // 100 ticks/sec
      var wireBufferSec = clipsPerSec > 0 ? g('wire') / clipsPerSec : Infinity;
      if (swarmFlag === 1) {
        var desiredSlider = workDone ? 200 // harvest AND backlog finished, think full-time
          : (computeHungry && !exodus && wireBufferSec > 240) ? 200
          : (computeHungry && !exodus && wireBufferSec > 60) ? 100 : 0;
        if (Math.abs((g('sliderPos') || 0) - desiredSlider) > 5) {
          return actSetValue(adapter, 'slider', desiredSlider, 'stage2',
            'Swarm slider -> ' + desiredSlider + ' (' + (desiredSlider > 0 ? 'THINK: gifts toward memory ' + g('memory') + '/125, wire buffer ' + Math.round(wireBufferSec) + 's is fat' : 'WORK: full drone output') + ').');
        }
      }

      // -- Swarm mood events: boredom (no matter left to harvest) blocks all
      // gifts until Entertained (10k creativity, escalating); disorganization
      // (drone ratio >1.5) likewise until Synchronized (yomi). Both are
      // cheap relative to a stalled swarm.
      if (g('boredomFlag') === 1 && adapter.isClickable('btnEntertainSwarm')) {
        return act(adapter, 'btnEntertainSwarm', 'stage2', 'Entertaining the bored swarm (gifts were blocked).');
      }
      if (g('disorgFlag') === 1 && adapter.isClickable('btnSynchSwarm')) {
        return act(adapter, 'btnSynchSwarm', 'stage2', 'Synchronizing the disorganized swarm (gifts were blocked).');
      }

      // -- Power: keep supply ahead of demand (farmRate=50 vs
      // factoryPowerRate=200: 4 farms per factory; drones cost 1 each).
      // Multi-buy buttons (x10/x100) save click budget at scale.
      var harvesterLevel = g('harvesterLevel'), wireDroneLevel = g('wireDroneLevel');
      var supply = farmLevel * 50 / 100;
      var demand = (harvesterLevel + wireDroneLevel) / 100 + factoryLevel * 2;
      if (supply < demand * 1.05) {
        var farmPick = biggestAffordable(adapter, [['btnFarmx100', 100], ['btnFarmx10', 10], ['btnMakeFarm', 1]]);
        if (farmPick) {
          return act(adapter, farmPick[0], 'stage2',
            'Adding ' + farmPick[1] + ' Solar Farm(s): supply ' + supply.toFixed(1) + ' MW < demand ' + demand.toFixed(1) + ' MW.');
        }
      }

      // -- Stored power: Space Exploration needs storedPower >= 10,000,000
      // MW-s on top of the ops/clips costs. Capacity is batteryLevel*10,000,
      // so >=1,000 batteries, charged by farm SURPLUS - start building the
      // bank once the factory economy is established (or immediately in
      // exodus), never before the first few factories exist.
      var batteryTarget = 1000;
      if ((exodus || factoryLevel >= 10) && batteryLevel < batteryTarget) {
        var batPick = biggestAffordable(adapter, [['btnBatteryx100', 100], ['btnBatteryx10', 10], ['btnMakeBattery', 1]]);
        if (batPick) {
          return act(adapter, batPick[0], 'stage2',
            'Adding ' + batPick[1] + ' Battery Tower(s) (' + batteryLevel + '/' + batteryTarget + ' toward the 10M MW-s Space Exploration bank).');
        }
        // Charging needs surplus: overbuild farms ~1.3x demand while the bank fills.
        if (g('storedPower') < 10000000 && supply < demand * 1.3) {
          var chargePick = biggestAffordable(adapter, [['btnFarmx100', 100], ['btnFarmx10', 10], ['btnMakeFarm', 1]]);
          if (chargePick) {
            return act(adapter, chargePick[0], 'stage2',
              'Adding ' + chargePick[1] + ' Solar Farm(s) surplus to charge the battery bank (' +
              Math.round(g('storedPower') / 1e6) + '/10M MW-s).');
          }
        }
      }

      // -- Core budget: HARVEST RATE is the stage-2 clock. availableMatter
      // is 6e27 grams and acquireMatter() scales as droneBoost * H^2 *
      // harvesterRate * powMod (quadratic in drone count once Drone
      // Flocking lands, and powMod grows without bound under Momentum) -
      // so every spare clip belongs in drones while there's matter left,
      // with factories bought when the wire buffer says conversion (wire ->
      // unusedClips, which funds everything) is falling behind. This flips
      // the original factory-first rule: factories can always catch up
      // later from the wire stockpile, but harvest time lost is gone.
      // exodus (availableMatter==0): harvesters are dead weight; all
      // remaining spend goes to factories to finish converting the pile.
      // Space Exploration costs 5e27 unusedClips and Earth yields EXACTLY
      // 6e27 total - the cost must be actively protected once the harvest
      // nears completion. Run H2 (RUNS.md) died here: an "exodus -> buy
      // factories to convert faster" rule spent the pile down to 3.9e26
      // (late factories cost ~1e25 EACH), leaving SE unaffordable forever.
      // In exodus nothing is worth buying at all: the 200+ existing
      // factories convert the backlog in seconds, so just hold the pile.
      if (exodus) {
        return wait('stage2', 'Exodus: holding ' + g('unusedClips').toExponential(2) +
          ' unusedClips for Space Exploration (needs 5e27 + 120k ops + 10M MW-s).');
      }
      var SE_RESERVE = 5.05e27;
      var nearSE = g('clips') >= 5.2e27; // most of Earth's 6e27 already harvested
      if (wireBufferSec < 600) {
        var dronePick = pickDroneBuy(adapter, g, harvesterLevel, wireDroneLevel);
        if (dronePick) {
          return act(adapter, dronePick[0], 'stage2',
            'Buying ' + dronePick[1] + 'x ' + (dronePick[2] ? 'Harvester' : 'Wire Drone') +
            ' (harvest is the clock; buffer ' + Math.round(wireBufferSec) + 's; h=' + harvesterLevel + ' w=' + wireDroneLevel + ').');
        }
      }
      if (adapter.isClickable('btnMakeFactory') &&
          (!nearSE || g('unusedClips') - g('factoryCost') >= SE_RESERVE)) {
        return act(adapter, 'btnMakeFactory', 'stage2',
          'Buying a Factory (wire buffer ' + (wireBufferSec === Infinity ? 'inf' : Math.round(wireBufferSec) + 's') +
          ' > 600s - conversion falling behind' + (nearSE ? '; SE reserve protected' : '') + ').');
      }
      return wait('stage2', 'Accumulating unusedClips (factory ' +
        Math.round(100 * g('unusedClips') / g('factoryCost')) + '% funded; wire buffer ' +
        (wireBufferSec === Infinity ? 'inf' : Math.round(wireBufferSec) + 's').toString() +
        (nearSE ? '; SE reserve 5.05e27 protected' : '') + ').');
    }

    // 14. Stage 3: probes convert the universe. Design principles (community
    // guide + ROUTES.md): self-replication is the exponential engine, hazard
    // remediation keeps drift losses survivable, exactly one point each in
    // fac/harv/wire lets the fleet spawn the space factories/drones that
    // actually make clips (spawnFactories/spawnHarvesters/spawnWireDrones
    // are gated on those stats being nonzero), combat matters once drifters
    // start fighting (button only exists after its project), and speed/nav
    // stay 0 (their only real consumer is the banned OODA Loop path).
    if (g('spaceFlag') === 1) {
      // Swarm slider back to WORK: acquireMatter()/processMatter() run in
      // stage 3 too (humanFlag==0), scaled by the same (200-slider)/100 -
      // the space drone fleet is millions strong, so work >> think here;
      // leaving the exodus-era 200 would zero all matter conversion.
      if (g('swarmFlag') === 1 && (g('sliderPos') || 0) > 5) {
        return actSetValue(adapter, 'slider', 0, 'stage3', 'Swarm slider -> 0 (WORK: space drone fleet converts the universe).');
      }
      // Swarm gifts keep arriving once Swarm Computing reconnects
      // (project130); memory raises the ops ceiling for the 100k-200k+
      // late-game projects, processors raise creativity for Threnody.
      if (g('swarmGifts') > 0) {
        var giftBtn3 = g('memory') < 250 ? 'btnAddMem' : 'btnAddProc';
        if (adapter.isClickable(giftBtn3)) {
          return act(adapter, giftBtn3, 'stage3', 'Spending a swarm gift on ' + (giftBtn3 === 'btnAddMem' ? 'memory' : 'a processor') + '.');
        }
      }
      // maxTrust +10 per 91,117.99 honor (the guide's honor target is
      // exactly this constant) - more design space for rep/combat.
      if (adapter.isClickable('btnIncreaseMaxTrust')) {
        return act(adapter, 'btnIncreaseMaxTrust', 'stage3', 'Raising max trust (+10) for 91,118 honor.');
      }
      if (g('probeTrust') < g('maxTrust') && adapter.isClickable('btnIncreaseProbeTrust')) {
        return act(adapter, 'btnIncreaseProbeTrust', 'stage3',
          'Buying probe trust with yomi (' + g('probeTrust') + '/' + g('maxTrust') + ').');
      }
      // Target-driven stat allocation, in priority order. Combat's entry is
      // skipped harmlessly until its button exists. Later duplicate entries
      // deepen a stat once earlier targets are met (haz 2 -> rep 5 ->
      // combat 5 -> haz 3 -> fac/harv/wire 1 -> rep uncapped).
      var PLAN = [
        ['probeHaz', 'btnRaiseProbeHaz', 2],
        ['probeRep', 'btnRaiseProbeRep', 5],
        ['probeCombat', 'btnRaiseProbeCombat', 5],
        ['probeHaz', 'btnRaiseProbeHaz', 3],
        ['probeFac', 'btnRaiseProbeFac', 1],
        ['probeHarv', 'btnRaiseProbeHarv', 1],
        ['probeWire', 'btnRaiseProbeWire', 1],
        ['probeRep', 'btnRaiseProbeRep', 9999],
      ];
      for (var p3 = 0; p3 < PLAN.length; p3++) {
        if ((g(PLAN[p3][0]) || 0) < PLAN[p3][2] && adapter.isClickable(PLAN[p3][1])) {
          return act(adapter, PLAN[p3][1], 'stage3',
            'Probe design: ' + PLAN[p3][0] + ' -> ' + ((g(PLAN[p3][0]) || 0) + 1) +
            ' (plan: haz2, rep5, combat5, haz3, fac/harv/wire 1, rest rep).');
        }
      }
      if (adapter.isClickable('btnMakeProbe')) {
        return act(adapter, 'btnMakeProbe', 'stage3', 'Launching a probe (replication does the real scaling).');
      }
    }

    return wait('idle', 'Nothing actionable this cycle.');
  }

  return {
    decide: decide,
    status: status,
    MILESTONES: MILESTONES,
    currentEpoch: currentEpoch,
    wireStatus: wireStatus,
    bestPickForGrid: bestPickForGrid,
    exactScoresForGrid: exactScoresForGrid,
    STRAT_NAMES: STRAT_NAMES,
    NEVER_TAKE_PROJECTS: NEVER_TAKE_PROJECTS,
    ACCEPT_ID: ACCEPT_ID,
    REJECT_ID: REJECT_ID,
  };
});

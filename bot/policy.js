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

  // Naive stage-3 probe stat priority: combat first (mandatory per ROUTES.md
  // G-gates - drifter casualties scale with probeCombat^1.7, probeCombat=0
  // kills nothing), then a simple fixed order for the rest. Placeholder -
  // OQ3 (maxTrust-20 feasibility) and the honor-stack conjecture C3 aren't
  // resolved yet, so this isn't claiming to be the optimal allocation.
  var PROBE_STAT_BUTTONS = [
    'btnRaiseProbeCombat', 'btnRaiseProbeHaz', 'btnRaiseProbeSpeed',
    'btnRaiseProbeNav', 'btnRaiseProbeRep', 'btnRaiseProbeFac', 'btnRaiseProbeHarv',
  ];

  var AUTOCLIPPER_CAP = 75; // community speedrun guide; referenced by both the investment withdraw check and the purchase cap below

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
      // Buffers per the community guide: don't cash out right at the
      // threshold (leaves nothing invested for next time) - keep a 2x
      // buffer for the huge one-time projects, no buffer needed for tokens
      // or the routine autoclipper/megaclipper/marketing purchases (small
      // relative to the engine's balance, and recurring - the whole point
      // of running this engine is to fund them, not just the mega-projects).
      // Without this, once step 7 starts sweeping funds to bankroll every
      // cycle, `funds` alone would never again reach megaClipperCost/adCost
      // (only bankroll grows) - only a matching withdraw check unstuck it.
      var withdrawThreshold = null;
      function considerThreshold(t) { if (t !== null && (withdrawThreshold === null || t < withdrawThreshold)) withdrawThreshold = t; }
      var project37 = g('project37'); // Hostile Takeover, $1,000,000
      var project38 = g('project38'); // Full Monopoly, $10,000,000 (needs project37 first)
      var project40 = g('project40'); // A Token of Goodwill, $500,000
      var project40b = g('project40b'); // Another Token of Goodwill, doubles from $1,000,000
      if (project37 && !project37.flag) considerThreshold(1000000 * 2);
      else if (project37 && project37.flag && project38 && !project38.flag) considerThreshold(10000000 * 2);
      if (project40 && !project40.flag) considerThreshold(500000);
      if (project40 && project40.flag && project40b && !project40b.flag && g('trust') < 100) considerThreshold(g('bribe'));
      if (g('clipmakerLevel') < AUTOCLIPPER_CAP) considerThreshold(g('clipperCost'));
      considerThreshold(g('megaClipperCost'));
      considerThreshold(g('adCost'));
      if (withdrawThreshold !== null && bankroll > 0 && fundsNow + bankroll >= withdrawThreshold) {
        return act(adapter, 'btnWithdraw', 'invest',
          'Withdrawing $' + bankroll.toFixed(0) + ' - clears a pending purchase needing $' + withdrawThreshold.toFixed(0) + '.');
      }

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
    if (humanFlag === 1 && !wireShortage) {
      if (g('clipmakerLevel') < AUTOCLIPPER_CAP && adapter.isClickable('btnMakeClipper')) {
        return act(adapter, 'btnMakeClipper', 'economy', 'Buying an AutoClipper (below the 75 cap).');
      }
      if (adapter.isClickable('btnMakeMegaClipper')) {
        return act(adapter, 'btnMakeMegaClipper', 'economy', 'Buying a MegaClipper.');
      }
      if (adapter.isClickable('btnExpandMarketing')) {
        return act(adapter, 'btnExpandMarketing', 'economy', 'Expanding marketing (raises demand).');
      }
    }

    // 7. Investment deposit: sweep whatever funds economy purchases (and
    // wire, and any project just bought) didn't need this cycle into the
    // investment engine, rather than leaving it idle. Split from the
    // withdraw/risk/upgrade logic in step 5 - see the comment there for why
    // (investDeposit() takes everything in one shot, no partial control).
    if (humanFlag === 1 && !wireShortage && adapter.isClickable('btnInvest') && g('funds') > 0) {
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
    var PROCESSOR_TARGET = 25;
    if (g('trust') > g('processors') + g('memory')) {
      var wantProc = g('processors') < 6 || (g('processors') < PROCESSOR_TARGET && g('processors') <= g('memory') / 10);
      var procId = wantProc ? 'btnAddProc' : 'btnAddMem';
      if (adapter.isClickable(procId)) {
        return act(adapter, procId, 'compute',
          'Allocating spare trust to ' + (wantProc ? 'processors' : 'memory') +
          ' (target: 6 processors early to unlock quantum computing, ~25 total by end of stage 1, rest memory).');
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
      if (qActiveCount > 0 && qSum >= qActiveCount * 0.6 && headroom > 50) {
        return act(adapter, 'btnQcompute', 'quantum',
          'Clicking quantum compute (signal ' + qSum.toFixed(2) + '/' + qActiveCount +
          ' active chips, headroom=' + Math.floor(headroom) + ' ops).');
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

      // Once bootstrapped: keep power supply ahead of demand (farmRate=50
      // vs factoryPowerRate=200 per main.js/globals.js - each factory needs
      // 4x a farm's output), keep harvester/wireDrone levels balanced (both
      // feed the same wire-production loop), and otherwise prioritize more
      // factories (the actual clip source) over more farms/batteries.
      var supply = farmLevel * 50 / 100;
      var demand = (g('harvesterLevel') * 1 / 100) + (g('wireDroneLevel') * 1 / 100) + (factoryLevel * 200 / 100);
      var powerRatio = demand > 0 ? supply / demand : Infinity;
      if (powerRatio < 1.1 && adapter.isClickable('btnMakeFarm')) {
        return act(adapter, 'btnMakeFarm', 'stage2',
          'Power supply (' + supply.toFixed(1) + ') close to demand (' + demand.toFixed(1) + ') - adding a Solar Farm.');
      }
      if (adapter.isClickable('btnMakeFactory')) {
        return act(adapter, 'btnMakeFactory', 'stage2', 'Buying a Factory (the primary clip-production driver).');
      }
      var harvesterLevel = g('harvesterLevel'), wireDroneLevel = g('wireDroneLevel');
      var droneOrder = harvesterLevel <= wireDroneLevel
        ? ['btnMakeHarvester', 'btnMakeWireDrone']
        : ['btnMakeWireDrone', 'btnMakeHarvester'];
      for (var b2 = 0; b2 < droneOrder.length; b2++) {
        if (adapter.isClickable(droneOrder[b2])) {
          return act(adapter, droneOrder[b2], 'stage2',
            'Buying ' + (droneOrder[b2] === 'btnMakeHarvester' ? 'a Harvester' : 'a Wire Drone') +
            ' (keeping harvester/wireDrone levels balanced - both feed the same wire loop).');
        }
      }
      if (adapter.isClickable('btnMakeFarm')) {
        return act(adapter, 'btnMakeFarm', 'stage2', 'Buying a Solar Farm (fallback - nothing else affordable).');
      }
      if (adapter.isClickable('btnMakeBattery')) {
        return act(adapter, 'btnMakeBattery', 'stage2', 'Buying a Battery Tower (fallback - nothing else affordable).');
      }
    }

    // 14. Stage 3: launch probes, allocate stat points, buy more probe trust.
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

// Drives the autoplay policy against the headless simulator at full sim
// speed - this is the "speed up wall-clock time" integration: the same
// policy that can drive the real browser page (bot/panel.js) can instead
// drive sim/harness.js's Sim, which ticks far faster than real time
// (77,991 ticks/sec last measured, vs the game's native 100 ticks/sec).
//
// Usage: node bot/run-headless.js [maxGameSeconds] [seed]
//
// Default cap is 3 simulated hours (10,800s): the Any% Desktop world record
// is 5,662s (1h34m22s), so any run that needs more than ~2x that time has
// already failed as a record attempt and the interesting data is WHERE it
// fell behind (see the milestone split table printed at the end, and
// RUNS.md for the run-by-run iteration log).
'use strict';

const { Sim } = require('../sim/harness');
const { SimAdapter } = require('./adapters/sim-adapter');
const policy = require('./policy');

const WR_SECONDS = 5662;
const MAX_GAME_SECONDS = process.argv[2] ? parseInt(process.argv[2], 10) : 3 * 3600;
const SEED = process.argv[3] ? parseInt(process.argv[3], 10) : 1;
// decide() reads a couple dozen game variables through the sim's eval-based
// Proxy (bot/adapters/sim-adapter.js), which - unlike the game's own native
// closure-scope execution - isn't free. Calling it every 10ms tick made
// headless runs ~20x slower than plain ticking. Actions are already
// rate-limited to 30/sec by the adapter, so nothing needs decide() faster
// than that; 5 ticks (50ms) keeps decisions well ahead of the click cap
// while cutting policy overhead ~5x.
const DECISION_INTERVAL_TICKS = 5;

const sim = new Sim({ seed: SEED });
const adapter = new SimAdapter(sim);

const phaseCounts = {};
const lastActionByPhase = {};
let totalActions = 0;
let lastLogSecond = -1;

const t0 = Date.now();
let finished = false;
let stuckReason = null;

while (sim.now < MAX_GAME_SECONDS * 1000) {
  sim.tick(DECISION_INTERVAL_TICKS);
  const result = policy.decide(adapter);
  if (result.action !== 'wait') {
    totalActions++;
    phaseCounts[result.phase] = (phaseCounts[result.phase] || 0) + 1;
    lastActionByPhase[result.phase] = result.reason;
  }

  const gameSecond = Math.floor(sim.now / 1000);
  if (gameSecond !== lastLogSecond && gameSecond % 60 === 0) {
    lastLogSecond = gameSecond;
    const c = sim.ctx;
    const epoch = policy.currentEpoch((name) => c[name]);
    console.log(
      `[t=${gameSecond}s] epoch=${epoch} clips=${c.clips.toExponential(2)} trust=${c.trust} ` +
      `funds=${c.funds.toFixed(0)} port=${Math.round(c.portTotal)} yomi=${Math.round(c.yomi)} ` +
      `mem=${c.memory} proc=${c.processors} marketing=${c.marketingLvl} megas=${c.megaClipperLevel} ` +
      `factories=${c.factoryLevel} drones=${c.harvesterLevel + c.wireDroneLevel} ` +
      `batteries=${c.batteryLevel} storedPower=${Math.round(c.storedPower / 1e6)}M ` +
      `matter=${c.availableMatter > 0 ? c.availableMatter.toExponential(1) : 0} ` +
      `probes=${c.probeCount > 0 ? c.probeCount.toExponential(1) : 0} ` +
      `drifters=${c.drifterCount > 0 ? c.drifterCount.toExponential(1) : 0} ` +
      `unused=${c.unusedClips > 0 ? c.unusedClips.toExponential(1) : 0} honor=${Math.round(c.honor)} actions=${totalActions}`
    );
  }

  if (sim.ctx.milestoneFlag >= 15 && sim.ctx.dismantle >= 4 && sim.ctx.finalClips >= 100) {
    finished = true;
    break;
  }
  if (sim.resetRequested) {
    stuckReason = 'game requested a reset (location.reload) - likely an unhandled soft-lock';
    break;
  }
}

const wallMs = Date.now() - t0;
const finalSeconds = sim.now / 1000;
console.log('\n=== run complete ===');
console.log('finished:', finished, stuckReason ? `(${stuckReason})` : '');
console.log(`simulated ${finalSeconds.toFixed(1)}s of game time in ${(wallMs / 1000).toFixed(1)}s wall time ` +
  `(${(sim.now / wallMs).toFixed(0)}x real time)`);
if (finished) {
  const delta = finalSeconds - WR_SECONDS;
  console.log(delta < 0
    ? `*** BEAT THE WORLD RECORD by ${(-delta).toFixed(1)}s (${finalSeconds.toFixed(1)}s vs ${WR_SECONDS}s) ***`
    : `world record missed by ${delta.toFixed(1)}s (${finalSeconds.toFixed(1)}s vs ${WR_SECONDS}s)`);
}

// Milestone split table: actual vs target, the core iteration feedback.
// One final recording pass first: the loop breaks the instant the finish
// condition holds, which can be BETWEEN decide() calls - without this the
// 'credits' milestone shows NOT REACHED on a finished run.
policy.status(adapter);
console.log('\nmilestone splits (target vs actual):');
const times = adapter.__milestoneTimes || {};
for (const m of policy.MILESTONES) {
  const at = times[m.id];
  const actual = at !== undefined ? `${(at / 1000).toFixed(0)}s` : '--';
  const verdict = at === undefined ? 'NOT REACHED'
    : (at / 1000 <= m.targetSec ? `ahead by ${(m.targetSec - at / 1000).toFixed(0)}s` : `BEHIND by ${(at / 1000 - m.targetSec).toFixed(0)}s`);
  console.log(`  ${m.label.padEnd(30)} target ${String(m.targetSec).padStart(5)}s  actual ${actual.padStart(7)}  ${verdict}`);
}

console.log('\ntotal bot actions:', totalActions);
console.log('actions by phase:', phaseCounts);
console.log('final snapshot:', sim.snapshot());

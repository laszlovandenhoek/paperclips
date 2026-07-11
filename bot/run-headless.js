// Drives the autoplay policy against the headless simulator at full sim
// speed - this is the "speed up wall-clock time" integration: the same
// policy that can drive the real browser page (bot/panel.js) can instead
// drive sim/harness.js's Sim, which ticks far faster than real time
// (77,991 ticks/sec last measured, vs the game's native 100 ticks/sec).
//
// Usage: node bot/run-headless.js [maxGameSeconds] [seed]
'use strict';

const { Sim } = require('../sim/harness');
const { SimAdapter } = require('./adapters/sim-adapter');
const policy = require('./policy');

const MAX_GAME_SECONDS = process.argv[2] ? parseInt(process.argv[2], 10) : 3600 * 24 * 7; // 1 sim-week default cap
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
    console.log(
      `[t=${gameSecond}s] clips=${Math.floor(c.clips)} trust=${c.trust} funds=${c.funds.toFixed(0)} ` +
      `humanFlag=${c.humanFlag} spaceFlag=${c.spaceFlag} dismantle=${c.dismantle} milestoneFlag=${c.milestoneFlag} ` +
      `actions=${totalActions}`
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
console.log('\n=== run complete ===');
console.log('finished:', finished, stuckReason ? `(${stuckReason})` : '');
console.log(`simulated ${(sim.now / 1000).toFixed(1)}s of game time in ${(wallMs / 1000).toFixed(1)}s wall time ` +
  `(${(sim.now / wallMs).toFixed(0)}x real time)`);
console.log('total bot actions:', totalActions);
console.log('actions by phase:', phaseCounts);
console.log('final snapshot:', sim.snapshot());

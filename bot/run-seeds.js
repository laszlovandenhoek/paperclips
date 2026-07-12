// Runs the policy across several seeds back-to-back and prints one split
// table per seed plus a summary line - the WR hunt tolerates per-seed luck
// (stock market, quantum phases, tournament grids), so policy changes get
// judged on the spread, not a single seed.
//
// Usage: node bot/run-seeds.js [maxGameSeconds] [seed1,seed2,...]
'use strict';

const { Sim } = require('../sim/harness');
const { SimAdapter } = require('./adapters/sim-adapter');
const policy = require('./policy');

const MAX_GAME_SECONDS = process.argv[2] ? parseInt(process.argv[2], 10) : 3 * 3600;
const SEEDS = (process.argv[3] || '1,2,3').split(',').map(Number);
const DECISION_INTERVAL_TICKS = 5;
const WR_SECONDS = 5662;

const summary = [];
for (const seed of SEEDS) {
  const sim = new Sim({ seed });
  const adapter = new SimAdapter(sim);
  let finished = false;
  while (sim.now < MAX_GAME_SECONDS * 1000) {
    sim.tick(DECISION_INTERVAL_TICKS);
    policy.decide(adapter);
    if (sim.ctx.milestoneFlag >= 15 && sim.ctx.dismantle >= 4 && sim.ctx.finalClips >= 100) { finished = true; break; }
    if (sim.resetRequested) break;
  }
  const t = sim.now / 1000;
  const times = adapter.__milestoneTimes || {};
  console.log(`\n=== seed ${seed}: ${finished ? 'FINISHED in ' + t.toFixed(0) + 's' + (t < WR_SECONDS ? ' *** BEATS WR ***' : ` (WR+${(t - WR_SECONDS).toFixed(0)}s)`) : 'not finished by ' + t.toFixed(0) + 's'} ===`);
  for (const m of policy.MILESTONES) {
    const at = times[m.id];
    console.log(`  ${m.label.padEnd(30)} ${at !== undefined ? (at / 1000).toFixed(0) + 's' : '--'}`);
  }
  summary.push({ seed, finished, t });
}

console.log('\n=== summary ===');
for (const s of summary) {
  console.log(`seed ${s.seed}: ${s.finished ? s.t.toFixed(0) + 's' + (s.t < WR_SECONDS ? ' BEATS WR' : '') : 'DNF'}`);
}

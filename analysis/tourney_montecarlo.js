// Monte Carlo cross-check of tourney_exact.js, driving the REAL game code
// (via the headless simulator) instead of a reimplementation. Bypasses the
// setTimeout-paced round()/roundLoop()/clearGrid() UI choreography and
// instead replicates its logic with direct calls to the actual top-level
// functions (pickStrats, calcPayoff) and globals (hStrat/vStrat/hMove/
// hMovePrev/etc) that round()'s nested runRound() would have used - so this
// exercises the real pickMove() implementations, calcPayoff(), and RNG.
'use strict';

const { Sim } = require('../sim/harness');

const N = 8;
const NAMES = ['RANDOM', 'A100', 'B100', 'GREEDY', 'GENEROUS', 'MINIMAX', 'TITFORTAT', 'BEATLAST'];

const TRIALS = process.argv[2] ? parseInt(process.argv[2], 10) : 20000;

const sim = new Sim({ seed: 4242 });
sim.tick(1);

// Wire up all 8 strategies as active, in the canonical unlock order, exactly
// once (outside the trial loop - the array identity persists across trials).
sim.eval(`
  strats = [stratRandom, stratA100, stratB100, stratGreedy, stratGenerous, stratMinimax, stratTitfortat, stratBeatlast];
  for (var i = 0; i < strats.length; i++) strats[i].active = 1;
`);

const totals = new Array(N).fill(0);
const totalsSq = new Array(N).fill(0);

for (let t = 0; t < TRIALS; t++) {
  sim.eval(`
    for (var i = 0; i < strats.length; i++) strats[i].currentScore = 0;
    generateGrid();
    stratCounter = 0;
    for (var roundNum = 0; roundNum < strats.length * strats.length; roundNum++) {
      pickStrats(roundNum);
      for (var sub = 0; sub < 10; sub++) {
        hMovePrev = hMove;
        vMovePrev = vMove;
        hMove = hStrat.pickMove();
        vMove = vStrat.pickMove();
        calcPayoff(hMove, vMove);
      }
    }
  `);
  const scores = sim.eval('strats.map(function(s){return s.currentScore;})');
  for (let i = 0; i < N; i++) {
    totals[i] += scores[i];
    totalsSq[i] += scores[i] * scores[i];
  }
}

console.log(`Monte Carlo E[score] per strategy over ${TRIALS} tournaments (driving real game code):\n`);
const rows = NAMES.map((name, i) => {
  const mean = totals[i] / TRIALS;
  const variance = totalsSq[i] / TRIALS - mean * mean;
  const stderr = Math.sqrt(Math.max(variance, 0) / TRIALS);
  return { name, mean, stderr };
});
rows.sort((a, b) => b.mean - a.mean);
for (const r of rows) console.log(`  ${r.name.padEnd(10)} ${r.mean.toFixed(4)}  +/- ${(1.96 * r.stderr).toFixed(4)} (95% CI)`);

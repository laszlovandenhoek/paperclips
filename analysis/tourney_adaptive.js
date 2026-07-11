// Follow-up to tourney_yomi.js, addressing two gaps flagged in review:
//
// 1. tourney_yomi.js only evaluated FIXED pick policies ("always pick X").
//    But the payoff grid is revealed (newTourney() -> generateGrid(), UI
//    updated) BEFORE the tournament runs and BEFORE `pick` is read
//    (declareWinner() only fires once the full round-robin completes) - so a
//    real bot can read the grid, compute each strategy's exact expected
//    score for THAT SPECIFIC grid (tourney_exact.js's per-grid function,
//    which is genuinely exact for 6 of 8 strategies - only RANDOM/TITFORTAT/
//    BEATLAST have any residual randomness once the grid is fixed), and
//    pick argmax - a legitimately realizable adaptive policy, not hindsight.
// 2. tourney_yomi.js didn't model project128 (Strategic Attachment)'s
//    +50,000 / +30,000 / +20,000 yomi bonus for finishing 1st / 2nd / 3rd
//    (main.js:2134-2154), which ROUTES.md itself flags as the "dominant
//    yomi source lategame" - a significant omission.
//
// This compares, per trial, on the SAME realized grid and SAME stochastic
// tournament outcome: fixed-BEATLAST vs adaptive-argmax-E[score], with and
// without the project128 bonus.
'use strict';

const { Sim } = require('../sim/harness');
const { exactScoresForGrid, NAMES, N } = require('./tourney_exact');

const TRIALS = process.argv[2] ? parseInt(process.argv[2], 10) : 20000;

const sim = new Sim({ seed: 999 });
sim.tick(1);
sim.eval(`
  strats = [stratRandom, stratA100, stratB100, stratGreedy, stratGenerous, stratMinimax, stratTitfortat, stratBeatlast];
  for (var i = 0; i < strats.length; i++) strats[i].active = 1;
`);

const BEATLAST_IDX = NAMES.indexOf('BEATLAST');

function bonus(rankBucket) {
  // project128: +50k/1st, +30k/2nd, +20k/3rd (ties count, main.js:2134-2154)
  if (rankBucket === 1) return 50000;
  if (rankBucket === 2) return 30000;
  if (rankBucket === 3) return 20000;
  return 0;
}

const stats = {
  fixed: { sum: 0, sumSq: 0, sumWithBonus: 0, sumWithBonusSq: 0 },
  adaptive: { sum: 0, sumSq: 0, sumWithBonus: 0, sumWithBonusSq: 0 },
};
const adaptiveChoiceCounts = new Array(N).fill(0);

for (let t = 0; t < TRIALS; t++) {
  sim.eval(`
    for (var i = 0; i < strats.length; i++) strats[i].currentScore = 0;
    generateGrid();
    stratCounter = 0;
  `);
  const [aa, ab, ba, bb] = sim.eval('[aa, ab, ba, bb]');

  // Adaptive pick: exact E[score|grid] for this specific realized grid.
  const exactForThisGrid = exactScoresForGrid(aa, ab, ba, bb);
  let adaptiveIdx = 0;
  for (let i = 1; i < N; i++) if (exactForThisGrid[i] > exactForThisGrid[adaptiveIdx]) adaptiveIdx = i;
  adaptiveChoiceCounts[adaptiveIdx]++;

  // Run the actual stochastic tournament on this same grid.
  sim.eval(`
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
    pickWinner();
  `);

  for (const [key, idx] of [['fixed', BEATLAST_IDX], ['adaptive', adaptiveIdx]]) {
    sim.eval(`pick = ${idx};`);
    const beatBoost = sim.eval('calculateStratsBeat()') - 1;
    const score = sim.eval('strats[pick].currentScore');
    const raw = score * beatBoost;

    // Replicate declareWinner()'s rank-bucket checks exactly (main.js:2134-2154).
    const isWinner = sim.eval(`results[0].currentScore === strats[pick].currentScore`);
    const isPlace = sim.eval(`placeScore === strats[pick].currentScore`);
    const isShow = sim.eval(`showScore === strats[pick].currentScore`);
    const bonusYomi = isWinner ? bonus(1) : isPlace ? bonus(2) : isShow ? bonus(3) : 0;

    const s = stats[key];
    s.sum += raw; s.sumSq += raw * raw;
    const withBonus = raw + bonusYomi;
    s.sumWithBonus += withBonus; s.sumWithBonusSq += withBonus * withBonus;
  }
}

function report(label, s) {
  const mean = s.sum / TRIALS;
  const se = Math.sqrt(Math.max(s.sumSq / TRIALS - mean * mean, 0) / TRIALS);
  const meanB = s.sumWithBonus / TRIALS;
  const seB = Math.sqrt(Math.max(s.sumWithBonusSq / TRIALS - meanB * meanB, 0) / TRIALS);
  console.log(`  ${label.padEnd(28)} score*beatBoost: ${mean.toFixed(1).padStart(8)} +/- ${(1.96 * se).toFixed(1).padStart(6)}   with project128: ${meanB.toFixed(1).padStart(9)} +/- ${(1.96 * seB).toFixed(1).padStart(6)}`);
}

console.log(`${TRIALS} trials, same grid+RNG shared between fixed and adaptive picks per trial:\n`);
report('fixed pick = BEATLAST', stats.fixed);
report('adaptive pick = argmax E[score|grid]', stats.adaptive);

console.log('\nAdaptive pick distribution (how often each strategy is argmax for the realized grid):');
const order = NAMES.map((name, i) => ({ name, count: adaptiveChoiceCounts[i] })).sort((a, b) => b.count - a.count);
for (const o of order) console.log(`  ${o.name.padEnd(10)} ${(100 * o.count / TRIALS).toFixed(1)}%`);

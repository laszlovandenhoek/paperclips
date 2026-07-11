// Which `pick` (of the 8 strategies) maximizes expected yomi per tournament?
// yomi added (declareWinner(), main.js:2125) = strats[pick].currentScore *
// yomiBoost * beatBoost, where beatBoost = calculateStratsBeat()-1 and
// calculateStratsBeat ranks pick's score against the full sorted field
// (pickWinner()). Uses the REAL game's pickWinner()/calculateStratsBeat()
// so tie-breaking etc. matches exactly - only the yomiBoost factor (a
// separate project-driven multiplier, same for every pick) is omitted since
// it doesn't affect which pick is best.
'use strict';

const { Sim } = require('../sim/harness');

const N = 8;
const NAMES = ['RANDOM', 'A100', 'B100', 'GREEDY', 'GENEROUS', 'MINIMAX', 'TITFORTAT', 'BEATLAST'];
const TRIALS = process.argv[2] ? parseInt(process.argv[2], 10) : 20000;

const sim = new Sim({ seed: 777 });
sim.tick(1);
sim.eval(`
  strats = [stratRandom, stratA100, stratB100, stratGreedy, stratGenerous, stratMinimax, stratTitfortat, stratBeatlast];
  for (var i = 0; i < strats.length; i++) strats[i].active = 1;
`);

const yomiTotals = new Array(N).fill(0);
const yomiTotalsSq = new Array(N).fill(0);
const winCount = new Array(N).fill(0); // how often each strat is the outright top scorer

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
    pickWinner();
  `);
  const beats = [];
  for (let i = 0; i < N; i++) {
    sim.eval(`pick = ${i};`);
    const beatBoost = sim.eval('calculateStratsBeat()') - 1;
    const score = sim.eval('strats[pick].currentScore');
    beats.push(score * beatBoost);
  }
  const top = sim.eval('results[0].name');
  for (let i = 0; i < N; i++) {
    yomiTotals[i] += beats[i];
    yomiTotalsSq[i] += beats[i] * beats[i];
    if (NAMES[i] === top) winCount[i]++;
  }
}

console.log(`E[score * beatBoost] per pick over ${TRIALS} tournaments (real game code, yomiBoost omitted - constant across picks):\n`);
const rows = NAMES.map((name, i) => {
  const mean = yomiTotals[i] / TRIALS;
  const variance = yomiTotalsSq[i] / TRIALS - mean * mean;
  const stderr = Math.sqrt(Math.max(variance, 0) / TRIALS);
  return { name, mean, stderr, winRate: winCount[i] / TRIALS };
});
rows.sort((a, b) => b.mean - a.mean);
for (const r of rows) {
  console.log(`  ${r.name.padEnd(10)} ${r.mean.toFixed(2).padStart(9)}  +/- ${(1.96 * r.stderr).toFixed(2).padStart(6)} (95% CI)   outright-win rate: ${(r.winRate * 100).toFixed(1)}%`);
}

// Exact (non-Monte-Carlo) analysis of the 8-strategy tournament round-robin
// in main.js (strats/allStrats, pickStrats/round/runRound/calcPayoff).
//
// Mechanics (verified against main.js:1694-2320):
//  - 8 strategies, unlocked in a fixed order (projects.js gates strats.push in
//    exactly this order): RANDOM, A100, B100, GREEDY, GENEROUS, MINIMAX,
//    TITFORTAT, BEATLAST. Indices 0-7 below match that order.
//  - A tournament plays all 8x8=64 ordered (h,v) pairs exactly once
//    (pickStrats(roundNum), roundNum 0..63), including self-play (h==v).
//  - Each pairing plays 10 sub-rounds (runRound() x10) before moving on.
//  - hMove/vMove/hMovePrev/vMovePrev are GLOBAL and persist across the ENTIRE
//    640-round sequence, not reset between pairings - a strategy's first move
//    against a new opponent can depend on what the previous opponent did.
//  - Only RANDOM is stochastic per-call (50/50). GREEDY/GENEROUS/MINIMAX/A100/
//    B100 are deterministic functions of the (fixed, per-tournament) grid
//    alone. TITFORTAT/BEATLAST are deterministic functions of
//    (hMovePrev,vMovePrev) and `this.currentPos`.
//  - currentPos quirk: pickStrats does `strats[h].currentPos=1;
//    strats[v].currentPos=2`. In self-play (h===v) the second assignment
//    overwrites the first, so a self-playing TITFORTAT/BEATLAST sees
//    currentPos=2 for BOTH its h-call and v-call that round - reproduced
//    exactly below, not "fixed".
//
// Because the only state that survives across rounds is
// (hMovePrev,vMovePrev) - a 4-valued Markov state - and grids only take
// 10^4=10,000 equally likely integer values, E[score] per strategy is exactly
// computable by forward probability propagation over that 4-state chain, for
// each grid, averaged over all 10,000 grids. No sampling anywhere in this file.
'use strict';

const NAMES = ['RANDOM', 'A100', 'B100', 'GREEDY', 'GENEROUS', 'MINIMAX', 'TITFORTAT', 'BEATLAST'];
const N = 8;

function findBiggestPayoff(aa, ab, ba, bb) {
  if (aa >= ab && aa >= ba && aa >= bb) return 1;
  if (ab >= aa && ab >= ba && ab >= bb) return 2;
  if (ba >= aa && ba >= ab && ba >= bb) return 3;
  return 4;
}

// what-beats-last, exactly mirroring main.js:1879-1917 (myPos is `this.currentPos`)
function whatBeatsLast(myPos, aa, ab, ba, bb, hMovePrev, vMovePrev) {
  const oppsPos = myPos === 1 ? 2 : 1;
  if (oppsPos === 1 && hMovePrev === 1) return aa > ba ? 1 : 2;
  if (oppsPos === 1 && hMovePrev === 2) return ab > bb ? 1 : 2;
  if (oppsPos === 2 && vMovePrev === 1) return aa > ba ? 1 : 2;
  return ab > bb ? 1 : 2; // oppsPos==2 && vMovePrev==2
}

// Returns the move distribution for strategy `idx` in role `pos` (1=h,2=v),
// as an array of [move, prob] pairs (prob sums to 1). All non-RANDOM
// strategies return a single [move,1] pair.
function moveDist(idx, pos, aa, ab, ba, bb, hp, vp) {
  switch (idx) {
    case 0: return [[1, 0.5], [2, 0.5]]; // RANDOM
    case 1: return [[1, 1]]; // A100
    case 2: return [[2, 1]]; // B100
    case 3: { const x = findBiggestPayoff(aa, ab, ba, bb); return [[x < 3 ? 1 : 2, 1]]; } // GREEDY
    case 4: { // GENEROUS
      const x = findBiggestPayoff(aa, ab, ba, bb);
      return [[(x === 1 || x === 3) ? 1 : 2, 1]];
    }
    case 5: { // MINIMAX
      const x = findBiggestPayoff(aa, ab, ba, bb);
      return [[(x === 1 || x === 3) ? 2 : 1, 1]];
    }
    case 6: // TITFORTAT
      return [[pos === 1 ? vp : hp, 1]];
    case 7: // BEATLAST
      return [[whatBeatsLast(pos, aa, ab, ba, bb, hp, vp), 1]];
    default: throw new Error('bad idx');
  }
}

// payoff to (h,v) given their moves, from the grid
function payoff(hm, vm, aa, ab, ba, bb) {
  if (hm === 1 && vm === 1) return [aa, aa];
  if (hm === 1 && vm === 2) return [ab, ba];
  if (hm === 2 && vm === 1) return [ba, ab];
  return [bb, bb];
}

// Exact pairing sequence for a full tournament (mirrors pickStrats()).
function pairingSequence() {
  const seq = [];
  let stratCounter = 0;
  for (let roundNum = 0; roundNum < N * N; roundNum++) {
    let h, v;
    if (roundNum < N) {
      h = 0; v = roundNum;
    } else {
      stratCounter++;
      if (stratCounter >= N) stratCounter -= N;
      h = Math.floor(roundNum / N);
      v = stratCounter;
    }
    seq.push([h, v]);
  }
  return seq;
}

const PAIRINGS = pairingSequence();

// Exact E[score] per strategy for one grid (aa,ab,ba,bb), via forward
// propagation of the 4-state (hMovePrev,vMovePrev) distribution across all
// 640 sub-rounds.
function exactScoresForGrid(aa, ab, ba, bb) {
  const score = new Array(N).fill(0);
  // state distribution over (hp,vp) in {1,2}x{1,2}, indexed [hp-1][vp-1]
  let dist = [[1, 0], [0, 0]]; // point mass at (1,1)

  for (const [h, v] of PAIRINGS) {
    const posH = h === v ? 2 : 1; // currentPos quirk on self-play
    const posV = 2;
    for (let sub = 0; sub < 10; sub++) {
      const next = [[0, 0], [0, 0]];
      let evH = 0, evV = 0;
      for (let hp = 1; hp <= 2; hp++) {
        for (let vp = 1; vp <= 2; vp++) {
          const p = dist[hp - 1][vp - 1];
          if (p === 0) continue;
          const hMoves = moveDist(h, posH, aa, ab, ba, bb, hp, vp);
          const vMoves = moveDist(v, posV, aa, ab, ba, bb, hp, vp);
          for (const [hm, ph] of hMoves) {
            for (const [vm, pv] of vMoves) {
              const jp = p * ph * pv;
              const [payH, payV] = payoff(hm, vm, aa, ab, ba, bb);
              evH += jp * payH;
              evV += jp * payV;
              next[hm - 1][vm - 1] += jp;
            }
          }
        }
      }
      // self-play: h===v means both increments land on the same strategy
      score[h] += evH;
      score[v] += evV;
      dist = next;
    }
  }
  return score;
}

function main() {
  const total = new Array(N).fill(0);
  let grids = 0;
  for (let aa = 1; aa <= 10; aa++) {
    for (let ab = 1; ab <= 10; ab++) {
      for (let ba = 1; ba <= 10; ba++) {
        for (let bb = 1; bb <= 10; bb++) {
          const s = exactScoresForGrid(aa, ab, ba, bb);
          for (let i = 0; i < N; i++) total[i] += s[i];
          grids++;
        }
      }
    }
  }
  console.log(`Exact E[score] per strategy, averaged over all ${grids} equally-likely grids:\n`);
  const rows = NAMES.map((name, i) => ({ name, mean: total[i] / grids }));
  rows.sort((a, b) => b.mean - a.mean);
  for (const r of rows) console.log(`  ${r.name.padEnd(10)} ${r.mean.toFixed(6)}`);
}

module.exports = { exactScoresForGrid, NAMES, N };

if (require.main === module) main();

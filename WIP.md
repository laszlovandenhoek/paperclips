# Work in progress — 2026-07-10

## Where we are

Goal (see README.md): prove the optimal strategy for winning Universal Paperclips.
Method (see ROUTES.md): explicitly define the route space, prune by dominance, then
optimize within surviving routes.

**Note on `src/`:** earlier sessions treated `src/` as a byte-for-byte-unmodified
mirror. That constraint was a misunderstanding — the user has confirmed it's fine to
change or reimplement game source (even in another language) as long as the
replacement is behaviorally equivalent. `src/combat.js` has one small, deliberate edit
(see below); the underlying game logic there is unchanged, only when it runs.

### Done

1. **Source analysis complete.** All 96 projects in `src/projects.js` read and
   catalogued; `main.js` / `combat.js` / `globals.js` mechanics extracted (formulas,
   tick loops, phase gates, combat math, endgame sequence). Key facts are recorded in
   ROUTES.md with file:line references.
2. **ROUTES.md written**, and **P3 (always/never-take lemmas) resolved this session** —
   see below. Mandatory backbone (G1–G14), 10 decision dimensions (D1–D10), 6 route
   archetypes (R1–R6), pruning plan (P0–P5), open questions (OQ1–OQ5), conjectures
   C1–C3 (C2 now proven, not conjectured).
3. **P0 headless simulator built and validated** (`sim/`) — see "Performance" below.
   `sim/validate.js` is 37/37, throughput 77,991 ticks/sec (≈48× the session-1 baseline).

### P3 — always/never-take lemmas (done this session)

Four sub-results, all written up in ROUTES.md §4 with derivations; scripts live in
`analysis/`:

1. **Wire-supply / clipper-boost upgrades: always take.** All 12 are ops-only,
   permanent, non-negative production multipliers. Worst-case total delay (pessimistic
   `processors=1` floor) is ≈174 minutes one-time; skipping them buys nothing (no
   competing use for the ops) while stage 1's alternative trust source (below) needs
   far longer horizons if this chain is skipped. Always take.
2. **RevTracker: never take — strict dominance, not just a guess.** Its only effect
   (`revPerSecFlag`) gates one `.style.display` toggle and nothing else — grepped every
   reference. Positive ops cost, provably zero effect on any state that matters.
3. **C2 proven: CEV→Cancer→Peace→Warming→Baldness chain is always taken.** Exact cost
   500 creat + 22,500 yomi + 145,000 ops for **+58 trust** — more than the ~33
   non-fixed trust points any route needs beyond the fixed 67-point baseline, i.e. this
   chain alone can make the fibonacci clip-milestone trust source unnecessary. The
   alternative (fibonacci milestones, threshold `fib2×1000`) hits 28.7M clips at
   milestone 20 and 14.9B at milestone 33 — golden-ratio growth. Always take.
4. **Tournament pick policy: the original "GREEDY dominates" conjecture was wrong —
   BEATLAST dominates.** This was the interesting one. Modeled the full 8-strategy
   round-robin exactly (`analysis/tourney_exact.js`): 64 ordered pairings × 10
   sub-rounds, global move-history state that persists *across* pairings, a
   `currentPos` self-play quirk. Only RANDOM is stochastic per-move, which collapses
   the whole process to a 4-state Markov chain — exactly solvable (no sampling) by
   forward probability propagation over all 10,000 equally-likely integer payoff
   grids. Cross-validated against 100,000-trial Monte Carlo driving the *actual* game
   functions via the simulator (`analysis/tourney_montecarlo.js`) — matched within
   confidence intervals, which also validates the harness for this kind of use.
   Exact E[score]: BEATLAST 1083.45 > GREEDY 1059.97 > GENEROUS 940.06 > ... The
   yomi-relevant metric is actually `score × beatBoost` (rank-weighted, not
   winner-take-all) — computed via 100k-trial Monte Carlo on real game code
   (`analysis/tourney_yomi.js`): BEATLAST 5507±13 vs GREEDY 5314±16 (95% CI,
   non-overlapping), a consistent ~3.6% edge. BEATLAST's outright-tournament-win rate
   is 0.0% (never #1, extremely consistently #2/#3) vs GREEDY's 18.1% — high
   consistency beats high ceiling under rank-weighted scoring. Always pick BEATLAST
   once it's unlocked (unlock order is forced anyway — `projects.js` chains each
   strategy's trigger on the previous one's flag).

Whether to unlock all 7 strategies at all (tourneyCost-vs-yomi tradeoff) is a separate,
still-open D5 question left for P4.

### Performance: two rounds, ~48× total (1,600 → 77,991 ticks/sec)

**Round 1 — eliminate `vm`.** Node `vm` contextified sandboxes intercept every global
variable access through C++, capping throughput at ~1,600 ticks/sec (16× real time).
Replaced with a plain function-wrapper closure (`sim/harness.js`): all game `var`s
become closure locals instead of vm-intercepted global-object properties, compiled once
via indirect eval into a factory, instantiated fresh per `Sim`. Result: only
3,800–10,000 ticks/sec — a real but smaller gain than hoped, because it exposed round 2.

*Implicit-global safety:* the wrapper blanket-predeclares `var` for **every** bare
assignment-target identifier found anywhere in the 4 files (816 names, computed by
`sim/scan-globals.js` — a static ES5 scanner, fiddly to get right because of ASI and
nested-function-expression pitfalls, see git history). Provably safe (nested `var`
always shadows), and confirmed via `Object.getOwnPropertyNames(globalThis)` diffing:
zero leaked globals across a 5,000-tick run with clicks.

*Bug found and fixed:* the wrapper originally ran in strict mode. `combat.js`'s
`createBattle()` calls `Battle()` without `new` and relies on sloppy-mode `this`
defaulting to the global object; under strict mode this threw the instant a real battle
triggered, invisible until a test (T11, added this session) reached stage-3 combat.
Fixed by dropping `"use strict"` — the predeclare already makes it unnecessary.

**Round 2 — the game always runs a 400-ship combat animation**, unconditionally from
script load (`combat.js:799-800`), regardless of whether the player has reached combat.
Traced every consumer: `DoCombat()`'s state-mutating effects are all scaled by
`unitSize`, which stays 0 until the first real battle (gated independently, via
`checkForBattles()`/`war()` on `drifterCount > 1,000,000`) — so the whole
`ClearFrame→UpdateGrid→MoveShips→DoCombat` cycle is a provable no-op while dormant, i.e.
for most of any playthrough. Added a one-line early return in `Update()` gated on
`unitSize === 0`. Verified equivalence: validate.js stays green, and a forced-real-battle
test produces bit-for-bit identical results with and without the change (`git stash`
A/B) — confirming the gate only ever skips the provably-inert dormant case. Note: this
does change which `Math.random()` draws get consumed while dormant, so fixed-seed
trajectories are no longer numerically identical to pre-change runs — expected, not a
correctness regression (same-code-same-seed determinism still holds).

**Result: 77,991 ticks/sec (780× real time), ~48× faster overall.** Re-profiled: the
hot path is now genuine game logic (per-tick DOM `innerHTML` writes, number
formatting/spelling) — real work, not waste. Good stopping point for P0 throughput.

## Task list state

- #1 done: main.js extraction. #2 done: combat/globals extraction.
- #3 done: headless simulator harness (P0).
- P3 (always/never-take lemmas) done this session — see above.

## Next: resume the ROUTES.md plan

1. P1: kill R6 (prestige loops) analytically. Not yet started.
2. Canvas-combat response-surface harness (isolated `DoCombat` + flocking Monte Carlo
   over probeCombat × probeSpeed × ship ratio) → feeds Lanchester outer model. The
   400-ship loop investigated in the perf work is already exactly the math this step
   needs — the `Update()` dormant-gate doesn't touch it once a real battle exists.
3. P4 axis-winner A/B runs in the simulator (D2, D3, D5 — including the still-open
   "how many strategies to unlock" question, D6, D7, D9/D10), then C3 (purchased vs
   fought honor), OQ1 (quantum tempOps bypassing memory gates), OQ3 (maxTrust-20
   finish feasibility).

## Repo state

- `sim/` — headless simulator (env.js, harness.js, scan-globals.js, validate.js).
- `analysis/` — new this session: `tourney_exact.js`, `tourney_montecarlo.js`,
  `tourney_yomi.js` (P3's tournament pick-policy analysis).
- `src/combat.js` — one-line dormant-period gate in `Update()` (see Performance above).
- ROUTES.md — P3 results and the D4/D5 conjecture corrections written in.

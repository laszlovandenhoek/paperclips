# Work in progress — 2026-07-10

## Where we are

Goal (see README.md): prove the optimal strategy for winning Universal Paperclips.
Method (see ROUTES.md): explicitly define the route space, prune by dominance, then
optimize within surviving routes.

**Note on `src/`:** earlier sessions treated `src/` as a byte-for-byte-unmodified
mirror. That constraint was a misunderstanding — the user has confirmed it's fine to
change or reimplement game source (even in another language) as long as the
replacement is behaviorally equivalent. `src/combat.js` now has one small, deliberate
edit (see below); the underlying game logic there is unchanged, only when it runs.

### Done

1. **Source analysis complete.** All 96 projects in `src/projects.js` read and
   catalogued; `main.js` / `combat.js` / `globals.js` mechanics extracted (formulas,
   tick loops, phase gates, combat math, endgame sequence). Key facts are recorded in
   ROUTES.md with file:line references.
2. **ROUTES.md written.** Mandatory backbone (G1–G14), 10 decision dimensions (D1–D10),
   6 route archetypes (R1–R6), pruning plan (P0–P5), open questions (OQ1–OQ5),
   conjectures C1–C3. Includes the combat analysis split: numeric engine is closed-form
   Lanchester (mean-field exact at N~1e6); canvas engine needs an isolated Monte Carlo
   response-surface harness; battle protraction is a documented dead end.
3. **P0 headless simulator built and validated** (`sim/`), rewritten this session:
   - `sim/env.js` — fake DOM (only surface the game touches), virtual-time scheduler
     (replaces setInterval/setTimeout, callbacks run in due-time order), seedable
     mulberry32 RNG, localStorage/Audio/location stubs. Unchanged since session 1.
   - `sim/harness.js` — **rewritten** to drop Node `vm` entirely (see "Performance"
     below). Loads the four src files (index2.html order: combat, globals, projects,
     main) as one plain-JS function-wrapper closure, compiled once via indirect eval
     and instantiated fresh per `Sim`. Player input = `sim.click(buttonId)`, legal only
     when the game's own `buttonUpdate()`/`manageProjects()` left the button
     attached+enabled. Browser "named access" (element ids as global vars, e.g.
     `btnLowerProbeHaz`) is replicated by predeclaring `var <id> = <element>` for every
     valid-identifier HTML id; script-level `var`s with the same name (confirmed real
     collisions: `adCost`, `batteryCost`, `batteryLevel` are both element ids and state
     variables) naturally overwrite it in source order, matching browser semantics.
     Deliberately **not** strict mode (see bug fix below).
   - `sim/scan-globals.js` — **new**. Static ES5 scanner (comment/string/regex-literal
     stripping + bracket-depth-aware `var`-declarator parsing) that finds every bare
     assignment-target identifier across the 4 source files, used to build the
     wrapper's predeclare prologue (see "Implicit-global safety" below). Fiddly to get
     right — see git history / code comments for the ASI and nested-function-expression
     pitfalls that produced two earlier wrong versions.
   - `sim/validate.js` — **37/37 pass**. T6/T10 assertions fixed to match actual
     game/policy behavior instead of unvalidated guesses. T11 added as a regression
     test for the strict-mode bug below (exercises real combat, which no other test
     reaches).

### Performance: two rounds, ~48× total (1,600 → 77,991 ticks/sec)

**Round 1 — eliminate `vm`.** Node `vm` contextified sandboxes intercept every global
variable access through C++, capping throughput at ~1,600 ticks/sec (16× real time).
Replaced with a plain function-wrapper closure (see harness.js above): all game `var`s
become closure locals instead of vm-intercepted global-object properties. Result: only
3,800–10,000 ticks/sec — a real but much smaller gain than hoped, because it exposed a
second bottleneck (round 2).

*Implicit-global safety:* rather than precisely attributing each bare assignment to its
enclosing function scope (hard to get exactly right with a regex scanner, and wrong-by-a-
little means a silent cross-instance state leak), the wrapper blanket-predeclares `var`
for **every** bare assignment-target identifier found anywhere in the 4 files (816
names, via `scan-globals.js`). Provably safe: a nested function's own `var x` always
shadows the wrapper-level one, so predeclaring names already properly scoped everywhere
is inert, while names that genuinely lack a local `var` in some function (confirmed
example: `h`/`v` inside `pickStrats()` in main.js — true implicit globals there despite
`var h` existing in unrelated harvester functions elsewhere in the file) now resolve to
the wrapper closure instead of leaking. Verified with `Object.getOwnPropertyNames
(globalThis)` diffing before/after a 5,000-tick run with clicks: zero leaked globals.

*Bug found and fixed:* the wrapper originally ran in strict mode. `combat.js`'s
`createBattle()` calls `Battle()` **without** `new` (combat.js:783) and relies on
sloppy-mode `this` defaulting to the global object inside it (harmless no-op property
set); under strict mode `this` is `undefined` there, so `this.initialize = ...` throws
the instant a real battle triggers (`drifterCount > warTrigger`, 1,000,000). Invisible
until now because no test reached stage-3 combat. Fixed by dropping `"use strict"` —
the blanket predeclare already makes strict mode unnecessary for global-leak safety, so
sloppy mode is both correct (matches the original, non-strict source) and sufficient.
T11 in validate.js is the regression test.

**Round 2 — the game always runs a 400-ship combat animation.** Profiling (`node
--prof`) after round 1 found `MoveSingleShip`/`DoCombat` dominating the profile (27% of
ticks) even in a run that never touches combat. Root cause: `combat.js:799-800` — `var
app = new Battle(); app.initialize();` — runs unconditionally at script load, calling
`battleRestart()` which creates 400 ships and starts `setInterval(Update, 16)`,
regardless of whether the player has reached the combat stage. This was already true of
the original game (a real browser tab pays this cost too, likely a decorative "idle
ships" animation on the Combat screen) — vm overhead had simply been masking it.

Traced all consumers of the loop's output: `DoCombat()`'s only state-mutating effects
(`probeCount`, `drifterCount`, `probesLostCombat`, `driftersKilled`) are scaled by
`unitSize`, which starts at 0 and is set only once `createBattle()` first runs (gated
separately, via `checkForBattles()` in main.js's `war()`, on `drifterCount > 1,000,000`
— completely independent of the animation timer). `checkForBattleEnd()` is separately
gated on `battles.length>0`. `numLeftShips`/`numRightShips`/`ships`/`grid` are confirmed
combat.js-local (grepped every reference — no external readers). So the entire
`ClearFrame→UpdateGrid→MoveShips→DoCombat` cycle is a provable no-op on any externally
observable state while `unitSize === 0`, i.e. for the entire pre-war portion of any
playthrough (typically most of it).

**Change made:** added a one-line early return to `Update()` in `src/combat.js`,
gated on `unitSize === 0`, with a comment explaining the invariant. This is the one
deliberate edit to game source this session. Verified equivalence two ways: (1)
validate.js stays 37/37; (2) a targeted test forcing a real battle (`drifterCount =
3,000,000`, `probeCount = 5000`, same seed) produces **bit-for-bit identical** results
with the change and with `git stash` reverting it (`probesLostCombat=50.51356130507213`
exactly, `probeCount=0`, `battles.length=0` both ways) — confirming the gate is truly
inert once real combat starts and only skips the dormant, no-op case.

Note: this does change the *sequence* of `Math.random()` draws consumed during the
dormant period (skipped flocking/dice-roll calls that used to draw from the shared
seeded RNG), so trajectories for a fixed seed are no longer numerically identical to
pre-change runs (e.g. T10's `clips` at 1h moved from 32999 to 31999 with the same
seed). This is expected, not a correctness regression — game mechanics are unaffected
(economy formulas untouched, combat only engages when a real battle triggers), and
same-code-same-seed determinism (T4) still holds.

**Result: 77,991 ticks/sec (780× real time)**, up from 3,800–10,000 after round 1 and
~1,600 originally — roughly **48× faster overall**. Re-profiled after the fix: the hot
path is now genuine game logic (`updateStats()`'s per-tick DOM `innerHTML` writes,
`formatWithCommas` comma-formatting, `spellf`/`pronounceNum` number-to-words spelling)
— i.e. real work the game actually does every tick, not waste. Good stopping point for
P0 throughput; `updateStats()`'s DOM-writing cost could theoretically be trimmed further
(the headless sim never renders anything) but that's marginal compared to the two wins
above and not worth the added divergence from the original source right now.

## Task list state

- #1 done: main.js extraction. #2 done: combat/globals extraction.
- #3 done: headless simulator harness (P0) — vm eliminated, 37/37 validate.js passing,
  zero confirmed global leakage, one real bug found and fixed, throughput at
  77,991 ticks/sec (≈48× the session-1 baseline). Ready to move on to the "After P0"
  plan below.

## After P0 (the plan from ROUTES.md)

1. P1: kill R6 (prestige loops) analytically.
2. P3 always/never-take lemmas; exact GREEDY-vs-field analysis of the 8-strategy
   round-robin on uniform random payoff grids (analytically tractable).
3. Canvas-combat response-surface harness (isolated `DoCombat` + flocking Monte Carlo
   over probeCombat × probeSpeed × ship ratio) → feeds Lanchester outer model. (Note:
   the 400-ship loop investigated this session is already exactly the math this step
   needs — the `Update()` gate added above doesn't touch it once a real battle exists.)
4. P4 axis-winner A/B runs in the simulator (D2, D3, D5, D6, D7, D9/D10),
   then C3 (purchased vs fought honor), OQ1 (quantum tempOps bypassing memory gates),
   OQ3 (maxTrust-20 finish feasibility).

## Repo state

- Committed this session: `sim/harness.js` (rewritten), `sim/scan-globals.js` (new),
  `sim/validate.js` (T6/T10 fixes, T11 added), `src/combat.js` (one-line dormant-period
  gate in `Update()`), this file. `sim/env.js` unchanged.

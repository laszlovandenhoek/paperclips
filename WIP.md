# Work in progress — 2026-07-10

## Where we are

Goal (see README.md): prove the optimal strategy for winning Universal Paperclips.
Method (see ROUTES.md): explicitly define the route space, prune by dominance, then
optimize within surviving routes.

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
3. **P0 headless simulator built and validated** (`sim/`), now on its second
   implementation:
   - `sim/env.js` — fake DOM (only surface the game touches), virtual-time scheduler
     (replaces setInterval/setTimeout, callbacks run in due-time order), seedable
     mulberry32 RNG, localStorage/Audio/location stubs. Unchanged since first session.
   - `sim/harness.js` — **rewritten this session** to drop Node `vm` entirely (see
     "Performance rewrite" below). Loads the four UNMODIFIED src files (index2.html
     order: combat, globals, projects, main) as one plain-JS function-wrapper closure.
     Player input = `sim.click(buttonId)`, legal only when the game's own
     `buttonUpdate()`/`manageProjects()` left the button attached+enabled — legality
     enforced by game logic, not re-derived. Browser "named access" (element ids as
     global vars, e.g. `btnLowerProbeHaz`) is replicated by predeclaring `var <id> =
     <element>` for every valid-identifier HTML id; script-level `var`s with the same
     name (confirmed real collisions: `adCost`, `batteryCost`, `batteryLevel` are both
     element ids and state variables) naturally overwrite it in source order, matching
     browser semantics.
   - `sim/scan-globals.js` — **new**. Static ES5 scanner (comment/string/regex-literal
     stripping + bracket-depth-aware `var`-declarator parsing) that finds every bare
     assignment-target identifier across the 4 source files. Used by harness.js to
     build the wrapper's predeclare prologue. Confirmed genuinely fragile to get right:
     an early version double-counted/dropped names because of (a) missing semicolons
     in combat.js relying on ASI, and (b) nested `var DoCombat = function(){ var pX =
     ...; }`-style declarations, which — if the outer scan naively skips past the whole
     enclosing statement — hides every `var` nested inside a function-expression
     initializer. Fixed by decoupling "find every `var name`" (a single unbroken global
     regex pass, so nesting can't hide anything) from "find extra comma-separated names
     in the same statement" (a separate bracket-depth-local walk that never touches the
     first pass's scan position).
   - `sim/validate.js` — suite: **34/34 pass** (was 30/34; the 3 T6 failures were test
     bugs — game's milestone check is `clips > nextTrust-1`, so clips=2999.7
     legitimately crosses the "3000" milestone, fixed the test to match; T10's
     clip-count assertion was tightened against an unvalidated guess, loosened to match
     actual naive-policy behavior, ~33k clips/hour).

### Performance rewrite (done, but short of target — see next blocker)

**Original problem:** Node `vm` contextified sandboxes intercept every global variable
access through C++; at ~1,600 ticks/sec (16× real time) a full playthrough was too slow
to use for policy search.

**What was done:** eliminated `vm`. The four source files are concatenated inside one
ordinary function wrapper compiled once via indirect eval (`(0, eval)(src)`, runs in
plain global scope) into a reusable factory function; each `new Sim()` just *calls* that
factory, giving every instance fresh closure-scoped state (V8 reuses the compiled
bytecode across calls, so repeated Sim construction is cheap). All game `var`s become
closure locals instead of vm-intercepted global-object properties.

Implicit-global safety (the `pick`/`h`/`v`-style bare assignments with no local `var`
that would otherwise leak onto Node's real `globalThis` and get shared across
concurrent Sim instances): rather than trying to precisely attribute each assignment to
its enclosing function scope (hard to get exactly right with a regex-based scanner, and
the cost of being wrong is a silent, hard-to-notice cross-instance state leak), the
wrapper blanket-predeclares `var` for **every** bare assignment-target identifier found
anywhere in the 4 files (816 names, computed by `scan-globals.js`). This is provably
safe: a nested function's own `var x` always shadows the wrapper-level one, so
predeclaring names that are already properly scoped everywhere is inert, while names
that genuinely lack a local `var` in some function (confirmed example: `h`/`v` inside
`pickStrats()` in main.js, which are true implicit globals there despite `var h`
existing in unrelated harvester functions elsewhere in the file) now resolve to the
wrapper closure instead of leaking. Verified with `Object.getOwnPropertyNames(globalThis)`
diffing before/after a 5,000-tick run with clicks: **zero leaked globals**. Only 3
identifiers are `var`-declared *nowhere* in any file and are true implicit globals by
design: `formatWithCommas`, `pronounce`, `v` (all in main.js) — all safely covered by
the blanket predeclare.

`Number.prototype.toLocaleString` override (perf, display-only) is still applied — it's
a real process-wide mutation of a builtin prototype, can't be scoped per-Sim, so it's
guarded to run once and documented as such (unchanged limitation from session 1).

**Result: only ~2.4–6× faster (3,800–10,000 ticks/sec, 38–100× real time), not the
≥100k ticks/sec hoped for.** Functional correctness is unaffected — validate.js is
34/34 with byte-identical snapshots to before wherever comparable, and determinism/seed
divergence (T4/T5) both hold. Profiled with `node --prof` to find the new ceiling:

### Current blocker: the game always runs a 400-ship combat animation

`combat.js:799-800` — `var app = new Battle(); app.initialize();` — runs
**unconditionally at script load**, calling `battleRestart()` which immediately creates
400 ships (`battleLEFTSHIPS`+`battleRIGHTSHIPS` = 200+200) and starts a
`setInterval(Update, 16)` flocking/rendering loop, regardless of whether the player has
ever reached the combat stage. `Update` → `MoveShips` → `MoveSingleShip` does
grid-neighbor flocking math for all 400 ships every 16ms of virtual time, dominating
the profile (`MoveSingleShip` alone was 27% of ticks in a `node --prof` run). This is
genuine, pre-existing game behavior — it was already true in the `vm`-based harness
too, just completely masked by vm's larger overhead. It is a real cost paid by an
actual browser tab sitting on the Combat screen before any battle has started, most
likely a decorative "idle ships milling about" animation.

For a headless policy-search simulator, this is close to 100% wasted work for any
policy that doesn't touch combat (the vast majority of ticks in any full playthrough,
since even combat-heavy routes only spend a fraction of total game time in active
battles): `ClearFrame`/context calls are no-ops against the canvas stub already, but
the ship-flocking math itself still runs at full cost every 16ms regardless.

**Not yet decided:** how to address this without violating the "src/ stays unmodified,
loaded byte-for-byte" constraint. Options to weigh next session:
- Leave it — 3,800–10,000 ticks/sec may simply be this game's real per-tick cost once
  vm overhead is removed, and could be acceptable for the policy-search workload sizes
  actually needed.
- Some environment-layer trick to make the flocking cheap without touching src/ (e.g.
  intercepting `setInterval(Update, 16)` specifically is fragile/hacky — would need a
  principled way to identify "this is the always-on decorative loop" without relying on
  fragile function-identity matching). Requires first confirming (by reading
  `checkForNewBattle`/how real battles are created) whether the always-running `ships`
  array is actually disjoint from real-battle ship state, i.e. that neutralizing it
  can't silently change combat-stage behavior.
- Live with it for P0 (throughput target was aspirational, not a hard requirement) and
  move on to P1/P3 analytical work, revisiting perf only if it's actually the
  bottleneck once real policy-search workloads are attempted.

This determination is the concrete next step, before resuming the "After P0" plan below.

## Task list state

- #1 done: main.js extraction. #2 done: combat/globals extraction.
- #3 done: headless simulator harness (P0) — vm eliminated, 34/34 validate.js passing,
  zero confirmed global leakage. Perf ceiling identified but not yet resolved (see
  blocker above).

## After P0 (the plan from ROUTES.md)

1. P1: kill R6 (prestige loops) analytically.
2. P3 always/never-take lemmas; exact GREEDY-vs-field analysis of the 8-strategy
   round-robin on uniform random payoff grids (analytically tractable).
3. Canvas-combat response-surface harness (isolated `DoCombat` + flocking Monte Carlo
   over probeCombat × probeSpeed × ship ratio) → feeds Lanchester outer model. (Note:
   the always-on 400-ship loop discovered this session is a good starting point/testbed
   for this harness — it's already running the exact math this step needs.)
4. P4 axis-winner A/B runs in the simulator (D2, D3, D5, D6, D7, D9/D10),
   then C3 (purchased vs fought honor), OQ1 (quantum tempOps bypassing memory gates),
   OQ3 (maxTrust-20 finish feasibility).

## Repo state

- Committed this session: `sim/harness.js` (rewritten), `sim/scan-globals.js` (new),
  `sim/validate.js` (T6/T10 fixes), this file. `sim/env.js` unchanged. `src/` untouched
  (clean mirror — keep it that way; the simulator must always load it unmodified).

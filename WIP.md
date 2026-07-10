# Work in progress — 2026-07-11

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
3. **P0 headless simulator built and mostly validated** (`sim/`):
   - `sim/env.js` — fake DOM (only surface the game touches), virtual-time scheduler
     (replaces setInterval/setTimeout, callbacks run in due-time order), seedable
     mulberry32 RNG, localStorage/Audio/location stubs.
   - `sim/harness.js` — loads the four UNMODIFIED src files (index2.html order:
     combat, globals, projects, main) into a Node `vm` context. Parses index2.html for
     element ids / onclick / select defaults. Player input = `sim.click(buttonId)`,
     legal only when the game's own `buttonUpdate()`/`manageProjects()` left the button
     attached+enabled — legality enforced by game logic, not re-derived.
     Browser "named access" (element ids as global vars, e.g. `btnLowerProbeHaz`) is
     replicated; script `var`s shadow it, matching browser load-order semantics.
   - `sim/validate.js` — suite: 30/34 pass. The 3 T6 failures are **test bugs, not sim
     bugs**: game's milestone check is `clips > nextTrust-1`, so clips=2999.7 legitimately
     crosses the "3000" milestone; fix the test to use `> threshold-1`, and the
     "reached 3000+ clips" assertion to match. T10's clip-count assertion also needs
     loosening (policy is intentionally naive).

### Current blocker: performance

**The `vm` approach is ~1,600 ticks/sec (16× real time) — too slow.** Profiled: clicks
are innocent (60k ticks = ~37 s with or without 4 clicks/tick). Root cause: Node `vm`
contextified sandboxes intercept EVERY global variable access through C++; the game
keeps all state in globals with thousands of accesses per tick.

**Planned fix (next session):** eliminate `vm` entirely. Concatenate the four source
files inside one ordinary function wrapper executed in plain Node scope:

```js
(function (document, window, localStorage, Audio, location, confirm,
           setInterval, setTimeout, clearInterval, clearTimeout, console, Math) {
  // prologue: var <id> = document.getElementById('<id>') for every static HTML id
  //           (replicates browser named access; game var redeclarations merge/overwrite
  //           in load order, same as browser)
  // ...combat.js... ...globals.js... ...projects.js... ...main.js...
  return {
    get: (n) => eval(n),                 // direct eval sees the closure scope
    set: (n, v) => eval(`${n} = v`),
    call: (code) => eval(code),
    snap: <generated function returning {clips: clips, ...} for SNAPSHOT_VARS>, // fast path
  };
})(shims...)
```

All `var`s become closure locals → native speed (expect ≥100k ticks/sec). Details to
handle:
- **Math shadowing:** pass a `Math` param = flat copy of real Math with `random` = seeded
  mulberry32, so parallel Sims with different seeds can coexist in-process.
- **`Number.prototype.toLocaleString` override** (perf, display-only) must stay — it's a
  process-wide mutation; make it idempotent and document that `fastFormat` is global.
- **Implicit globals** (assignments without `var` in game code, e.g. possibly `pick` in
  main.js:2318) would leak to real globalThis and be shared across Sim instances.
  Was about to check `window.spell` (1 grep hit somewhere in src) and hunt implicit
  globals by diffing `Object.getOwnPropertyNames(globalThis)` before/after a smoke run —
  **this check is the exact next step**. Any found: predeclare with `var` in the wrapper
  prologue.
- Keep `sim.ctx`-style access working: replace with a Proxy facade over get/set so
  `sim.ctx.clips` still works in validate.js and future policies.
- `click(id)`: html onclick strings become pre-compiled closures via `call('(function(){...})')`
  once, then plain JS calls — no per-click eval.

After the rewrite: re-run validate.js (fix the 3 T6 test bugs + T10 threshold while at
it), confirm determinism still holds, measure ticks/sec, then commit.

## Task list state

- #1 done: main.js extraction. #2 done: combat/globals extraction.
- #3 in progress: "Build headless simulator harness (P0)" — blocked on the perf rewrite
  above.

## After P0 (the plan from ROUTES.md)

1. P1: kill R6 (prestige loops) analytically.
2. P3 always/never-take lemmas; exact GREEDY-vs-field analysis of the 8-strategy
   round-robin on uniform random payoff grids (analytically tractable).
3. Canvas-combat response-surface harness (isolated `DoCombat` + flocking Monte Carlo
   over probeCombat × probeSpeed × ship ratio) → feeds Lanchester outer model.
4. P4 axis-winner A/B runs in the simulator (D2, D3, D5, D6, D7, D9/D10),
   then C3 (purchased vs fought honor), OQ1 (quantum tempOps bypassing memory gates),
   OQ3 (maxTrust-20 finish feasibility).

## Repo state

- Untracked/new: `ROUTES.md`, `sim/env.js`, `sim/harness.js`, `sim/validate.js`,
  `WIP.md`. Nothing committed yet this session; `src/` untouched (clean mirror —
  keep it that way; the simulator must always load it unmodified).
- Scratch file `/tmp/perfprobe.js` (perf experiment) is disposable.

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
`src/index2.html` now also has a deliberate, additive edit (the bot side panel, see
below) — nothing existing was removed or altered, just new markup/script includes.

**Click-rate scope, settled:** 30 clicks/sec (human-realistic keyboard-repeat rate —
click once, hold Enter), not arbitrary bot speed. Written into ROUTES.md's optimality
metric section and enforced by both bot adapters (see below).

**Second stated goal, added this session, alongside "prove the optimal strategy":**
build an autoplay bot with a live side panel on the actual game page (shows the
current automated decision/tradeoff + a timer), a first (deliberately naive, iterate
later) policy that plays the whole game start to finish, and integration with the
headless simulator so the same policy can be run at simulator speed instead of real
time. Done this session — see "Autoplay bot" below.

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

### Autoplay bot: policy + side panel + sim integration (done this session)

New `bot/` directory, engine-agnostic by design:

- **`bot/policy.js`** — the decision engine. `decide(adapter)` reads game state via a
  small adapter interface (`get(name)`, `isClickable(id)`, `click(id)`, `setValue(id,v)`)
  and returns/executes one action per call, plus a human-readable phase + reason for
  display. UMD-wrapped so the identical file works via `require()` in Node and as a
  plain `<script>` in the browser. Deliberately naive — goal is *completeness* (reach
  credits) over optimality, explicitly per user request, with a few decisions backed by
  this session's P3 results (skip RevTracker, adaptive grid-aware tournament pick — the
  exact scoring model from `analysis/tourney_exact.js` is copied in self-contained so
  this file has no dependency on `analysis/`) and everything else a simple
  affordability-gated default, commented as a placeholder for later iteration
  (processors:memory split, stage-2 build ratios, probe stat priority, wire price
  timing — all still open per the earlier review this session).
- **`bot/adapters/sim-adapter.js`** / **`bot/adapters/browser-adapter.js`** — same
  interface, one wraps `sim/harness.js`'s `Sim` (virtual clock), one wraps the real page
  (`window`/`document`, real wall clock). Both enforce the 30 clicks/sec cap
  independently against their own clock, so headless runs stay comparable to a real
  playthrough's click budget rather than assuming superhuman input.
- **`bot/run-headless.js`** — CLI: drives the policy against the simulator at full
  speed. This is the "speed up wall-clock time" integration the user asked for — the
  *same* policy that can drive the real browser can instead drive the simulator, which
  ticks far faster than real time.
- **`bot/panel.js`** + **`bot/panel.css`** — the live side panel: timer, current
  decision (phase + reason), and a scrolling action log (consecutive identical actions
  collapse into a `(x{count})` counter — otherwise bootstrap-clicking floods it with
  duplicate lines). Pause/resume toggle. Injected into `src/index2.html` as additional
  markup + script includes after `main.js` (so game globals already exist when
  `panel.js` runs) — purely additive, nothing existing in the page was changed.

**Two real bugs found and fixed while building this** (both would have been invisible
without actually running it, not just reading the code):
1. AutoClippers/MegaClippers/Marketing are **not** projects (not in `activeProjects` —
   they're always-available buttons with their own escalating `$` cost), so the first
   version of the policy never bought a single autoclipper and stayed on manual
   clicking for the full 600 s smoke test. Fixed by adding an explicit economy-purchase
   step.
2. Once that was fixed, a worse bug appeared: prioritizing autoclipper purchases (cheap,
   ~$5-6) over wire restocking (pricier, ~$17-26) let cheap purchases keep draining
   funds a few dollars at a time, wire hit 0, clip production stopped entirely, and the
   only remaining income (trickle sales from existing inventory) was never enough to
   ever afford wire again — a genuine soft-lock, reproduced and confirmed via
   `bot/run-headless.js`. Fixed by making wire a hard gate: whenever wire is low, either
   buy it or hold funds and fall through to manual clicking (which doesn't cost money) -
   never spend on anything else in the meantime.
3. (Non-functional but worth noting.) Calling `decide()` every single 10 ms game tick
   made headless runs ~20× slower (each call does ~20-30 `eval()`-based reads through
   the sim's Proxy, which isn't free like native closure access) — dropped to every 5
   ticks (50 ms), still far ahead of the 30/sec click cap, recovered full throughput.

**Verified two ways:**
- Headless, `bot/run-headless.js`: ran 2.8 simulated days / 43,600+ bot actions with
  zero crashes before being stopped deliberately (not a failure — a naive stage-1-only
  economy loop grinding fibonacci-milestone trust is legitimately slow, trust=17 by
  then; see the D4 fibonacci-vs-tokens gap noted above for why). At the fixed 50 ms
  decision cadence this ran at ~800-900× real time.
- Real browser, via Playwright (pre-installed Chromium, `chromium.launch()` with no
  args — already configured, no download needed): loaded the actual `index2.html`,
  confirmed the panel renders, the timer advances, the action log populates and
  dedupes, pause/resume actually stops/resumes clicking (verified by log entry count
  freezing, not just the button label), and zero console errors. Screenshot sent to
  the user.

**Not yet done / known gaps in the naive policy** (all explicitly commented in
`bot/policy.js` as placeholders): no wire-*purchase-timing* exploitation of the
sine-wave `wireCost` formula (P5, still open from the earlier review — separate from
price-matching, added next, below), naive fixed 1:1 processors:memory split (D6, still
open, including the creativity-dead-zone finding from that review), naive
fixed-priority stage-2 build order and stage-3 probe stat allocation (no ratio
balancing yet), no attempt at the fibonacci-milestone-vs-token trust mix (D4). The
policy has not been run far enough to reach stage 2, stage 3, or the endgame — only
stage 1 has been exercised in anger so far.

### Price-matching strategy (done, follow-up session)

Added a 9th policy step: set `margin` (price per clip — confirmed literally equal to
it, `sellClips()` uses `funds += clipsDemanded*margin`) so expected sales volume
tracks production, while enforcing a profit floor above the live marginal cost per
clip.

Derived the sales-rate formula from the actual 100ms "Slow Loop"
(`main.js:4564-4576`): with probability `demand/100`, a sale of
`floor(0.7*demand^1.15)` clips happens, giving `E[salesRate/sec] = 0.07 * demand^2.15`.
Verified this numerically against the simulator (predicted 1.286/sec vs. 1.26/sec
measured over 100s at a fixed margin/demand — within sampling noise). Since
`demand = (.8/margin)*marketing*marketingEffectiveness*demandBoost*(...)` is inversely
proportional to `margin` at any fixed instant, `demand*margin` is invariant under a
margin change — so the policy reads the *current* (demand, margin) pair to get that
constant rather than re-deriving the marketing/demandBoost formula itself, then solves
for the margin that would produce the demand matching `clipRate` (the game's own
smoothed clips/sec figure).

Profit floor: every clip (hand click, autoclipper, or megaclipper — all go through
`clipClick()`) consumes exactly 1 wire inch, so marginal cost per clip is
`wireCost/wireSupply`; wireSupply-upgrade projects raise that denominator over time
and are picked up for free since the floor is recomputed from current values every
cycle, no separate accounting needed. Floor is `max(0.01, costPerClip*1.1)` (10% over
material cost); target margin is clamped to at least that. `raisePrice()`/
`lowerPrice()` only move margin ±0.01 per click (no direct "set" control), so the
policy steps toward the target with a 1.5-step tolerance band to avoid oscillating.

**Known imprecision, documented in the code rather than fixed:** `clipRate` counts all
clips including the bot's own bootstrap manual clicking (step 5), so before
`clipmakerLevel` clears that threshold, "production" transiently includes our own
clicks rather than only sustainable autoclipper output. Self-corrects once bootstrap
clicking stops, since the target is recomputed fresh every cycle.

**Result: a large, clearly-attributable improvement.** Same seed, same policy
otherwise, 30-minute-simulated-time comparison: 59,910 clips / trust 9 with
price-matching vs. ~13,000 clips / trust 7 without (previous session's headless run,
same timepoint) — roughly 4.6× more clips, and funds stay in a healthier $5-40 range
throughout instead of $0-20. Verified: `sim/validate.js` still 37/37 (unaffected —
price-matching only touches stage-1 policy, not the simulator itself), headless smoke
run to 3,600s clean, and a longer background stability run in progress at time of
writing.

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
- Autoplay bot (policy + side panel + sim integration) done this session — see above.

## Next

Two parallel tracks now — the analytical ROUTES.md plan, and iterating the bot policy.
No particular order implied; whichever the user wants to pick up.

**ROUTES.md plan:**
1. P1: kill R6 (prestige loops) analytically. Not yet started.
2. Canvas-combat response-surface harness (isolated `DoCombat` + flocking Monte Carlo
   over probeCombat × probeSpeed × ship ratio) → feeds Lanchester outer model. The
   400-ship loop investigated in the perf work is already exactly the math this step
   needs — the `Update()` dormant-gate doesn't touch it once a real battle exists.
3. P4 axis-winner A/B runs in the simulator (D2, D3, D5 — including the still-open
   "how many strategies to unlock" question, D6, D7, D9/D10), then C3 (purchased vs
   fought honor), OQ1 (quantum tempOps bypassing memory gates), OQ3 (maxTrust-20
   finish feasibility).

**Bot policy iteration** (see "known gaps" in the Autoplay bot section, and the
price-matching section, above for the full list; roughly in expected-impact order):
1. ~~Price matching~~ — done, see above. Sale-price (`margin`) now tracks production
   automatically; the remaining wire-related gap is *purchase*-side: exploiting the
   sine-wave `wireCost` formula (already derived in ROUTES.md's continuous-controls
   note) to buy wire when it's cheap, rather than the current "buy whenever affordable
   and below buffer" — smaller expected win now that price-matching is already
   accelerating the economy.
2. Smarter economy allocation between wire/clippers/megaclippers/marketing (currently:
   whichever's affordable, in a fixed priority order with wire gated first to avoid the
   deadlock described above) — real payback-time comparisons instead of "buy whenever
   affordable."
3. Run the policy far enough (the price-matching win from this session should help
   directly) to exercise stage 2, stage 3, and the endgame for the first time — none of
   that code path has been tested yet, only stage 1.
4. Processors:memory split (currently naive 1:1), stage-2 build ratios, stage-3 probe
   stat allocation — all explicitly placeholder per the D6/D8/D9/D10 open questions.

## Repo state

- `sim/` — headless simulator (env.js, harness.js, scan-globals.js, validate.js).
- `analysis/` — `tourney_exact.js`, `tourney_montecarlo.js`, `tourney_yomi.js`,
  `tourney_adaptive.js` (P3's tournament pick-policy analysis).
- `bot/` — new this session: `policy.js`, `adapters/sim-adapter.js`,
  `adapters/browser-adapter.js`, `run-headless.js`, `panel.js`, `panel.css`.
- `src/combat.js` — one-line dormant-period gate in `Update()` (see Performance above).
- `src/index2.html` — additive edit: bot side-panel markup + script includes.
- ROUTES.md — P3 results, the click-rate scope decision, and the D4/D5/D6 corrections
  from this session's review all written in.

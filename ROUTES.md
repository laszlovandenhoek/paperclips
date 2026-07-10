# ROUTES.md — The route space for finishing Universal Paperclips

Everything below is derived from the mirrored source in `src/` (line references included).
Goal of this document: define the *complete* space of routes to finishing the game, so we
can prune it by dominance arguments until a manageable set remains for deep optimization.

## 0. Definitions

**Finishing the game.** The game ends at the credits, reached only via the **Reject** branch:

1. `milestoneFlag` reaches 15 when all matter in the universe (`totalMatter = 3.0e55`,
   `globals.js:88`) is found and converted (`main.js:3539-3547`).
2. The Emperor of Drift message chain (projects 140–146, ~1 op each) unlocks
   **Accept** (project147) and **Reject** (project148).
3. **Reject** stops value drift permanently (`drift()` zeroed, `main.js:4074`) and starts
   the timed disassembly chain (projects 210–216), ending with hand-clicking the last
   50-odd wire into clips (`finalClips == 100`) → exactly 30 septendecillion clips → credits.

**Accept** is *not* a finish: it leads to project200/201 (prestige restarts: +10% demand
per `prestigeU` / +10% creativity speed per `prestigeS`) and calls `reset()`.

**Optimality metric.** Wall-clock time from a fresh state (prestige 0) to credits.
The game is hard real-time gated: main loop = 10 ms tick (`main.js:4188`), sales/wire
market = 100 ms loop, stocks = 1 s/2.5 s loops, tournaments ≈ 1 s per matchup. Nothing
scales with player clicking except a few click-gated actions (quantum compute, manual
clips at the very start and very end). So the objective is ticks-to-credits; clicks are a
secondary resource (assume a bot can click arbitrarily fast where allowed).

**Route vs policy.** RNG exists in: wire market, clip sales, stock market, tournament
payoff grids, and battles (`combat.js`). So the optimal strategy is a *policy*
(state → action), not a fixed timeline. A **route** is the discrete skeleton of that
policy: which optional projects/engines are used and which branch is taken at each
genuine fork. Routes are what we enumerate and prune; continuous controls are optimized
*within* a route later.

---

## 1. The mandatory backbone (present in every route)

The game has three stages, gated by `humanFlag` / `spaceFlag`. The transitions and their
prerequisite chains are forced; no route can avoid any gate below.

### Stage 1 — Business era (`humanFlag == 1`)

Forced chain (trigger → in `projects.js`):

| Gate | Requirement | Cost |
|---|---|---|
| G1 Creativity (p3) | ops maxed | 1,000 ops |
| G2 Combinatory Harmonics (p14) | 100 creat | 100 creat (+1 trust) |
| G3 Catchy Jingle (p12) | p14 | 45 creat + 4,500 ops |
| G4 Hypno Harmonics (p34) | p12 | 7,500 ops + **1 trust** |
| G5 HypnoDrones (p70) | p34 | 70,000 ops |
| G6 **Release the HypnoDrones** (p35) | p70 | **trust ≥ 100** |
| G7 Tóth Sausage Conjecture (p17) | 200 creat | 200 creat (+1 trust) — needed for stage 2's chain; doable in stage 1 or 2 |

Implications every route must satisfy:
- **Ops cap ≥ 70,000** at G5 time → memory ≥ 70 (`operations` cap = `memory*1000`,
  `main.js:3413`) *or* quantum `tempOps` overflow above the cap (open question OQ1).
- **Trust ≥ 100 cumulative.** Trust is never spent by processor/memory allocation (that is
  gated by `trust > processors + memory` but doesn't decrement trust). Only Hypno
  Harmonics (−1) and the bail-out Beg for More Wire (−1) reduce it.
- Trust sources (exhaustive): start 2; Fibonacci clip milestones +1 each
  (3k, 5k, 8k, … ×1000 clips, `main.js:3374`); six creativity projects +1 each
  (Limerick, Lexical, Combinatory, Hadwiger, Tóth, Donkey Space); CEV +1 (3,000 yomi);
  Cure for Cancer +10; World Peace +12 (15,000 yomi); Global Warming +15 (4,500 yomi);
  Male Pattern Baldness +20; Hostile Takeover +1 ($1M); Full Monopoly +1 ($10M + 3,000
  yomi); A Token of Goodwill +1 ($500,000, needs clips ≥ 101M and trust ≥ 85);
  Another Token of Goodwill +1 repeatable ($1M doubling each time).
  Max from non-clip, non-token sources: 2+6+1+10+12+15+20+1+1 = **68**, minus 1 for
  Hypno Harmonics → 67. The remaining ~33 must come from clip milestones and/or tokens —
  this trade (clips take time, tokens take money) is decision **D4**.
- Yomi ≥ 22,500 (CEV + Peace + Warming) is effectively forced → **Strategic Modeling
  (p20, via Donkey Space p19, 250 creat) is mandatory**, since tournaments are the only
  yomi source. (Also confirmed mandatory by stage 3: probe trust costs yomi.)

### Stage 2 — Earth-consumption era (`humanFlag == 0`, `spaceFlag == 0`)

Carried over: clips, unusedClips, wire (→`nanoWire`), processors/memory/ops, creativity,
yomi, project flags. Reset: trust (=0, frozen — **no more processors/memory from trust,
ever**), clippers, funds become useless (investments and wire buying are humanFlag-gated,
`main.js:1260`).

Forced chain:

| Gate | Requirement | Cost |
|---|---|---|
| G8 Tóth Tubule Enfolding (p18) | p17, humanFlag 0 | 45,000 ops |
| G9 Power Grid (p127) | p18 | 40,000 ops |
| G10 Nanoscale Wire Production (p41) | p127 | 35,000 ops |
| G11 Harvester Drones (p43) + Wire Drones (p44) | p41 | 25,000 ops each |
| G12 Clip Factories (p45) | p43 & p44 | 35,000 ops |
| G13 harvest all of Earth | `availableMatter` 6e27 → 0 (`globals.js:73`) | time |
| G14 **Space Exploration** (p46) | G13 | 120,000 ops + 10,000,000 MW-s stored + 5e27 unused clips |

Implications:
- Build solar farms + batteries (power throttles everything via `powMod`,
  `main.js:2952`; 10M MW-s stored requires ≥ 1,000 battery towers' worth of capacity —
  `batterySize = 10000`).
- 120,000 ops at G14 → memory ≥ 120, and post-stage-1 the only compute source is
  **swarm gifts** (`updateSwarm`, `main.js:2644`; gifts gated on Swarm Computing p126,
  36,000 yomi). So every route chooses between banking memory in stage 1 vs relying on
  gifts (decision **D6**), except for the possible quantum loophole (OQ1).
- G14 refunds *all* terrestrial infrastructure clip costs (`factoryReboot()` etc.,
  `main.js:2607-2637`) — over-building in stage 2 is partially free in clips (not in time).

### Stage 3 — Space era (`spaceFlag == 1`)

Forced structure:
- Probes cost 1e17 clips (`main.js:3777` region). Per-tick, deterministic
  (`main.js:3777-3801`): replication `probeCount·5e-5·probeRep`; hazard loss
  `probeCount·0.01/((3·probeHaz^1.6)+1)`; drift `probeCount·1e-6·probeTrust^1.2` →
  drifters; exploration `probeCount·1.75e18·probeSpeed·probeNav` toward 3e55.
  probeCount hard cap 1e48.
- Probe stat points cost yomi: `floor((probeTrust+1)^1.47·500)`; cap `maxTrust = 20`,
  raisable +10 per **91,117.99 honor** (`main.js:3819`).
- **Combat is unavoidable**: battles auto-spawn at `drifterCount > 1e6`
  (`combat.js:55`), and drift is proportional to probeTrust^1.2, so any working probe
  fleet drifts past 1e6 quickly. Losing battles permanently destroys `availableMatter`
  (`combat.js` updateBattles). Drifter casualties scale as `probeCombat^1.7` —
  probeCombat = 0 kills nothing. So **Combat (p131, 150,000 ops) + probeCombat ≥ 1 is
  mandatory**.
- Honor is earned *only* after **Name the Battles** (p121, 225,000 creat), which also
  doubles combat effectiveness (`combat.js:155` region). Whether honor (and thus
  maxTrust > 20) is needed at all is decision **D10**.
- Endgame: milestone 15 → messages → **Reject** → timed disassembly (fixed ~2,700+ ticks
  of forced waiting across endTimers) → hand-click final wire → credits.

### Projects that are pure flavor / never on any optimal path

- Flavor only (no state effect that matters): RevTracker (UI), Limerick cont. (p218),
  the message chain 140–146 (forced, ~free).
- Bail-outs for soft-locked states an optimal controller never enters: Beg for More
  Wire (p2), Memory Release (p135), Quantum Temporal Reversion (p217, full restart).

---

## 2. Decision dimensions

### Discrete (route-defining)

- **D1 — Ending loop:** finish first run (Reject) vs Accept → prestige → replay.
  Conjecture C1: dominated for single-completion; prestige boosts only demand (stage-1
  sales) and creativity speed, each worth far less than a full extra playthrough.
- **D2 — Quantum Computing** (p50 + up to 10 Photonic Chips, escalating 10k+5k·n ops):
  take/skip, chip count, click policy. Bonus ops beyond the memory cap (max ~3,600/click
  at full chips, sine-timed, `main.js:837`). Also the only way to reach negative ops
  (irrelevant to winning).
- **D3 — Money engine:** clip sales only vs + investment engine (p21, trust ≥ 8 trigger;
  risk level low/med/high; yomi-priced upgrades shift `stockGainThreshold` +.01/level —
  note base .5 means unupgraded investing is zero-EV, pure variance). Money is
  stage-1-only and needed for: wire, clippers, marketing, Takeover ($1M), Monopoly
  ($10M), tokens ($500k + $1M·2^k). Couples strongly with D4.
- **D4 — Trust-to-100 composition:** how many of the ~33 non-fixed trust points come from
  clip milestones (need ~fib growth in clips → time) vs Goodwill tokens (money,
  doubling) vs skipping some of the yomi mega-projects (never sensible: +57 trust for
  22.5k yomi is the cheapest trust in the game — conjecture C2: CEV/Cancer/Peace/Warming/
  Baldness are in every optimal route).
- **D5 — Tournament stack:** which of the 7 strategy unlocks to buy (each +1,000 ops
  tourney cost, more matchups = more yomi & more wall-clock per tournament), Theory of
  Mind (p119, 25k creat: doubles yomi, tourneyCost → 16,000), AutoTourney (p118, 50k
  creat, trust ≥ 90), Strategic Attachment (p128, 175k creat, stage 3: +50k/30k/20k yomi
  per 1st/2nd/3rd-place pick — dominant yomi source lategame, `main.js:2134-2154`),
  and the pick policy (GREEDY vs field on random payoff grids).
- **D6 — Compute banking:** stage-1 trust split processors:memory over time
  (`creativitySpeed = log10(p)·p^1.1 + p − 1`, ops regen = 10·p/sec, cap = 1000·m), and
  how much memory to bank for stage-2/3 ops gates vs relying on swarm gifts.
- **D7 — Xavier Re-initialization** (p219, 100,000 creat, stage 1 only): zero out
  procs/mem and re-allocate all accumulated trust. Take/skip + timing. (Classically used
  before Release to re-spec; 100k creat is enormous — needs analysis.)
- **D8 — Stage-2 tech set & order:** Momentum (20k creat, farm ≥ 30 — compounding
  `powMod += .0005`/tick), Swarm Computing (36k yomi), Drone Flocking ×100/×1000
  (80k/100k ops), Adversarial Cohesion (50k yomi, per-drone doubling), Upgraded/Hyperspeed
  Factories (80k/85k ops), Self-correcting Supply Chain (1e21 clips, per-factory ×1000).
  Mostly "when", not "if" — but each has a threshold trigger that shapes build ratios.
- **D9 — Combat depth:** minimal (Combat project + a few probeCombat points, eat matter
  losses) vs honor stack (Name the Battles 225k creat → Glory 30k yomi + 200k ops,
  Monument 250k ops + 125k creat + 5e31 clips → +50k honor, Threnody repeatable
  escalating creat/yomi → +10k honor, OODA Loop 175k ops + 45k yomi, Elliptic Hulls 125k
  ops for −50% hazard).
  Conjecture C3 (purchased vs fought honor): honor may be optimally *bought*, not won.
  A +10 maxTrust block costs 91,117.99 honor; battle victories yield ≤ 200 + Glory
  streak bonus (+10 per consecutive win, reset on any defeat) at minutes per battle
  through a single battle slot, while Monument is a one-time +50,000 and Threnody a
  repeatable +10,000 (≈ 9 Threnodies per block, escalating creat/yomi). If C3 holds,
  combat's role reduces to defense (win enough to not bleed `availableMatter`) and most
  of the honor stack becomes a creativity/yomi budgeting question, collapsing D9.
- **D10 — maxTrust target:** stay at 20 probe stat points vs buy +10 blocks with honor.
  Feasibility of a 20-point finish (e.g. 3 speed / 3 nav / 5 rep / 4 haz / 5 combat) is
  open (OQ3) — if feasible, most of D9 collapses.

### Continuous (policy within a route — optimized later, not enumerated)

Stage 1: price/margin schedule, marketing level timing (adCost doubles), clipper vs
megaclipper purchase schedule, wire purchase timing (price random walk, base creeps +.05
per buy, decays to floor 15), quantum click timing, tournament cadence & pick,
investment deposits/withdrawals & risk switching, proc:mem ratio schedule.
Stage 2: farm:battery:harvester:wire-drone:factory build ratios (drone ratio must stay
≤ 1.5 to avoid disorganization; boredom at `availableMatter == 0` — pay creat to
entertain), swarm slider (work↔think: gift rate vs production), reboot timing before G14.
Stage 3: probe stat allocation schedule (re-allocatable at will — it's a slider set, only
total is capped), Threnody/maxTrust purchase cadence, factory:harvester:wire probe-stat
mix vs terrestrial-style spawned infra, endgame message timing.

---

## 3. Route families (the set to whittle)

The cross-product of D1–D10 is large, but most axes have a strongly conjectured winner.
Candidate archetypes (all end via Reject → disassembly):

- **R1 "Kitchen sink" (baseline):** QC + chips, investments (high risk + upgrades), all 8
  strategies + ToM + AutoTourney + Strategic Attachment, all trust mega-projects, tokens
  as needed, bank memory ≥ 120, Xavier re-init before Release, Momentum, full flocking,
  full honor stack, maxTrust 30–40. (The community-consensus route, our correctness
  reference.)
- **R2 "Lean combat":** R1 minus the honor stack — maxTrust 20, minimal Combat, accept
  matter losses from lost battles. Tests D9/D10.
- **R3 "No-invest":** R1 minus investment engine — fund tokens/monopoly from sales alone
  (Takeover ×5 & Monopoly ×10 demand multipliers + marketing). Tests D3.
- **R4 "No-bank" :** minimal stage-1 memory (just enough for 70k ops), lean on swarm
  gifts (and/or quantum overflow, OQ1) for stage-2/3 ops gates. Tests D6.
- **R5 "No-Xavier":** R1 without p219. Tests D7 (is 100k creat < re-spec value?).
- **R6 "Prestige loop":** Accept ≥ 1 time, then finish. Tests D1 (conjectured dominated).

Everything else is a hybrid of these axes; if we can prove each axis's winner
independently (or prove the axes decouple, see P2 below), the route space collapses to
one archetype with continuous-control optimization remaining.

---

## 4. Pruning plan

- **P0 — Headless simulator.** Port `globals/main/projects/combat` into a deterministic,
  seedable, DOM-free tick engine with policy hooks (the game is already ~pure per-tick
  functions; DOM writes are incidental). Validate against the browser game. All proofs
  below get checked empirically against it; several can also be argued analytically.
  Combat gets a split treatment — the two engines in `combat.js` sit on opposite sides
  of the tractability line:
  - *Numeric engine (`updateBattles`): closed form, no Monte Carlo.* Each tick is a
    Bernoulli(battleSpeed) coin between drifter losses `clipProbes·probeCombat^1.7·k`
    and probe losses `drifterProbes·1.75·(1−battleSpeed)`. In expectation this is a
    Lanchester ODE system with kill rates `b = s·c^1.7·k` (probes) and `a = (1−s)²·1.75`
    (drifters); committed forces are ~U(0,1)·population with N ~ 1e6+, so fluctuations
    are O(1/√N) ≈ 0.1% and mean-field is essentially exact. Optimal combat-vs-speed
    marginal trade and the population-level war balance (drift inflow vs expected kills
    per battle through the `maxBattles` slot) follow analytically via the square law.
  - *Canvas engine (`DoCombat`): isolated response-surface harness.* It removes
    `unitSize` real units per ship death and is the sole honor source, but N ≤ 200
    ships/side (~7% fluctuations), death rolls scale with *local* grid-cell ratios,
    movement is emergent flocking, and the "hinder" re-roll (50% chance a 200-ship probe
    side is knocked down to uniform 1–175) is a discrete event. Glory makes honor
    path-dependent (streak bonus resets on defeat), so the full win-probability
    distribution matters, not just the mean. Plan: extract `DoCombat` + flocking as a
    standalone harness, Monte Carlo over a grid of (probeCombat, probeSpeed, ship
    ratio), fit a response surface (win prob, E[honor], E[losses], duration), and plug
    that into the analytic outer model. Full-game simulation is not needed for this.
  - *Battle protraction is a dead end (noted so nobody re-derives it):* stalling a
    battle with a few orbiting survivors would delay defeats, but the code force-ends
    battles (`battleClock` > 2000 frames once a side is ≤ 4 ships; `masterBattleClock`
    hard cap 8000 frames), the numeric engine keeps bleeding both sides during any
    canvas stall, a stalled battle also blocks honor-earning victories via the
    `maxBattles = 1` slot, and there is no control surface for it anyway (flocking
    movement, constant `battleMAXSPEED`).
- **P1 — Kill R6 (Accept loops).** Analytic: a loop costs ≥ one full run; prestige
  bonuses only accelerate stage-1 demand / creativity generation, bounded fractions of
  one stage.
- **P2 — Stage decoupling.** Stages interact only through the carried state vector
  (clips, compute, creat, yomi, flags). If for each stage the exit-time is monotone in
  each carried resource, we can optimize stages quasi-independently (dynamic programming
  over the interface state) rather than globally.
- **P3 — Always-take / never-take lemmas.** E.g.: every wire-supply and clipper-boost
  upgrade with cost < X ops pays back in T ticks (compute payback bounds); RevTracker is
  never taken; CEV chain always taken (C2); GREEDY dominates picks in expectation on the
  uniform payoff grid (compute exactly — 8-strat round-robin is analytically tractable).
- **P4 — Axis winners.** Sim-based A/B per axis (D2, D3, D5, D6, D7, D9/D10) holding the
  rest at R1 defaults, then check for cross-terms between surviving variants.
- **P5 — Continuous-control optimization** inside the surviving route: greedy/LP bounds
  where provable (most stage-1 purchase decisions are payback-time comparisons), policy
  search / RL only where control interacts with RNG (investments, battle timing).

## 5. Open questions to resolve in the simulator

- **OQ1:** Can quantum `tempOps` satisfy the 70k/120k ops gates with low memory?
  (`cost` checks read `operations = standardOps + tempOps` — if yes, memory banking
  requirements relax substantially.)
- **OQ2:** Is Swarm Computing skippable given enough stage-1 banked compute (36k yomi
  saved, but gifts also gate stage-3 compute growth)?
- **OQ3:** Is a maxTrust-20 finish feasible (D10), i.e. can 3e55 matter be explored and
  the drift war survived with 20 stat points before matter losses/hazards stall progress?
- **OQ4:** What exactly terminates the drift war after Reject — do existing drifters
  keep fighting, and does remaining drifter-held matter matter for milestone 15's
  alternative condition (`foundMatter ≥ total && availableMatter < 1 && wire < 1`)?
- **OQ5:** Exact wall-clock floors per stage: creativity (rate ≈ creativitySpeed/4 per
  sec once fast), 10 sales/sec cap, tournament duration (~1 s/matchup), swarm gift period
  (125,000 bits), forced endgame timers — these give a lower bound on any route's time.

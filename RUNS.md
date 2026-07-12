# Speedrun iteration log

Goal: a full simulated playthrough (headless, `node bot/run-headless.js`) faster than
the **Any% Desktop world record: 5,662s (1h34m22s)** — see WIP.md for how that number
was sourced. Runs are capped at 3 simulated hours (10,800s): anything longer has
already failed as a record attempt, and the milestone split table tells us where.

Timing note: the simulator's virtual clock ticks the same 10ms the real game does and
the bot is capped at the same 30 clicks/sec (against virtual time), so sim seconds are
comparable to a human player's wall seconds. Luck (stock market, quantum phases,
tournament grids) varies per seed; the policy doesn't have to win on every seed.

Milestone targets (paced against the WR with slack): Algorithmic Trading 480s ·
100k clips 720s · Quantum 1,200s · Full Monopoly 1,800s · HypnoDrones 2,700s ·
First factory 2,950s · Earth consumed 4,200s · Space Exploration 4,500s ·
Universe consumed 5,300s · Credits 5,662s.

## Run log

### A1 — seed 1, 10,800s cap — NOT FINISHED (stalled in stage2-buildout)

First run with: milestones/epochs, wire pre-buy on price troughs, swarm-gift
spending (mem to 125 then proc), work/think slider automation, x10/x100/x1000
multi-buys, battery-bank targeting, factory-first budget with wire-buffer-driven
drone purchases, quantum tempOps pumping in stage 2, avoid-list (AutoTourney/OODA/
Glory).

| Milestone | target | actual | delta |
|---|---|---|---|
| Algorithmic Trading | 480s | 1,475s | +995s |
| 100k clips | 720s | 1,087s | +367s |
| Quantum computing | 1,200s | 1,308s | +108s |
| Full Monopoly | 1,800s | **9,028s** | **+7,228s** |
| HypnoDrones | 2,700s | 9,400s | +6,700s |
| First factory | 2,950s | 9,480s | +6,530s |
| Earth consumed → credits | — | not reached | — |

Diagnosis: the new stage-2 machinery works (memory hit 125 via swarm gifts,
factories climbing, no stalls) but stage 1 alone consumed 9,400s — 1.66x the whole
WR. Dominant loss: Full Monopoly (demandBoost x10, the biggest revenue multiplier
in the game) landed at 9,028s because the investment-withdraw rule demanded a 2x
buffer ($20M banked for a $10M purchase) and never checked the 3,000-yomi
co-requirement. Everything downstream (token-funded trust to 100, HypnoDrones)
compounded the delay.

Change for next run: withdraw at 1x cost exactly; gate Full Monopoly's threshold on
yomi>=3,000; deposit sweep holds funds earmarked for an imminent threshold purchase.

### B1 — seed 1 — NOT FINISHED (identical trajectory to A1)

Withdraw-buffer fix alone changed nothing measurable (Monopoly 9,145s vs 9,028s —
the buffer wasn't binding). Added Hostile Takeover milestone + yomi/portfolio to the
log line for the next diagnosis.

### C1 — seed 1 — NOT FINISHED, but the decisive diagnosis

Same trajectory again (deterministic sim, the new branches never fired), but the new
telemetry told the story: portfolio $524 at t=1,800s, $119k at 3,600s — Hostile
Takeover waits until ~$1M exists AT ALL (5,455s). Sales profit is structurally tiny
(profit/clip = match-margin − wire cost ≈ $0.0024 at 47k clips/s ⇒ ~$115/s); the
demand constant K = demand×margin (marketing levels × slogan/jingle ×
demandBoost) is what profit scales with, and the investment engine only compounds
AFTER yomi buys threshold upgrades (~t=4,000+). Changes: ROI-ranked economy
purchases (marginal profit per dollar, argmax across clipper/megaclipper/marketing)
with a 600s payback window; gate-driven trust allocation (mem12 first).

### D1 — seed 1 — REGRESSION (trading 3,723s), but proved the winning shape

The 600s window froze ALL clipper purchases at t=0 (hand-click volume drags the
match-margin to ~$0.05 ⇒ a $6 clipper reads as a 900s payback ⇒ never bought ⇒ no
compounding). Meanwhile D1's tail showed what a good run looks like: once yomi
flowed and the engine was upgraded, portfolio went $12M → $304M in 900s and trust
22 → 74 on a token-buying spree. The stage-1 clock is really: reach Strategic
Modeling + engine upgrades fast, then the engine prints the mega-project money.
Changes: window 600s → 3,600s (argmax ordering is where the optimization lives;
early money has no opportunity cost).

### E1 — seed 1 — REGRESSION persists (trading 3,923s): two self-inflicted wounds

(1) The wire pre-buy drained every early dollar into wire inventory (a ~15% cost
saving) before clippers could compound (a >100%/cycle return): funds $16 at t=900s.
(2) The mem-first allocation left the run on 1 processor until t=6,300s — no ops
regen, no creativity, every project gated. Changes: pre-buy now requires the
investment-engine era + funds ≥ 10x wire cost; allocation reverted to the proven
proc-6-first shape (C1's trading split 1,475s is the benchmark).

### F1 — seed 1 — BREAKTHROUGH: stage 1 compressed ~2,000s, stage 2 rolling

Trading 1,475s (benchmark restored) · Takeover 4,950s (−505) · **Monopoly 6,370s
(−2,775 vs A1)** · HypnoDrones 7,433s (−1,967) · first factory 7,532s. At the 10,800s
cap: 56 factories, 21.5k drones, full 1,000-battery bank, 3M MW-s charging, clips
2×10²⁰. The ROI purchase ranking + fixed pre-buy/allocation did it. Added next: the
pricing floor moved from 1.1×cost to the profit-max 1.87×cost (m\* = 2.15c/1.15).

### G1 — seed 1 — identical to F1: the new floor never binds on this path

We stay production-bound throughout (the ROI allocator keeps marketing abreast), so
the profit-max floor is a dormant safety net. Fine — kept.

### H1 — seed 1 — **Earth consumed at 10,164s**, then a self-inflicted freeze

Stage-2 aggression changes (gifts keep flowing until proc 40; think-slider allowed
while compute-hungry; drones-first budget since harvest rate is quadratic in drone
count and powMod grows unbounded under Momentum): 281k drones, 217 factories,
storedPower 10M ✓, matter → 0 at 10,164s. Then frozen: "exodus → think full-time"
set the slider to 200, which zeroes the WORK multiplier — and wire drones still had
2.3×10²⁷ grams of acquiredMatter backlog to convert. Fix: think-full-time only when
the backlog is drained too.

### H3 — seed 1, 14,400s cap — **Space Exploration at 10,758s**; stage-3 fleet died 6x

Stage 3 entered for the first time. Then: probes 39k → 12, clips frozen, memory
125 → 65 (the "Memory release" bailout project fired six times — once per fleet
death). Root causes from source: (1) exploreUniverse's rate is probeCount ×
probeSpeed × **probeNav** — multiplicative, and the plan had both at 0, so no new
matter was ever found; (2) drift = probeCount × 1e-6 × probeTrust^1.2, and greedy
trust-maxing to 20 meant 36x base drift; (3) hazards at probeHaz 0 kill 1%/TICK.
Fixes: survival-first plan (haz → rep → speed/nav 1 each → deepen), just-in-time
probe-trust purchases (banked trust is pure drift), quantum pump extended to stage 3.

### I1/I2 — seed 1 — fleet SURVIVES; the drift-war economy is the new clock

I1: fleet sustains 2-3e7 probes but oscillates (equilibrium, not growth); clips grow
linearly via spawned infra — hopeless against totalMatter 3e55. I2 (slider 100 until
memory 250): Combat/Monument ops gates passable, honor climbing via battle wins
(+13/s) — but drifters hit 7×10⁸ (every drift loss is an enemy reinforcement) and
projected finish ~22,000s+. Honor mechanics from source: battles pay NOTHING (and
LOSSES subtract honor) until Name the Battles (requires losing 10M probes, 225k
creativity); then Threnody (+10k honor, escalating creativity+yomi cost, repeatable)
is the honor engine; Monument +50k (250k ops, 5e31 clips); maxTrust +10 per 91,118.
Change: stat plan rebudgeted for the ladder — first 20 trust = speed1/nav1/haz5/
rep8/combat5 (combat converts the bleed into honor), fac/harv/wire deferred to the
30-tier (spawn rates scale with probeCount, so fleet-first multiplies them later).

### H2 — seed 1 — backlog converts (clips = full 6.00×10²⁷), new blocker: the pile got spent

Space Exploration stayed unbuyable: diagnostic showed unusedClips at 3.9×10²⁶ —
the "exodus → buy factories to convert faster" rule burned the pile (late factories
cost ~10²⁵ EACH; ~30 exodus purchases ate the 5×10²⁷ SE requirement, out of Earth's
EXACTLY 6×10²⁷ total yield). Fixes: exodus buys nothing at all (existing factories
convert the backlog in seconds); pre-exodus factory purchases protect a 5.05×10²⁷
reserve once clips ≥ 5.2×10²⁷. Also: real stage-3 policy written (slider back to
work; gifts → mem 250 then proc; maxTrust at the guide's exact 91,117.99-honor
constant; probe plan haz2 → rep5 → combat5 → haz3 → fac/harv/wire 1 → rep∞;
launch clicks last).

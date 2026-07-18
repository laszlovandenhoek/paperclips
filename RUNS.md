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

### J1 — seed 1 — fleet EXTINCT: infra stats are non-negotiable

Deferring fac/harv/wire to the 30-tier meant no space drones ever spawned: 8.2×10³¹
of explored matter sat unharvestable, the fleet ate the clip pile (1e17/birth) to
$0 and went extinct (probes 3×10⁻⁴, "Memory release" fired ~14 times). Probes
aren't just an army — they seed the space economy that feeds their own replication.
Fix: tier-20 = speed1/nav1/haz4/rep8/fac1/harv1/wire1/combat3.

### J2 → FIRST COMPLETE RUN — seed 1: **13,561s** (WR + 7,899s)

The balanced tier-20 ignited the exponential: probes 1.8e3 → 3×10³⁰, clips
1.56×10⁵² at t=13,200s, **Universe consumed 13,423s**, dismantle chain + 100 final
clips + Reject by 13,561s (the endgame tail is only ~140s — the Emperor-of-Drift
chain is ops-gated, not timer-gated, and the generic project rule chews through it).
Splits: stage 1 = 7,433s (55% of the run), stage 2 = 3,325s, stage 3 = 2,665s.

Compression plan from here: (1) engine-era austerity — once investLevel ≥ 3 the
engine compounds ~0.2-0.3%/s vs ~0.01%/s for megaclipper/marketing purchases, so
stop ALL new production spending and deposit everything (production keeps flowing
from existing clippers for fib-trust and the 101M-clip token trigger); (2) stage-3
slider stays at full work until the fleet is self-sustaining (1e6 probes).

### L/M/N/O — user-directed model corrections + the noise lesson

Three user-confirmed mechanics encoded: money stays DEPOSITED while saving for a
milestone (withdraw only at the instant of purchase, no earmarking, deposits
rate-limited to 1/s since stockShop consumes bankroll on a 1s timer); WireBuyer
makes all manual wire purchasing obsolete once bought; quantum ops RIDE ABOVE the
memory cap while positive qOps keep landing (decay only when the flow stops), so
the headroom gate is gone everywhere — plus a TODO to calculate the optimal
Photonic Chip count. M added the opportunity-cost hurdle (purchases must beat the
engine's compounding rate to justify pulling invested money out): Takeover/Monopoly
collapsed to ~3,100/~4,000s. N exempted production purchases until clips 2.5e8
(the fib-trust + 101M token gates need raw clip count). O moved pricing above
quantum (a stale margin costs revenue; a missed peak costs a few ops).

Big methodological lesson: within-config spread across seeds (±3,000s) rivals
between-config differences — single-seed A/B was overfitting noise. From P on,
configs are judged on 6-seed medians.

### P — 6-seed baseline of the corrected model (combat-skip bug still latent)

16,321 / 19,919 / 17,915 / 17,793 / 14,204 / 14,679 — median ≈ 17,050s, all finish.

### Stage-3 variance diagnosis (seed 3 deep-log) — the combat-skip trap

The "skip combat while its button doesn't exist" plan logic let later entries fill
all 20 trust with combat 0: the fleet lost 2.3×10¹⁰ probes in unwinnable battles
and ground Threnody honor for ~4,500s to reach maxTrust 30 — whereupon (combat 6,
rep 12) probes went e7 → e33 in minutes and the universe fell in ~1,400s. Stage 3's
real clock is time-to-honor, and WINNING battles is the honor fountain (Name the
Battles pays per enemy killed). Fix: combat's trust budget is reserved — the plan
stalls at 17/20 (rep8/haz4) until the Combat project (150k ops, reachable early
via gifts + the tempOps ride) unlocks the button. Config Q = P + this fix.

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

### Q → R: the repeatable-token bug — stage 1's dominant loss found

Q (combat-reserve alone): median ≈ 17,242s — no gain; the honor grind still ruled
stage 3, and stage 1 still stalled. Then the Monopoly→Hypno diagnostic caught it:
**trust sat at 99 for 2,100s with $28B banked and a $32M bribe pending.** Another
Token of Goodwill is repeatable but its .flag sets permanently on first purchase —
the withdraw rule gated on !flag funded exactly ONE token, ever. Every later token
waited for fib-clip milestones instead. Fix: while trust<100, always consider the
current bribe. Plus a de-minimis rule: purchases under 1% of the invested balance
skip the engine hurdle (the hurdle protects a small bankroll; it shouldn't freeze
the economy after the wealth explosion).

**Config R medians (6 seeds): 14,288/14,328/14,298/14,806/14,736/17,883 →
median ≈ 14,530s (−2,700 vs Q).** HypnoDrones: 5,725-6,683 (was ~8,300 median).
Split structure now: stage 1 ≈ 5,800s · stage 2 ≈ 4,800s (regressed - next
diagnosis target) · stage 3 ≈ 3,600s (honor grind).

### S (in flight): stage-3 honor-rate pivot

From the seed-3 deep log: the 91,118-honor grind ran ~5,100s at ~19 honor/s with
creativity starved (gifts went to memory-250, a Monument-only target). S: gifts →
memory only to 150 (Combat's gate) then all processors (creativity IS the Threnody
cadence); think-slider stays up until the first maxTrust rung; tier-20 ends
rep8 → combat 4 (wins pay honor, draws don't).

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

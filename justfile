# Universal Paperclips — optimal-strategy project
#
# `just` with no arguments lists these recipes.
# The world record we're chasing is 5,662s (Any% Desktop); see RUNS.md.

default:
    @just --list

# --- Simulation ------------------------------------------------------------

# One headless run: `just run`, `just run 10800`, `just run 10800 3`
run seconds="10800" seed="1":
    node bot/run-headless.js {{seconds}} {{seed}}

# Multi-seed comparison — the only sound way to judge a policy change
# (within-config spread across seeds rivals between-config differences).
seeds seconds="21600" list="1,2,3,4,5,6":
    node bot/run-seeds.js {{seconds}} {{list}}

# Just the bottom line of a multi-seed sweep.
medians seconds="21600" list="1,2,3,4,5,6":
    @node bot/run-seeds.js {{seconds}} {{list}} | sed -n '/=== summary/,$p'

# Milestone split table for a single seed (where the time actually goes).
splits seconds="21600" seed="1":
    @node bot/run-headless.js {{seconds}} {{seed}} | sed -n '/milestone splits/,/^$/p'

# --- Tests -----------------------------------------------------------------

# Simulator equivalence suite (37 tests).
test:
    node sim/validate.js

# Syntax-check every bot module.
check:
    @for f in bot/*.js bot/adapters/*.js; do node -c "$f" || exit 1; done
    @echo "all bot modules parse"

# test + check, the pre-commit gate.
verify: check test

# --- Playing it yourself ---------------------------------------------------

# Serve the game with the autoplay bot panel at http://localhost:8000/index2.html
# (src/ must be the web root so the game's own relative script tags resolve).
play port="8000":
    @echo "http://localhost:{{port}}/index2.html  —  Ctrl-C to stop"
    @cd src && python3 -m http.server {{port}}

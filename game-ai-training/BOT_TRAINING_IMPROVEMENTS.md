# Bot Quality Improvement Review

## Scope Reviewed

This review focuses on:

- Core game rules and action generation in the Node wrapper.
- State representation, reward design, and PPO training loop in Python.
- Evaluation workflow and progression/curriculum logic.

## Key Findings

### 1) State representation is too lossy

The policy currently receives:

- current player,
- own seat id,
- own hand (one-hot),
- own piece status buckets (penalty/home/completed/track).

This omits critical information:

- exact positions of all pieces,
- partner/opponent progress,
- danger (capture threats),
- deck/discard context,
- turn and tempo context.

**Impact:** bots cannot learn positional tactics, threat avoidance, or partnership play.

### 2) Rewards are sparse and mostly terminal-like

The environment emphasizes piece completion and a small penalty for skipping home entry, with many previous signals set to zero.

**Impact:** high variance learning, weak credit assignment, and slower tactical emergence.

### 3) Action abstraction is fragile

Action IDs are hand-crafted and overloaded (`0-59` regular, `60+` special split-7, `70+` discard patterns), with wrapper-side generation and fallback logic.

**Impact:** policy learns wrapper artifacts instead of pure game semantics; can create instability when hand/card indexing shifts.

### 4) PPO update path is effectively single-seat focused per episode

`train_focus_idx` rotates, but only one focused trainable seat stores memory each step.

**Impact:** sample efficiency is lower than expected for 4-player self-play; policy updates are noisier and slower.

### 5) Self-play diversity is limited

There is seating shuffle and occasional snapshot opponents, but no structured league/population, no ELO-gated opponent sampling, and no explicit exploitability checks.

**Impact:** easy overfitting to recent policy behavior and weak robustness to style shifts.

### 6) Evaluation loop is underpowered

Tournaments exist, but training promotion still relies heavily on local win-rate thresholds, without robust confidence intervals or scenario suites.

**Impact:** difficulty progression can advance or stall for the wrong reasons.

---

## Recommended Improvements

## Priority 0 (fast, high ROI)

### A. Enrich observations (backward-compatible)

Add features to `get_state`:

- normalized track index for every piece (all players),
- piece flags: vulnerable-to-capture next turn, can-capture-now,
- teammate completion progress,
- legal action metadata summary (counts by type: safe move/capture/home-entry/discard/split-7),
- turn fraction and remaining cards in deck/discard.

**Expected result:** immediate tactical jump and faster learning curves.

### B. Convert rewards to event-vector + weighted scalar

Keep event accounting, but compute rewards via explicit config weights:

- progress toward home stretch,
- capture value with anti-farming cap,
- safety value (escaping immediate capture range),
- partnership reward (enabling teammate completion opportunities),
- terminal win/loss bonus (non-zero and stable).

Use per-event clipping and normalize per-episode totals.

**Expected result:** better credit assignment and less reward hacking.

### C. Train from all trainable seats every episode

Store transitions and compute PPO updates for every trainable bot that acted in the episode (or share one policy across seats with role conditioning).

**Expected result:** 2-4x sample efficiency improvement.

## Priority 1 (medium effort, major quality gain)

### D. Structured self-play league

Maintain pool:

- latest,
- best-by-ELO,
- diverse historical checkpoints.

Sample opponents by mixed distribution (e.g., 50/30/20) and periodically refresh pool.

**Expected result:** stronger generalization and reduced catastrophic forgetting.

### E. Action interface hardening

Move from index-encoded actions to semantic action objects internally:

- `{type: move|special|discard, card_ref, piece_id, split_spec}`

Map to/from numeric IDs only at model boundary with deterministic adapter tests.

**Expected result:** fewer invalid-action loops and easier feature/architecture evolution.

### F. Evaluation gates before curriculum promotion

Before increasing `pieces_per_player`, require:

- win-rate threshold over fixed N games,
- confidence interval lower bound pass,
- pass against frozen baseline set,
- pass on edge-case scenario suite.

**Expected result:** stable progression and fewer regressions.

## Priority 2 (advanced)

### G. Centralized critic or role-conditioned policy

Given 2v2 structure, use:

- shared actor with seat/team embeddings,
- centralized critic with broader state context.

**Expected result:** improved cooperation and reduced non-stationarity.

### H. Offline dataset + imitation warm start

Log expert/strong-bot trajectories, warm start policy with behavior cloning, then switch to PPO fine-tuning.

**Expected result:** faster bootstrap and better early-stage play.

### I. Robust experiment tracking

Add run IDs and persist:

- config hash,
- git commit,
- evaluation suite results,
- ELO trajectory,
- reward-component curves.

**Expected result:** reproducible optimization and faster debugging.

---

## Concrete 4-Week Rollout Plan

### Week 1

- Observation enrichment.
- Reward weight table + event clipping.
- Add deterministic tests for state encoding and action adapter.

### Week 2

- Multi-seat training updates.
- Baseline evaluation harness with fixed seeds and CI metrics.

### Week 3

- League self-play with checkpoint sampling.
- Promotion gate based on confidence-bound win rates.

### Week 4

- Ablation study and hyperparameter sweep.
- Lock in new default config and publish benchmark report.

---

## Suggested Success Metrics

Track these as release gates:

- Win rate vs current production bot set (>= +10pp).
- Lower variance across seeds (stddev drop >= 20%).
- Invalid/forced-fallback action rate (< 0.5%).
- Curriculum rollback frequency (near zero after stabilization).
- Head-to-head robustness across historical checkpoints.

## Minimal Experiment Matrix

Run at least:

1. **Obs+Reward only**
2. **Obs+Reward+Multi-seat PPO**
3. **Obs+Reward+Multi-seat PPO+League**

Use identical seeds and evaluation suite; promote only if all key gates improve.

---

## Final Recommendation

If you want the fastest path to better bots, prioritize:

1. richer state,
2. denser but controlled reward vector,
3. multi-seat training updates,
4. league-based evaluation gates.

This sequence gives the best quality-per-engineering-hour and creates a foundation for advanced multi-agent methods later.

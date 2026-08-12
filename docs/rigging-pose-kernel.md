# Portable rig poses and deterministic FK

Hodos represents test poses independently of a renderer, animation mixer, or
skin deformation engine.

```text
hodos.rig/0-alpha
  rest hierarchy and joint limits
          |
          v
hodos.rig-pose/0-alpha
  sparse local translation offsets
  sparse local rotation deltas
          |
          v
deterministic FK and limit evaluation
          |
          +--> hodos.rig-pose-outcome/0-alpha
          |
          v
hodos.rig-pose-suite/0-alpha
  named chains and ordered test cases
          |
          v
hodos.rig-pose-suite-outcome/0-alpha
```

## Transform semantics

A pose translation is an additive local offset from the canonical rest
translation. A pose rotation is a normalized local delta quaternion composed
after the authored rest rotation. Scale remains owned by the rest rig in this
first release.

World transforms are evaluated from the acyclic rig hierarchy. Multiple roots
are supported. Evaluation is pure and does not mutate the rig or pose.

## Joint limits

Limit values are radians. Existing rig limits are evaluated against the pose
rotation delta:

- swing magnitude;
- signed twist around a deterministic primary joint axis; and
- per-axis XYZ angular ranges.

The primary axis is the joint's non-zero rest translation, then the first
non-zero child translation, then the rig coordinate-system up axis. This rule is
portable and does not assume humanoid naming.

Callers select one of three policies:

```text
warn    apply the pose and report violations
reject  report violations and withhold evaluated transforms
ignore  apply the pose while retaining diagnostic metrics
```

## Suites and chains

A pose suite belongs to an exact rig identity and revision. It declares ordered
named chains using explicit contiguous joint IDs and ordered cases containing
inline sparse poses. Cases may require semantic joint roles; a missing role
skips the case instead of inventing anatomy.

Suite outcomes preserve case order and aggregate pass, warning, rejection, and
skip counts. Renderer-owned IK and deformation metrics build on these portable
suite identities in later slices.

## Semantic editing

`hodos.rig-pose-intent/0-alpha` supports one revision-checked joint update,
joint removal, or reset. Stale pose or rig revisions are rejected without
changing the previous pose.

# Hodos client-side rigging harness

Tracking epic: [#62](https://github.com/greenways-ai/hodos/issues/62)

The Hodos Rigging Harness is a browser-first workflow for models that cannot be
completed by a one-click humanoid auto-rigger. It does not begin by trying to
reproduce Mixamo's proprietary inference or animation library. Its advantage is
that a failed proposal is not a dead end: the skeleton, constraints, weights,
poses and evidence remain editable, reversible and exportable.

The initial target is an unrigged or badly rigged GLB exported by Tripo Studio,
including stylized, asymmetric, disconnected and non-humanoid assets.

## Product definition

For this workflow, “better than Mixamo” means:

- arbitrary acyclic skeletons rather than a mandatory humanoid template;
- local model handling without a mandatory upload;
- precise manual recovery after an automatic proposal fails;
- serializable semantic operations with undo and redo;
- objective pose and deformation checks before export;
- standards-valid glTF/GLB output; and
- reproducible comparison of two rig revisions against the same pose suite.

It does **not** mean that the first release will outperform a trained service at
one-click skeleton recognition.

## Ownership boundary

```text
portable Hodos state
  rig document
  semantic intents and outcomes
  accepted artifact identities
  bounded deformation evidence
             │
             ▼
renderer/host capability
  GLB decode and typed arrays
  adjacency and acceleration structures
  picking and joint overlays
  worker-based weight generation
  GPU skinning and heat maps
  final GLB byte construction
```

Hodos owns the values that need to survive, synchronize, compare or participate
in history. A renderer owns frame-hot objects and large geometry buffers. Raw
vertex arrays, PlayCanvas entities and GPU resources must never be inserted into
the portable rig document.

The PlayCanvas package is the first reference provider. Alumbra can implement
the same proven host profile through its own adapter; Hodos must not import
Alumbra.

## Portable rig contract

The first contract is exported as
`@greenways/hodos-world-model/rigging` and uses the schema
`hodos.rig/0-alpha`:

```js
{
  schema: "hodos.rig/0-alpha",
  id: "rig:opal-creature",
  assetId: "sha256:source-glb",
  revision: 7,
  coordinateSystem: {
    up: "y",
    handedness: "right",
    unitScale: 1
  },
  joints: [
    {
      id: "root",
      parent: null,
      role: "root",
      rest: {
        translation: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1]
      },
      limits: null
    },
    {
      id: "left-wing-1",
      parent: "root",
      role: "appendage/wing",
      rest: {
        translation: [-0.4, 0.8, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1]
      },
      limits: {
        swing: 1.1,
        twist: [-0.35, 0.35]
      }
    }
  ],
  skin: {
    handleType: "rig/weights",
    weightSetId: "weights:sha256:accepted",
    maxInfluences: 4
  },
  bind: {
    inverseMatricesId: "bind:sha256:accepted"
  }
}
```

The document contains identities and bounded metadata. The referenced accepted
weight and inverse-bind artifacts may be large and remain behind host-managed
handles or content-addressed storage.

## Implemented kernel

Issue [#63](https://github.com/greenways-ai/hodos/issues/63) establishes the
renderer-independent authoring kernel:

- strict normalization and validation of portable rig documents;
- duplicate, missing-parent, self-parent and cycle detection;
- finite rest transforms, normalized quaternions and positive scales;
- arbitrary forests with a warning for multiple roots;
- immutable joint create, update, rename, reparent, delete and mirror operations;
- parent-aware world rest transforms and joint segments;
- deterministic nearest-segment initial weights over caller-owned typed arrays;
- four-influence normalization and malformed-weight diagnostics;
- revision preconditions for ordered semantic intents; and
- bounded `hodos.rig-outcome/0-alpha` and `hodos.rig-evidence/0-alpha` records.

The typed arrays returned by initial weighting are transient host values. Only
the summary and an accepted artifact identity belong in portable Hodos state.

## Release train

1. [#63](https://github.com/greenways-ai/hodos/issues/63) — portable contract
   and deterministic authoring kernel.
2. [#64](https://github.com/greenways-ai/hodos/issues/64) — local GLB preflight
   and immutable asset resting.
3. [#65](https://github.com/greenways-ai/hodos/issues/65) — visual skeleton
   authoring and accessible hierarchy editing.
4. [#66](https://github.com/greenways-ai/hodos/issues/66) — binding, weight
   painting and deformation diagnostics.
5. [#67](https://github.com/greenways-ai/hodos/issues/67) — pose testing,
   constraints, IK and revision evidence.
6. [#68](https://github.com/greenways-ai/hodos/issues/68) — GLB export,
   validation and reload.
7. [#69](https://github.com/greenways-ai/hodos/issues/69) — Tripo failure corpus
   and measured Mixamo comparison.

Each slice is independently testable. The contract does not speculate about a
universal renderer API before the PlayCanvas and Alumbra providers prove the
minimum shared profile.

## First end-to-end demonstration

```text
open a failed Tripo GLB locally
  → inspect bounded preflight results
  → place a root and custom appendage chain
  → mirror a selected chain when useful
  → seed and correct weights
  → drag an end effector through test poses
  → inspect deformation evidence
  → compare one correction with its prior revision
  → export a validated rigged GLB
  → reload in Hodos and Alumbra
```

A botanical demonstration is intentionally valid. A lotus, orchid or peacock
plant can use one central root and a short chain per petal or leaf; no humanoid
classification is necessary.

## Performance and safety constraints

- The portable document is limited to 1,024 joints by default.
- glTF-compatible output is limited to four active influences per vertex.
- Initial weighting has an explicit vertex bound and should move into a worker
  when connected to decoded mesh buffers.
- Pointer and brush previews stay renderer-local; pointer release commits one
  bounded semantic operation.
- GLB parsing and export must treat model contents as untrusted input.
- Errors leave the previous canonical revision intact.
- Evidence contains bounded summaries and artifact identities, not unbounded
  vertex or frame data.

## Benchmark gate

The comparison in #69 must use a rights-cleared corpus of at least ten assets
that an automatic workflow rejects or deforms badly. The release target is not
“more one-click successes than Mixamo”; it is that at least 80% of those failure
cases can be recovered into a standards-valid rig, with remaining failures
classified and visible through evidence.

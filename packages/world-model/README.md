# @greenways/hodos-world-model

Runtime-neutral world primitives for Hodos. The package owns entity,
selection, authoring, draft, animation, character sequence, prefab, typed drag,
and portable rigging models without depending on a renderer, DOM shell, network
source, or Hara runtime.

The add-on contributes `world.model/authoring`; direct subpath exports remain
available to renderers and UI packages that need individual model modules.

## Character and sequence model

`@greenways/hodos-world-model/character` defines `hodos.character/0-alpha`
profiles with immutable asset and rig identities, named animation clips, layers,
markers, root-motion policy and declared capabilities.

`@greenways/hodos-world-model/sequence` defines the renderer-neutral
`hodos.sequence/0-alpha` cue document and deterministic logical-time runtime. It
supports:

- stable actor, scene-mark, cue, branch and event identities;
- absolute, after, with, any, all and marker-driven starts;
- actor, camera, dialogue, audio, world and workflow operation metadata;
- immediate, marker and external completion boundaries;
- guarded branches through portable variables and choice events;
- logical-time timeouts with fail, complete, cancel or skip policy;
- duplicate-event suppression and bounded portable traces; and
- structured host effects without frame callbacks or renderer objects.

The sequence runtime advances semantic cue boundaries only. Animation mixers,
navigation, IK, audio nodes, frame interpolation and GPU state remain behind a
trusted host such as the reference PlayCanvas provider or a later Alumbra-owned
adapter.

## Rigging model

`@greenways/hodos-world-model/rigging` provides the client-side rigging
contracts used by the Hodos Rigging Harness. It includes:

- `hodos.rig/0-alpha` normalization and hierarchy validation;
- immutable joint create, update, rename, reparent, delete, duplicate, and
  mirror helpers;
- parent-aware rest transforms and joint segments;
- deterministic nearest-segment initial skin weights over caller-owned arrays;
- glTF-compatible influence normalization and compact diagnostics;
- semantic intent outcomes plus bounded rig evidence;
- `hodos.rig-source/0-alpha` immutable source identity and opaque handle values;
- `hodos.rig-preflight/0-alpha` bounded model inventory and blocker evidence;
- `hodos.rig-session/0-alpha` recoverable local-open session state;
- `hodos.rig-editor/0-alpha` selection, focus, expansion, tool, orientation and
  snapping state;
- `hodos.rig-authoring/0-alpha` canonical rig, editor and bounded undo/redo
  snapshots; and
- transient, revision-bound keyboard and numeric move transactions that produce
  one semantic intent only at an explicit commit boundary.

The hierarchy projection is renderer-neutral and suitable for an accessible
browser tree. Pointer movement remains a host preview; pointer release produces
one revision-checked rig intent. Undo and redo restore the rig document and
selection/focus state together.

Renderer entities, decoded GLB documents, mesh buffers and GPU resources are
deliberately not part of the portable documents. Failed replacement opens retain
the last accepted source and preflight so a working session is not discarded.
See `docs/client-side-rigging.md` and `docs/rigging-authoring.md` for the host
boundary and workbench contract.

## Portable rig workfiles

`@greenways/hodos-world-model/rigging` also exports the bounded
`hodos.rig-workfile/0-alpha` envelope, deterministic JSON and EDN-compatible
serializers, source-identity reconciliation, and structured restore preparation.
Workfiles retain the normalized rig, optional editor state and history limit,
while omitting sessions, opaque handles, undo snapshots and renderer values.

The rigging model also provides deterministic rigid-component initial weights
and inverse bind matrix generation. These pure functions accept caller-owned
typed arrays; the arrays remain host values and are never embedded in portable
Hodos documents.

## Bounded weight editing

The rigging export also provides deterministic add, subtract, replace, rigid,
smooth, flood, prune and normalize operations over caller-owned buffers. CSR
adjacency diagnostics return bounded summaries plus caller-owned representative
vertices. `buildRigWeightAttachmentIntent` converts an accepted host artifact
into the existing portable `rig/skin-attach` command.

## Pose and test-suite model

`@greenways/hodos-world-model/rigging` also exports the renderer-neutral pose
kernel:

- `hodos.rig-pose/0-alpha` sparse local translation offsets and rotation deltas;
- deterministic local/world forward kinematics for arbitrary acyclic rigs;
- swing, twist and per-axis joint-limit evaluation with warn, reject or ignore
  policy;
- `hodos.rig-pose-suite/0-alpha` ordered named chains and role-gated cases;
- bounded pose and suite outcomes; and
- revision-checked pose set, remove and reset intents.

Pose values contain no animation mixers, solver buffers, renderer objects,
weights or deformed vertices. See `docs/rigging-pose-kernel.md` for the exact
transform, limit, suite and semantic editing contracts.

## Portable inverse-kinematics boundary

The rigging export now also defines bounded `hodos.rig-ik-request/0-alpha`,
`hodos.rig-ik-proposal/0-alpha`, `hodos.rig-ik-evidence/0-alpha`, and
`hodos.rig-ik-acceptance/0-alpha` values. Requests select an arbitrary named pose
suite chain and exact rig/pose revisions. Successful proposals contain only
sparse normalized local rotation deltas, while evidence records provider
identity, reach/convergence classification, effective resource bounds and
bounded limit diagnostics.

`applyRigIkProposal` is the sole portable acceptance boundary: it rejects stale
rigs and poses and advances the pose exactly once. Solver iteration arrays,
cancellation state and renderer transforms remain behind a host provider. See
`docs/rigging-ik-provider.md` for the reference analytic two-bone and bounded
FABRIK contracts.

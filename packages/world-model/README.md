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
- immutable joint create, update, rename, reparent, delete, and mirror helpers;
- parent-aware rest transforms and joint segments;
- deterministic nearest-segment initial skin weights over caller-owned arrays;
- glTF-compatible influence normalization and compact diagnostics;
- semantic intent outcomes plus bounded rig evidence;
- `hodos.rig-source/0-alpha` immutable source identity and opaque handle values;
- `hodos.rig-preflight/0-alpha` bounded model inventory and blocker evidence; and
- `hodos.rig-session/0-alpha` recoverable local-open session state.

Renderer entities, decoded GLB documents, mesh buffers and GPU resources are
deliberately not part of the portable documents. Failed replacement opens retain
the last accepted source and preflight so a working session is not discarded.
See `docs/client-side-rigging.md` for the host boundary and release train.

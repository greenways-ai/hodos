# @greenways/hodos-world-model

Runtime-neutral world primitives for Hodos. The package owns entity,
selection, authoring, draft, animation, prefab, typed drag, and portable rigging
models without depending on a renderer, DOM shell, network source, or Hara
runtime.

The add-on contributes `world.model/authoring`; direct subpath exports remain
available to renderers and UI packages that need individual model modules.

## Rigging model

`@greenways/hodos-world-model/rigging` provides the first client-side rigging
contract used by the Hodos Rigging Harness. It includes:

- `hodos.rig/0-alpha` normalization and hierarchy validation;
- immutable joint create, update, rename, reparent, delete, and mirror helpers;
- parent-aware rest transforms and joint segments;
- deterministic nearest-segment initial skin weights over caller-owned arrays;
- glTF-compatible influence normalization and compact diagnostics; and
- semantic intent outcomes plus bounded rig evidence.

Renderer entities, decoded mesh buffers and GPU resources are deliberately not
part of the portable document. See `docs/client-side-rigging.md` for the host
boundary and release train.

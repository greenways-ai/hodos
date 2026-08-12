# @greenways/hodos-ui-world-authoring

Optional browser authoring UI for Hodos. It supplies the outliner, inspector,
multi-selection tools, assets, prefabs, collections, animation, Hara scripts,
and draft controls without making those panels part of the base viewer.

Activation requires the PlayCanvas renderer and runtime-neutral world model,
enables advanced world authoring, and contributes `world.ui/authoring`.

## Rigging workspace

The package also contributes `rig.ui/authoring` and exports
`@greenways/hodos-ui-world-authoring/rigging`. The workspace provides:

- local-only GLB opening through the opaque rigging asset host;
- an accessible `role=tree` skeleton hierarchy with roving focus;
- selection, add, move, rename, reparent, duplicate, mirror and subtree delete;
- world/local position inspection;
- surface, depth, grid and unsnapped placement modes;
- mouse, pen, touch and keyboard controls; and
- deterministic undo/redo of the rig document together with selection and
  hierarchy focus.

The workspace can own its local state or dispatch the declared
`HODOS_RIGGING_AUTHORING_EVENTS` through a Hodos component host. Model bytes and
PlayCanvas entities remain outside the component model.

## Rig workfile save and autosave

The rigging workspace can open and download deterministic portable rig
workfiles. Matching local autosaves are restored only after the user reopens the
source GLB. Storage is injected through a small `get`/`set`/`delete` provider;
the package includes Web Storage and in-memory adapters. An explicit rebind
policy preserves skeleton structure while clearing mesh-specific skin and bind
artifact identities.

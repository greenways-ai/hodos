# Skin and weight painting workspace

The Skin / Weights activity is the visible projection of the host-owned binding
and editing layers introduced by issues #91 and #92.

```text
accepted local GLB handle
  → deterministic initial binding
  → weights:sha256:* + bind:sha256:*
  → active-joint heat-map sample
  → triangle hit + opaque sphere selection
  → host-local stroke preview
  → one immutable artifact on pointer release
  → rig/skin-attach
```

## Initial binding

The toolbar exposes two deterministic strategies:

- **Bind smooth** uses nearest authored joint segments and normalized influence
  falloff.
- **Bind components** rigidly assigns every disconnected component to one
  nearest joint, which is useful for armour, jewellery, mechanical pieces,
  separate petals, and generated meshes with disconnected parts.

Only the accepted artifact identities are attached to the portable rig.

## Heat maps

Selecting a joint in the hierarchy displays a bounded, deterministic sample of
that joint's current weight. The sample contains renderer-local positions,
values, and source vertex indices and is zeroed whenever it is replaced or the
renderer is destroyed. Portable UI state receives only bounded sample evidence.

## Brush operations

The workspace exposes add, subtract, replace, rigid, smooth, flood, prune, and
normalize operations. A stroke uses the local triangle BVH to create bounded
sphere selections. Successive hits are unioned into one opaque selection.
Every movement recomputes a private preview from the same immutable base
artifact; no preview mutates canonical rig state.

Pointer release commits one content-addressed artifact and dispatches one
`rig/skin-attach` intent. Pointer cancellation discards the preview and releases
the selection. Undo and redo therefore move between exact artifact identities,
not reconstructed brush commands.

## Diagnostics and boundaries

The browser can report structural weight validity, normalization, discarded
influence, abrupt adjacency gradients, and representative problem selections.
Raw geometry, adjacency, selections, previews, and weight arrays remain private
to the local asset host. Releasing an asset destroys all of them.

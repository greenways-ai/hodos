# @greenways/hodos-renderer-playcanvas

The PlayCanvas projection for Hodos worlds: Gaussian splat layers, semantic
entities, spatial sources, touchpoints, selection, camera control, and optional
advanced authoring overlays.

The add-on requires `world.render`, depends on the runtime-neutral world model,
and contributes `world.renderer/playcanvas`. Browser shells should import the
`./styles` subpath alongside the renderer.

## Local rigging assets

The package contributes `rig.asset-host/playcanvas-local` and exports:

- `@greenways/hodos-renderer-playcanvas/rigging-assets` for the session-scoped
  opaque asset host; and
- `@greenways/hodos-renderer-playcanvas/rigging-preflight` for deterministic
  SHA-256 identity, strict GLB parsing, bounded inventory, topology checks and
  existing-skin diagnostics.

Opening an `ArrayBuffer`, typed array, `File`, or `Blob` performs no upload and
never follows external buffer or image URLs. Raw bytes, parsed glTF JSON,
accessor views and topology state remain behind the host handle. Configurable
asset-count and total-byte limits keep the local host bounded. Portable Hodos
state receives only source identity, bounded preflight evidence and recoverable
session state.

## Skeleton authoring

The package also contributes `rig.renderer/playcanvas` and exports:

- `./rigging-overlay`, a joint/bone projection and touch-sized screen-space
  picker; and
- `./rigging-authoring`, a renderer that displays an opaque local GLB and
  supports joint selection, placement and movement.

The overlay is rebuilt from portable rig values. PlayCanvas `Entity`, material,
asset and object-URL values never enter the rig document. Drag movement is a
host-local preview; one `hodos.rig-intent/0-alpha` value is emitted only on
pointer release. Surface placement may use an injected mesh picker; when one is
not available, the bounded source AABB is used rather than pretending to have
triangle-accurate evidence.

# @greenways/hodos-renderer-playcanvas

The PlayCanvas projection for Hodos worlds: Gaussian splat layers, semantic
entities, spatial sources, touchpoints, selection, camera control, and optional
advanced authoring overlays.

The add-on requires `world.render`, depends on the runtime-neutral world model,
and contributes `world.renderer/playcanvas`. Browser shells should import the
`./styles` subpath alongside the renderer.

## Local rigging assets

The package also contributes `rig.asset-host/playcanvas-local` and exports:

- `@greenways/hodos-renderer-playcanvas/rigging-assets` for the session-scoped
  opaque asset host; and
- `@greenways/hodos-renderer-playcanvas/rigging-preflight` for deterministic
  SHA-256 identity, strict GLB parsing, bounded inventory, topology checks and
  existing-skin diagnostics.

Opening an `ArrayBuffer`, typed array, `File`, or `Blob` performs no upload and
never follows external buffer or image URLs. Raw bytes, parsed glTF JSON,
accessor views and topology state remain behind the host handle. Portable Hodos
state receives only source identity, bounded preflight evidence and recoverable
session state.

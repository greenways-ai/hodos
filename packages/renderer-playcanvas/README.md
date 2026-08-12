# @greenways/hodos-renderer-playcanvas

The PlayCanvas projection for Hodos worlds: Gaussian splat layers, semantic
entities, spatial sources, touchpoints, selection, camera control, character
sequences, and optional advanced authoring overlays.

The add-on requires `world.render`, depends on the runtime-neutral world model,
and contributes `world.renderer/playcanvas` and `sequence.host/playcanvas`.
Browser shells should import the `./styles` subpath alongside the renderer.

## Character sequence host

`@greenways/hodos-renderer-playcanvas/sequence` consumes the structured
`sequence/action` effects emitted by the runtime-neutral Hodos sequence model.
It provides bounded, idempotent host execution for:

- actor placement, movement, turning, look-at, clip playback, blending,
  gestures and dialogue;
- camera cuts and logical-time blends;
- audio playback and world events; and
- stable semantic markers such as `arrived`, `clip-complete`,
  `line-finished`, `camera-complete` and `audio-finished`.

PlayCanvas entities, animation mixers, navigation agents, audio nodes and
renderer state remain behind the host. Only portable marker, completion and
failure events are returned to the sequence runtime.
`createPlayCanvasSequenceOperationProfile` converts host-side immediate actions
such as placement, camera cuts and world events to externally acknowledged
runtime cues, so provider failures cannot be lost after the portable runtime
has already marked a cue complete. Navigation, dialogue and audio can be
provided as injected drivers; deterministic movement, look-at, animation and
camera fallbacks cover the first reference profile. Cancellation uses
`AbortSignal`, restores interrupted camera blends, suppresses late promise
completion, and disposes provider-owned resources exactly once.

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

## Triangle-accurate rigging surfaces

`@greenways/hodos-renderer-playcanvas/rigging-surface` builds a bounded,
host-owned BVH from locally readable GLB triangle primitives. The opaque asset
host exposes lazy preparation, transient raycasts, bounded evidence, and
deterministic disposal. Surface triangles, accessor views and acceleration
nodes never enter portable Hodos state.

The authoring renderer uses the host raycast for `surface` placement and falls
back to source bounds or depth when geometry is compressed, external,
unsupported, or exceeds the configured limits. See
`docs/rigging-surface-picking.md`.

- `@greenways/hodos-renderer-playcanvas/rigging-handles` for projected,
  touch-sized axis translation handles.

## Deterministic skin binding artifacts

`./rigging-geometry`, `./rigging-binding`, and `./rigging-weight-task` provide
the operational skin boundary behind the portable Hodos rig document. Local
triangle geometry, CSR adjacency, connected components, worker messages, weight
buffers and inverse bind matrices remain behind the opaque asset handle.
Accepted results expose only content-addressed `weights:sha256:*` and
`bind:sha256:*` identities plus bounded diagnostics.

The first strategies are deterministic nearest-segment smooth binding and rigid
connected-component binding. The task runner accepts an injected module Worker
factory and falls back to the same deterministic inline implementation when a
Worker is unavailable. Releasing an asset zeroes all retained geometry, weights
and inverse bind matrices.

## Weight selections and editing

The local provider owns opaque world-space/component vertex selections, private
preview buffers and immutable derived weight artifacts. It exports
`./rigging-weight-selections` and `./rigging-weight-editing`; the asset host
exposes selection, preview, commit, discard, direct edit and adjacency diagnostic
operations without placing vertex or weight arrays in portable Hodos state.

## Weight heat maps and painting

`./rigging-weight-heatmap` projects a bounded sample of one joint's host-owned
weights over the accepted PlayCanvas model. `./rigging-weight-painter` converts
triangle-surface pointer hits into opaque sphere selections, accumulates one
host-local stroke preview, and commits one immutable weight artifact on release.
Neither full weight buffers nor preview selections enter portable Hodos state.

## Bounded inverse kinematics

`@greenways/hodos-renderer-playcanvas/rigging-ik` exports a separate add-on that
requires the explicit `rig.ik` host capability. It contributes
`rig.ik/playcanvas-local` without making the normal world renderer depend on IK
authority.

The reference provider implements deterministic pole-aware analytic two-bone IK
and a bounded general-chain FABRIK solver. It resolves arbitrary named chains
from portable pose suites, applies authored swing/twist and per-axis limits,
supports `AbortSignal` cancellation, and returns only a sparse pose proposal plus
compact convergence evidence. Solver working arrays, iteration state and
renderer transforms remain provider-owned. See `docs/rigging-ik-provider.md`.

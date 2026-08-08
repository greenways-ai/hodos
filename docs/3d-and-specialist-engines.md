# Hodos 3D and specialist engines

This note defines the implementation boundary between the generic Hodos 3D
projection family and specialist engines such as Alumbra.

It is non-normative. The portable requirements remain in `spec/`.

## Naming

- **Hodos** is the open specification, projection and interoperability boundary.
- **Hodos 3D** is the generic sparse-scene and spatial Workspace component
  family.
- **Hodos 3D Reference** is the first-party viewer/editor distribution and demo
  currently implemented by the existing world-model, viewer, PlayCanvas,
  authoring and publication packages.
- **Alumbra** is the voxel-first game engine and playable product built above
  Hodos.

“Worlds” remains a product/category term. It is not the name of a monolithic
Hodos engine.

## Dependency direction

```text
Hara runtime and browser services
              ↓
             Hodos
              ↓
  engine-owned Hodos adapter
              ↓
       specialist engine
```

For the first consumer:

```text
Alumbra → Hodos
Hodos   ✕ Alumbra
```

No Hodos package, specification fixture, source adapter, renderer provider, demo
or site module may import an Alumbra package. Alumbra may consume public Hodos
contracts through an Alumbra-owned adapter.

## Hodos 3D owns

- explicit spaces and coordinate-system descriptors;
- sparse semantic entities and stable identity;
- transforms, cameras and generic selection targets;
- spatial affordances and touchpoints;
- renderer-neutral assets, prefabs and animation descriptions;
- serializable editor/session projections;
- trusted component registration and lifecycle;
- generic outliner, inspector, gizmo and review projections;
- replaceable source, renderer and scene-provider boundaries.

These values describe meaning and visible interaction. They do not prescribe a
specialist engine’s memory layout or simulation.

## Specialist engines own

- dense domain state and codecs;
- simulation ticks, physics and domain collision;
- worker scheduling and caches;
- engine-specific rendering, picking and streaming;
- product rules, content and progression;
- authoritative domain transactions and reconciliation.

Alumbra therefore owns:

```text
voxel and region encodings
block registries and block state
procedural terrain generation
chunk lifecycle and streaming policy
voxel meshing and mesh caches
voxel ray traversal
light propagation, fluids and weather simulation
player collision and movement simulation
inventory, harvesting, crafting and survival
creature AI and progression
authoritative realm ticks and reconciliation
Alumbra save, snapshot and transaction formats
```

A block is not a Hodos sparse-scene entity. Hodos entities remain appropriate
for players, creatures, cameras, portals, lights, touchpoints and other sparse
semantic objects.

## Portable and hot state

### Portable projection lane

- world, actor and session identity;
- spaces and coordinate conventions;
- camera and selection projection;
- durable revision and transaction identity;
- semantic intents, actions, effects and receipts;
- bounded status and diagnostic values.

### Host-owned hot lane

- dense voxel or simulation arrays;
- light fields and collision caches;
- workers and job queues;
- mesh buffers and GPU objects;
- frame interpolation and input accumulators;
- transient particles, audio nodes and renderer entities.

Hot values must not enter Hara or portable Hodos component models. They may be
addressed through opaque, scoped handles when a host operation requires it.

## Trusted component integration

A specialist-engine repository owns its Hodos adapter and registers trusted
packaged component factories. For example, Alumbra may provide:

```text
alumbra.world/viewport
alumbra.world/block-palette
alumbra.world/chunk-inspector
```

Remote `workspace.edn` or `world.edn` values may select those IDs only when the
host has installed and trusted the package. Remote data must not supply a
factory, JavaScript URL, shader module, worker entry point or renderer code.

The component model carries only serializable projection state. Engine and
renderer services are injected by the trusted host and disposed with the
component lifecycle.

## Provider extraction rule

Do not add a speculative universal game-engine API to Hodos 3D. The existing
source/renderer/viewer separation should remain intact while Alumbra first uses
`@greenways/hodos-web` and `@greenways/hodos-workspace-ui` directly.

If that integration demonstrates a reusable scene-layer or renderer-provider
contract, extract the smallest generic hook in a later Hodos PR. The hook must:

- be specialist-engine-neutral;
- admit only trusted installed implementations;
- preserve serializable event/model boundaries;
- define deterministic update and disposal;
- keep engine state and authority in the provider.

## Migration and compatibility

The current packages continue operating during the reorganization. Target names
are tracked in #21, including `hodos-3d`, `hodos-3d-ui`, the PlayCanvas provider,
and the **Hodos 3D Reference** distribution.

Package moves and public renames should occur as small PRs with compatibility
exports. Legacy IDs should be removed only in an explicitly announced breaking
release.

## Boundary checks

The release gate should eventually enforce:

```text
Hodos source and manifests contain no Alumbra dependency
portable Hodos models contain no DOM or GPU objects
portable Hodos models contain no dense engine arrays
remote descriptors cannot provide executable factories
renderer-specific code remains in provider packages
engine adapters dispose host resources deterministically
```

Tracking:

- Hodos projection epic: #17
- Hodos 3D boundary: #21
- Alumbra engine epic: greenways-ai/alumbra#1
- Alumbra Hodos adapter: greenways-ai/alumbra#4

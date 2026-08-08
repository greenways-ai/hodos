# Hara Workspace projection foundation

Hodos is the concrete projection and interaction layer for Hara Workspaces.
Hara owns portable Workspace semantics and browser service adapters; Hodos owns
trusted Dev, 2D, 3D, audio and Greenways connector components.

Products and specialist engines compose above Hodos. They retain their own
domain state and behavior rather than moving those concerns into the Workspace
projection layer.

The first package boundary is:

```text
@greenways/hodos-web          trusted component registry and host bridge
@greenways/hodos-workspace-ui area mounting and Workspace UI projection
@greenways/hodos-dev          HAL-first developer area descriptors
@greenways/hodos-dev-ui       visible developer components
```

## Component boundary

A Hara Workspace projects plain data containing a trusted component identifier,
serializable model and allowed semantic events. Hodos resolves the identifier
against packaged factories, mounts the component, and routes declared events
back to the Workspace dispatcher. Remote data cannot provide a JavaScript URL or
factory.

```text
HAL Workspace view
    -> Hodos component descriptor
    -> trusted packaged factory
    -> DOM/canvas/editor/spatial mechanics
    -> semantic event
    -> HAL Workspace reducer or host-owned domain service
```

The Preview vertical slice uses an injected preview host. Sandbox and iframe
policy remain supplied by the Hara browser service layer; Hodos owns only the
visible Workspace component and its lifecycle.

The Dev slices add Editor, REPL, Problems, Value Inspector, Explorer, Catalog and
other product-neutral models with trusted host adapters. Their HAL-shaped models
carry serializable identity and visible state. The UI emits only declared
semantic events; it does not own canonical application state or privileged
command policy.

## Specialist-engine projection

A specialist engine may register an installed component through
`@greenways/hodos-web` and mount it as an ordinary Workspace area. The adapter
belongs to the specialist engine, not to Hodos.

```text
specialist engine state and services
    -> engine-owned Hodos adapter
    -> trusted component registration
    -> Hodos Workspace area
    -> declared semantic event
    -> engine intent/transaction boundary
```

The component model may contain serializable camera, selection, status and
revision projections. Dense arrays, workers, GPU objects, engine entities,
callbacks and private capabilities stay behind injected services or opaque
handles.

Alumbra is the first explicit consumer:

```text
Alumbra → Hodos
Hodos   ✕ Alumbra
```

Alumbra owns voxel chunks, terrain, meshing, collision, simulation and game
rules. Hodos provides the trusted Workspace/component and generic spatial
projection boundaries. See [`3d-and-specialist-engines.md`](3d-and-specialist-engines.md).

## Tracking

- Hodos reorganization epic: #17
- package foundation and Preview contract: #18
- Dev surfaces: #19
- Hodos 2D: #20
- Hodos 3D and external-engine boundary: #21
- Alumbra engine epic: greenways-ai/alumbra#1
- Alumbra Hodos adapter: greenways-ai/alumbra#4
- Hara Workspace semantics: hara-lang/hara#382
- Hara web-service boundary: hara-lang/hara-ui#8
- Playground adoption: hara-lang/hara-playground#28
- Greenways release-train boundary: greenways-ai/workspace#5
- Greenways OS connector authority: greenways-ai/greenways-os#24

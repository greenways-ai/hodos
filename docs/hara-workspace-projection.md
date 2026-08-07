# Hara Workspace projection foundation

Hodos is the concrete projection and interaction layer for Hara Workspaces.
Hara owns portable Workspace semantics and browser service adapters; Hodos owns
trusted Dev, 2D, 3D, audio and Greenways connector components.

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
    -> DOM/canvas/editor mechanics
    -> semantic event
    -> HAL Workspace reducer
```

The Preview vertical slice uses an injected preview host. Sandbox and iframe
policy remain supplied by the Hara browser service layer; Hodos owns only the
visible Workspace component and its lifecycle.

The second Dev slice adds an Editor model and trusted editor-host adapter. The
HAL-shaped model carries document identity, source version, namespace,
selection, diagnostics, completion and settings. The UI emits only declared
semantic events; it does not own canonical document state or Workspace command
semantics.

## Tracking

- Hodos reorganization epic: #17
- package foundation and Preview contract: #18
- Dev surfaces: #19
- Hara Workspace semantics: hara-lang/hara#382
- Hara web-service boundary: hara-lang/hara-ui#8
- Playground adoption: hara-lang/hara-playground#28
- Greenways release-train boundary: greenways-ai/workspace#5
- Greenways OS connector authority: greenways-ai/greenways-os#24

# @greenways/hodos-2d-ui

Trusted DOM and SVG hosts for Hodos 2D Workspace component models.

`@greenways/hodos-2d-ui` turns the declarative models from
`@greenways/hodos-2d` into visible document and graph mechanics. It owns safe
node creation, event wiring, focus restoration, pointer gestures, and
deterministic disposal. It does not become the authority for application state.

## Install

```sh
hara package install greenways/hodos-2d-ui
npm install @greenways/hodos-2d-ui
```

Package coordinates:

```text
greenways/hodos-2d-ui
@greenways/hodos-2d-ui
```

Import the package styles explicitly:

```js
import {
  registerHodosDocumentDomUi,
  registerHodosGraphDomUi,
} from "@greenways/hodos-2d-ui";
import "@greenways/hodos-2d-ui/document.css";
import "@greenways/hodos-2d-ui/graph.css";
```

## Injected hosts

Applications can provide complete trusted hosts:

```js
import { registerHodos2dUi } from "@greenways/hodos-2d-ui";

const unregister = registerHodos2dUi(registry, {
  createDocumentHost: ({ container, dispatch }) =>
    documentEditor.create({ container, dispatch }),
  createGraphHost: ({ container, dispatch }) =>
    nodeWorkbench.create({ container, dispatch }),
});
```

An injected host implements `update(model)`. Optional `dispose()` or `destroy()`
methods are called whenever the Workspace area is replaced or closed.

## Default Document host

```js
const unregisterDocument = registerHodosDocumentDomUi(registry, {
  documentDom: {
    renderArtefact: ({ container, block }) =>
      haraArtefactService.mount({ container, block }),
    reportError: console.error,
  },
});
```

The default Document host:

- creates ordinary DOM nodes rather than interpolated HTML;
- preserves document, block, text, and artefact identity;
- emits only declared `document/*` events;
- restores text focus across canonical model updates;
- disposes listeners and injected artefact renderers deterministically.

## Default Graph host

```js
const unregisterGraph = registerHodosGraphDomUi(registry, {
  graphDom: {
    reportError: console.error,
  },
});
```

The default Graph host:

- draws typed connections with SVG paths;
- preserves graph, node, port, and connection identity;
- projects viewport translation and zoom without taking authority;
- emits selection, movement, connection, creation, deletion, and command events
  only when the corresponding capability is enabled;
- keeps drag and connection gestures transient until one semantic event is
  emitted;
- never executes graph metadata or inserts graph values as HTML.

## Package Showcase

[`showcase.edn`](showcase.edn) publishes two host stories:

```text
showcase/document-host
showcase/graph-host
```

Each story is a complete Hara project with a named data-only host state and a
declared `document` or `graph` Workspace surface. The Canvas runs in the
cross-origin Playground host; State, Source, and Docs remain inert Package
Gallery panels.

```sh
npm run check:showcases
```

The local check proves package-relative paths and surfaces. Publication injects
the exact Git commit and performs the registry's immutable preflight.

## Authority boundary

```text
application / Hara
  canonical model
  event application
  capability policy
  persistence and collaboration

@greenways/hodos-2d-ui
  safe visible DOM/SVG mechanics
  transient pointer and focus state
  deterministic host lifecycle
```

The package does not evaluate Hara, persist state, resolve collaboration,
produce receipts, or integrate with Hestia.

## Focused Flow host

The `./workflow-dom` host composes the portable recipe projection with the safe
Graph host and adds a bounded inspector plus runtime command controls.

```js
import { createWorkflowDomHost } from "@greenways/hodos-2d-ui/workflow-dom";
import "@greenways/hodos-2d-ui/graph.css";
import "@greenways/hodos-2d-ui/workflow.css";

const host = createWorkflowDomHost({
  container,
  dispatch: applyWorkflowEvent,
});

host.update({
  recipe,
  registry: trustedOperationDescriptors,
  installedCapabilities: grantedCapabilities,
  run: runtimeQueryProjection,
  capabilities: {
    select: true,
    moveNode: true,
    run: true,
    cancel: true,
    resume: true,
    fork: true,
  },
});
```

The host emits `workflow/run`, `workflow/cancel`, `workflow/resume` and
`workflow/fork`; it never executes a recipe, owns a retry loop, or writes a
checkpoint. Graph selection and movement are translated back to stable recipe
node identities. Runtime attempts, replayed checkpoints, artifacts and receipt
state remain read-only projections.

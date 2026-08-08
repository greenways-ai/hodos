# @greenways/hodos-2d-ui

Trusted UI adapters and safe DOM hosts for Hodos 2D Workspace component models.

Applications can continue to inject complete document or graph implementations:

```js
import { registerHodos2dUi } from "@greenways/hodos-2d-ui";

const unregister = registerHodos2dUi(registry, {
  createDocumentHost: ({ container, dispatch }) =>
    documentEditor.create({ container, dispatch }),
  createGraphHost: ({ container, dispatch }) =>
    nodeWorkbench.create({ container, dispatch }),
});
```

Injected hosts must implement `update(model)`. Optional `dispose()` or `destroy()` lifecycle methods are invoked when the Workspace area is replaced or closed.

## Default document DOM host

The package supplies a product-neutral document host for consumers migrating from the original Hara UI document surface:

```js
import { registerHodosDocumentDomUi } from "@greenways/hodos-2d-ui";
import "@greenways/hodos-2d-ui/document.css";

const unregister = registerHodosDocumentDomUi(registry, {
  documentDom: {
    renderArtefact: ({ container, block }) =>
      haraArtefactService.mount({ container, block }),
    reportError: console.error,
  },
});
```

The Document host renders through safe DOM node creation, preserves stable document/block/text/artefact identity, emits declared `document/*` events, restores text focus across model updates and disposes listeners plus injected artefact renderers deterministically.

## Default graph DOM/SVG host

The package also supplies a safe product-neutral node-graph host:

```js
import { registerHodosGraphDomUi } from "@greenways/hodos-2d-ui";
import "@greenways/hodos-2d-ui/graph.css";

const unregister = registerHodosGraphDomUi(registry, {
  graphDom: {
    reportError: console.error,
  },
});
```

The Graph host:

- draws typed connections with SVG paths and nodes/ports with ordinary DOM nodes;
- preserves graph, node, port and connection identity in the DOM;
- projects viewport translation and zoom without taking viewport authority;
- emits `graph/select`, `graph/move-node`, `graph/connect`, `graph/create-node`, `graph/delete` and `graph/command` only when the matching capability is enabled;
- uses pointer capture for transient drag feedback, then emits one final semantic move;
- keeps connection creation as an ephemeral output-port → input-port gesture;
- disposes all render listeners deterministically on update and close;
- never executes node metadata or interpolates graph values into HTML.

Neither default host applies operations, evaluates Hara, persists state, resolves collaboration conflicts, signs receipts or grants capabilities. Those remain application and service policy.

Hodos 2D UI owns component adaptation, safe visible mechanics and lifecycle. Editing, evaluation, persistence, collaboration, artefact rendering, graph mutation and privileged capability policy remain injected host responsibilities.

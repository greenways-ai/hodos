# @greenways/hodos-2d-ui

Trusted UI adapters and safe DOM hosts for Hodos 2D Workspace component models.

Applications can continue to inject a complete document or graph implementation:

```js
import {
  registerHodos2dUi,
} from "@greenways/hodos-2d-ui";

const unregister = registerHodos2dUi(registry, {
  createDocumentHost: ({ container, dispatch }) =>
    documentEditor.create({ container, dispatch }),
  createGraphHost: ({ container, dispatch }) =>
    nodeWorkbench.create({ container, dispatch }),
});
```

The injected hosts must implement `update(model)`. Optional `dispose()` or `destroy()` lifecycle methods are invoked when the Workspace area is replaced or closed.

## Default document DOM host

The package also supplies a product-neutral document host for consumers migrating from the original Hara UI document surface:

```js
import {
  registerHodosDocumentDomUi,
} from "@greenways/hodos-2d-ui";
import "@greenways/hodos-2d-ui/document.css";

const unregister = registerHodosDocumentDomUi(registry, {
  documentDom: {
    renderArtefact: ({ container, block }) =>
      haraArtefactService.mount({ container, block }),
    reportError: console.error,
  },
});
```

The DOM host:

- renders through `createElement`, `textContent` and `replaceChildren`, never HTML interpolation;
- preserves stable document, block, text and artefact identity in the DOM;
- emits only declared `document/*` semantic events;
- restores text focus and selection across model updates;
- disposes render listeners and injected artefact renderers deterministically;
- displays committed snapshot evidence when no live artefact renderer is injected.

It does not evaluate Hara, apply document operations, persist content, sign receipts, resolve collaboration conflicts or grant capabilities. Those remain application and service policy.

Hodos 2D UI owns component adaptation, safe visible mechanics and lifecycle. Editing policy, evaluation, persistence, collaboration, artefact rendering, graph mutation and privileged capability policy remain injected host responsibilities.

# @greenways/hodos-2d-ui

Trusted UI adapters for Hodos 2D Workspace component models.

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

Hodos 2D UI owns only component adaptation and lifecycle. Editing, evaluation, persistence, collaboration, artefact rendering, graph mutation and privileged capability policy remain injected host responsibilities.

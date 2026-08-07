# @greenways/hodos-dev-ui

Visible Hodos developer components driven by HAL-shaped Workspace models.

The package currently registers Preview, Editor, REPL and Value Inspector
components:

- Preview adapts an injected Hara sandbox/iframe service;
- Editor adapts an injected trusted editor host;
- REPL adapts an injected session-console host;
- Value Inspector adapts an injected structured-value host;
- every component routes only declared semantic events back to HAL.

```js
import { registerHodosDevUi } from "@greenways/hodos-dev-ui";

const unregister = registerHodosDevUi(registry, {
  createPreviewHost: (options) => haraPreviewService.create(options),
  createEditorHost: ({ container, dispatch }) => createEditorHost(container, dispatch),
  createReplHost: ({ container, dispatch }) => createReplHost(container, dispatch),
  createValueInspectorHost: ({ container, dispatch }) =>
    createValueInspectorHost(container, dispatch),
});
```

Hodos owns visible Workspace components and semantic-event boundaries. Hara
browser services continue to own runtime transport, retained values, low-level
editor transforms, preview isolation, storage and privileged resource policy.

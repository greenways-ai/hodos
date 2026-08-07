# @greenways/hodos-dev-ui

Visible Hodos developer components driven by HAL-shaped Workspace models.

The package currently registers Catalog, Editor, Explorer, Preview, Problems,
REPL and Value Inspector components:

- Catalog adapts injected tool/activity surfaces;
- Editor adapts an injected trusted editor host;
- Explorer adapts an injected workspace-entry host;
- Preview adapts an injected Hara sandbox/iframe service;
- Problems adapts an injected diagnostic-list host;
- REPL adapts an injected session-console host;
- Value Inspector adapts an injected structured-value host;
- every component routes only declared semantic events back to HAL.

```js
import { registerHodosDevUi } from "@greenways/hodos-dev-ui";

const unregister = registerHodosDevUi(registry, {
  createCatalogHost: ({ container, dispatch }) => createCatalogHost(container, dispatch),
  createEditorHost: ({ container, dispatch }) => createEditorHost(container, dispatch),
  createExplorerHost: ({ container, dispatch }) => createExplorerHost(container, dispatch),
  createPreviewHost: (options) => haraPreviewService.create(options),
  createProblemsHost: ({ container, dispatch }) => createProblemsHost(container, dispatch),
  createReplHost: ({ container, dispatch }) => createReplHost(container, dispatch),
  createValueInspectorHost: ({ container, dispatch }) =>
    createValueInspectorHost(container, dispatch),
});
```

Hodos owns visible Workspace components and semantic-event boundaries. Hara
browser services and host applications continue to own runtime transport,
executable catalog content, diagnostic production, retained values, low-level
editor transforms, preview isolation, storage and privileged resource policy.

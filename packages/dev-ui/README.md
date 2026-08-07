# @greenways/hodos-dev-ui

Visible Hodos developer components driven by HAL-shaped Workspace models.

The package currently registers Preview, Editor and REPL components:

- Preview adapts an injected Hara sandbox/iframe service;
- Editor adapts an injected trusted editor host;
- REPL adapts an injected session-console host;
- every component routes only declared semantic events back to HAL.

```js
import { registerHodosDevUi } from "@greenways/hodos-dev-ui";

const unregister = registerHodosDevUi(registry, {
  createPreviewHost: (options) => haraPreviewService.create(options),
  createEditorHost: ({ container, dispatch }) => createEditorHost(container, dispatch),
  createReplHost: ({ container, dispatch }) => createReplHost(container, dispatch),
});
```

Hodos owns visible Workspace components and semantic-event boundaries. Hara
browser services continue to own runtime transport, low-level editor transforms,
preview isolation, storage and privileged resource policy.

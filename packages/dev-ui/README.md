# @greenways/hodos-dev-ui

Visible Hodos developer components driven by HAL-shaped Workspace models.

The package currently registers Preview and Editor components:

- Preview adapts an injected Hara sandbox/iframe service;
- Editor adapts an injected trusted editor host and routes declared semantic
  events such as change, selection, evaluation and completion back to HAL.

```js
import { registerHodosDevUi } from "@greenways/hodos-dev-ui";

const unregister = registerHodosDevUi(registry, {
  createPreviewHost: (options) => haraPreviewService.create(options),
  createEditorHost: ({ container, dispatch }) => {
    const editor = createTrustedEditor(container, { onEvent: dispatch });
    return {
      update(model) { editor.setModel(model); },
      dispose() { editor.destroy(); },
    };
  },
});
```

Hodos owns the visible Workspace component and semantic-event boundary. Hara
browser services continue to own runtime transport, low-level editor transforms,
preview isolation, storage and privileged resource policy.

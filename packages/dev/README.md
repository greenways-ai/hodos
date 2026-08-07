# @greenways/hodos-dev

HAL-first developer Workspace models for Hodos.

The package currently defines serializable Preview and Editor areas without
introducing a second Workspace model:

```js
import {
  createEditorArea,
  createPreviewArea,
} from "@greenways/hodos-dev";

const editor = createEditorArea({
  documentId: "document/main",
  path: "src/main.hal",
  source: "(ns app.core)",
  namespace: "app.core",
});

const preview = createPreviewArea({
  output: { type: "render", tree: ["main", "Ready"] },
  theme: "dark",
});
```

HAL owns document identity, source versions, selection, diagnostics, completion
models, commands and semantic events. Visible editor mechanics are supplied by
`@greenways/hodos-dev-ui` through an injected, trusted editor host.

# @greenways/hodos-dev

HAL-first developer Workspace models for Hodos.

The package currently defines serializable Preview, Editor and REPL areas
without introducing a second Workspace model:

```js
import {
  createEditorArea,
  createPreviewArea,
  createReplArea,
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

const repl = createReplArea({
  sessionId: "session/project",
  namespace: "app.core",
  status: "ready",
  entries: [{ kind: "result", text: "3" }],
});
```

HAL owns document and session identity, source versions, selections, REPL
history and entries, diagnostics, completion models, commands and semantic
events. Visible developer mechanics are supplied by `@greenways/hodos-dev-ui`
through injected, trusted hosts.

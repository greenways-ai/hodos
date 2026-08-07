# @greenways/hodos-dev

HAL-first developer Workspace models for Hodos.

The package currently defines serializable Preview, Editor, REPL and Value
Inspector areas without introducing a second Workspace model:

```js
import {
  createEditorArea,
  createPreviewArea,
  createReplArea,
  createValueInspectorArea,
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
  entries: [{ kind: "result", text: "3", valueId: "value-1" }],
});

const value = createValueInspectorArea({
  valueId: "value-1",
  status: "ready",
  display: "{:answer 42}",
  value: { answer: 42 },
  namespace: "app.core",
});
```

HAL owns document, session and retained-value identity, source versions,
selections, REPL history and entries, inspector paths, diagnostics, completion
models, commands and semantic events. Visible developer mechanics are supplied
by `@greenways/hodos-dev-ui` through injected, trusted hosts.

Value Inspector models carry only serializable projected data. Runtime value
retention, evaluation and inspection requests remain injected Hara service
responsibilities.

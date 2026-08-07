# @greenways/hodos-dev

HAL-first developer Workspace models for Hodos.

The package currently defines serializable Catalog, Editor, Explorer, Preview,
Problems, REPL and Value Inspector areas without introducing a second
Workspace model:

```js
import {
  createCatalogArea,
  createEditorArea,
  createExplorerArea,
  createPreviewArea,
  createProblemsArea,
  createReplArea,
  createValueInspectorArea,
} from "@greenways/hodos-dev";

const catalog = createCatalogArea({
  surface: "tools",
  toolsets: [{
    id: "values",
    title: "Value tools",
    description: "Build and inspect live values.",
    tools: [{ id: "defn", label: "Function", description: "Insert a function template." }],
  }],
  selectedToolsetId: "values",
});

const explorer = createExplorerArea({
  workspaceId: "workspace/project",
  workspaceTitle: "Project",
  entries: [
    { path: "src", kind: "directory" },
    { path: "src/main.hal", kind: "file", language: "hara" },
  ],
  selectedPath: "src/main.hal",
  expandedPaths: ["src"],
});

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

const problems = createProblemsArea({
  status: "ready",
  problems: [{
    id: "problem/runtime-1",
    severity: "warning",
    message: "Canonical runtime fallback active",
    source: "runtime",
  }],
});

const value = createValueInspectorArea({
  valueId: "value-1",
  status: "ready",
  display: "{:answer 42}",
  value: { answer: 42 },
  namespace: "app.core",
});
```

HAL owns catalog, document, session, workspace-entry, diagnostic and
retained-value identity, source versions, selections, REPL history and
entries, problem filters and counts, inspector paths, completion models,
commands and semantic events. Visible developer mechanics are supplied by
`@greenways/hodos-dev-ui` through injected, trusted hosts.

Catalog models carry descriptive toolset, tool, activity and check-result
projections. Executable snippets, starter source and check expressions remain
host policy and are not admitted into the Hodos model.

Problems models accept text-only runtime diagnostics and optional source,
path, namespace, request, code, range, tag and metadata projections. Runtime
diagnostic production and source-opening policy remain injected Hara and host
responsibilities.

Value Inspector models carry only serializable projected data. Runtime value
retention, evaluation and inspection requests remain injected Hara service
responsibilities.

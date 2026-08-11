# @greenways/hodos-dev

Serializable developer Workspace areas for Hodos.

`@greenways/hodos-dev` defines the model and semantic-event boundary for the
developer surfaces used by the Hara Playground and other Hodos hosts. It does
not own a browser runtime, a source repository, an editor engine, persistence,
or privileged tools.

## Install

Hara:

```clojure
:project/dependencies
{"hara:greenways/hodos-dev" {:version "^0.1.0"}}
```

JavaScript:

```sh
npm install @greenways/hodos-dev
```

## Areas

The package exports constructors for eight serializable Workspace areas:

```js
import {
  createCatalogArea,
  createEditorArea,
  createExecutionArea,
  createExplorerArea,
  createPreviewArea,
  createProblemsArea,
  createReplArea,
  createValueInspectorArea,
} from "@greenways/hodos-dev";
```

Each constructor returns the ordinary Hodos Workspace component contract:

```js
{
  "area/id": "editor/main",
  "area/type": "hodos.dev/editor",
  "area/title": "main.hal",
  "area/component": {
    "component/id": "hodos.dev/editor",
    "component/contract": "workspace.component/0-alpha",
    "component/model": { /* serializable data */ },
    "component/events": [ /* declared semantic events */ ]
  }
}
```

### Explorer

Explorer models carry canonical relative paths, file or directory identity,
language, source status, selection, expansion, filtering, counts and bounded
file-operation capabilities.

```js
const explorer = createExplorerArea({
  workspaceId: "workspace/project",
  workspaceTitle: "Project",
  entries: [
    { path: "src", kind: "directory" },
    { path: "src/main.hal", kind: "file", language: "hara" },
  ],
  selectedPath: "src/main.hal",
  expandedPaths: ["src"],
  capabilities: { refresh: true },
});
```

The source service remains authoritative for file contents, writes, renames,
deletes and refreshes.

### Editor

Editor models carry document identity, path, source text, namespace, language,
selection offsets, completion state, Paredit/rainbow/instant-evaluation
preferences and the commands exposed by the host.

```js
const editor = createEditorArea({
  documentId: "document/main",
  path: "src/main.hal",
  source: "(ns app.core)\n\n(def answer 42)",
  namespace: "app.core",
  language: "hara",
  selection: { start: 31, end: 31 },
});
```

The model describes editor state; a trusted editor host still owns DOM input,
IME behavior, low-level cursor mechanics, syntax presentation and structural
editing implementation.

### Preview

Preview models describe a renderable Hara value, presentation theme, status and
metadata. They do not admit arbitrary script, iframe policy or capability
grants.

```js
const preview = createPreviewArea({
  status: "ready",
  theme: "dark",
  output: {
    type: "render",
    tree: ["main", { class: "preview-shell" }, ["h1", "Ready"]],
  },
});
```

Sandbox creation and executable rendering remain injected host services.

### REPL

REPL models carry session identity, namespace, status, bounded transcript
entries, pending input and declared evaluation/history/value events.

```js
const repl = createReplArea({
  sessionId: "session/project",
  namespace: "app.core",
  status: "ready",
  entries: [
    { kind: "input", text: "(+ 1 2)" },
    { kind: "result", text: "3", valueId: "value/3" },
  ],
});
```

Evaluation, cancellation, history persistence and runtime transport remain Hara
service responsibilities.


### Execution

Execution models normalize three versioned Hara bytecode evidence levels:

```text
hal.bytecode-metrics/0-alpha  aggregate counters and high-water marks
hal.bytecode-events/0-alpha   compact sampled or control-flow events
hal.bytecode-trace/0-alpha    exact single-step state projections
```

Live documents retain their session, trace, source, sequence, status and
cumulative dropped-count identity. Compact events and trace steps retain stable
IDs and sequences, so polling a retained Hara ring repeatedly replaces matching
rows, preserves sequence order and bounds only after deduplication. A new trace
identity clears evidence from the previous trace rather than mixing sessions.

```js
const execution = createExecutionArea({
  state: createExecutionState({
    sessionId: "execution/lesson",
    capabilities: { pause: true, resume: true, requestTrace: true },
    limits: { events: 512, trace: 128 },
  }),
  evidence: [{
    schema: "hal.bytecode-metrics/0-alpha",
    instructions: 7,
    opcodeCounts: { constant: 3, primitive: 1, return: 1 },
    maxStackDepth: 3,
    maxCallDepth: 1,
  }],
});
```

Hara remains authoritative for compilation, execution, instrumentation,
suspension and full observations. Hodos validates, bounds, selects and
presents the resulting serializable evidence. This package does not import
the Hara runtime, WebAssembly, DOM, canvas or a 3D renderer. Products can
begin with inexpensive metrics, add a compact event timeline, and request a
full trace only when debugging or teaching requires exact machine state.

### Problems and Value Inspector

Problems models carry text-only diagnostics, severity, code, source location,
tags, filters, selection and counts. Value Inspector models carry only
serializable projected values, paths, expansion state and metadata.

Diagnostic production, source opening, runtime value retention and inspection
requests are not performed by this package.

### Catalog

Catalog models describe toolsets, tools, activities, checks, selection and run
status. Executable snippets, starter source and check expressions remain host
policy and are deliberately excluded from the model.

## Semantic events

Every area declares a closed event vocabulary. Hosts dispatch only these
semantic events back to Hara or the owning application. The model never embeds
callbacks or executable commands.

Examples include:

```text
explorer/select · explorer/toggle · explorer/refresh
editor/input · editor/selection · editor/evaluate · editor/save
preview/reload · preview/open
repl/submit · repl/cancel · repl/history · repl/inspect-value
execution/ingest · execution/select · execution/request-trace
problems/select · problems/filter · problems/open-source
value-inspector/toggle · value-inspector/copy
catalog/select-toolset · catalog/select-activity · catalog/run
```

## Package Showcases

This package owns `showcase.edn`, named EDN state fixtures and four complete
Playground projects:

```text
showcase/explorer   → files
showcase/editor     → code
showcase/preview    → preview
showcase/repl       → repl
```

The Gallery State panel shows the corresponding canonical area model. The
Canvas is the Hara Playground's live integration of the same Hodos Dev surface.

Problems, Value Inspector and Catalog remain first-class package APIs, but they
are not advertised as independent Canvas stories yet: the current Playground
Showcase contract exposes them as output/project modes rather than separately
addressable immutable surfaces.

Run from the repository root:

```sh
npm run check:showcases
npm run pack:check
npm test
```

## Ownership boundary

```text
Hara/application
  source, runtime sessions, diagnostics, retained values, tools and policy

@greenways/hodos-dev
  serializable developer-area models, Hara execution evidence and semantic event contracts

@greenways/hodos-dev-ui
  visible component adapters around injected trusted hosts

Playground or another product
  orchestration, capabilities, persistence and privileged services
```

No Hestia integration or persistence contract is required by this package.

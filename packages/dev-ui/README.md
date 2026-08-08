# @greenways/hodos-dev-ui

Visible developer Workspace components for Hodos.

`@greenways/hodos-dev-ui` adapts the serializable areas from
`@greenways/hodos-dev` to trusted host implementations. It supplies the Hodos
component boundary and lifecycle; products continue to own their editor,
runtime, filesystem, diagnostic, preview and value services.

## Install

Hara:

```clojure
:project/dependencies
{"hara:greenways/hodos-dev-ui" {:version "^0.1.0"}}
```

JavaScript:

```sh
npm install @greenways/hodos-dev-ui
```

## Register the components

```js
import { createHodosComponentRegistry } from "@greenways/hodos-web";
import { registerHodosDevUi } from "@greenways/hodos-dev-ui";

const registry = createHodosComponentRegistry();

const unregister = registerHodosDevUi(registry, {
  createCatalogHost: ({ container, dispatch }) =>
    createCatalogHost(container, dispatch),

  createEditorHost: ({ container, dispatch }) =>
    createEditorHost(container, dispatch),

  createExecutionHost: ({ container, dispatch }) =>
    createExecutionHost(container, dispatch),

  createExplorerHost: ({ container, dispatch }) =>
    createExplorerHost(container, dispatch),

  createPreviewHost: ({ container, dispatch }) =>
    previewService.create({ container, dispatch }),

  createProblemsHost: ({ container, dispatch }) =>
    createProblemsHost(container, dispatch),

  createReplHost: ({ container, dispatch }) =>
    createReplHost(container, dispatch),

  createValueInspectorHost: ({ container, dispatch }) =>
    createValueInspectorHost(container, dispatch),
});
```

Individual registrations are also exported:

```js
registerHodosCatalogUi(registry, options);
registerHodosEditorUi(registry, options);
registerHodosExecutionUi(registry, options);
registerHodosExecutionDomUi(registry, options);
registerHodosExplorerUi(registry, options);
registerHodosPreviewUi(registry, options);
registerHodosProblemsUi(registry, options);
registerHodosReplUi(registry, options);
registerHodosValueInspectorUi(registry, options);
```

## Concrete Execution host

The package includes a product-neutral DOM host for the Hodos Execution model.
It renders the three existing Hara evidence contracts without compiling or
controlling Hara itself:

```text
hal.bytecode-metrics/v1
hal.bytecode-events/v1
hal.bytecode-trace/v1
```

```js
import {
  registerHodosExecutionDomUi,
} from "@greenways/hodos-dev-ui";
import "@greenways/hodos-dev-ui/execution.css";

const unregisterExecution = registerHodosExecutionDomUi(registry, {
  executionDom: {
    dispatchSourceSelection(event) {
      // Forward the semantic editor/selection event through the application
      // compositor. The host never reaches into an editor instance directly.
      workspaceRuntime.dispatch(event);
    },
    reportError(error) {
      problemsService.report(error);
    },
  },
});
```

The host presents:

- execution status, instruction count and maximum call depth;
- metrics scorecards and opcode distribution;
- a compact instruction, transition and terminal timeline;
- selected before/after stack, locals, calls and handlers;
- retained diagnostics and omitted-evidence counts;
- start, step, bounded-run, pause, resume, reset and full-trace semantic controls;
- source-selection payloads suitable for an Editor service.

The host dispatches only execution requests through the component dispatcher:

```text
execution/select
execution/start
execution/step
execution/run
execution/pause
execution/resume
execution/reset
execution/request-trace
```

A timeline selection carries the matched source position in
`execution/select`. When `dispatchSourceSelection` is supplied, the same action
also emits a serializable `editor/selection` event to the application
compositor. Hodos does not manipulate the editor directly.

## Host contract

Every injected host receives a container, services, semantic dispatcher and
context, and returns a small lifecycle object:

```js
{
  update(model, context) {
    // Project the latest serializable Hodos model.
  },

  dispose() {
    // Remove listeners, observers, timers and owned DOM.
  }
}
```

The adapter:

1. validates that the expected host factory was supplied;
2. creates the host only after the Workspace component mounts;
3. forwards model updates without changing model authority;
4. routes declared semantic events through the Workspace dispatcher;
5. disposes the host deterministically when the area is replaced or removed.

The package does not use package metadata to construct arbitrary code and does
not accept executable component definitions from a Showcase or URL.

## Visible surfaces

### Explorer host

Projects workspace entries, expansion, selection, status and filter state. The
host may request semantic file operations, but the source service decides
whether and how they execute.

### Editor host

Projects document source, selection, completion and editor preferences into a
trusted editor implementation. The host owns DOM and input mechanics; Hara or
the application owns source truth and command policy.

### Execution host

Projects bounded metrics, compact events and trace documents into a visible
execution inspector. It emits semantic control and selection requests only.
The application owns live Hara sessions, compilation, stepping, suspension,
promise settlement, source routing and machine disposal.

### Preview host

Projects a bounded preview model into an injected sandbox or renderer. Preview
isolation, CSP, iframe policy, resources and execution remain product services.

### REPL host

Projects session state and transcript entries into a console and emits semantic
submit, history, cancel, clear and inspect-value requests.

### Problems, Value Inspector and Catalog hosts

These adapters project diagnostics, retained values and descriptive developer
catalogs. Diagnostic generation, source navigation, value retention, tool
execution and starter/check code remain outside the UI package.

## Package Showcases

This package owns four complete stories that exercise the actual trusted
Playground integrations:

```text
showcase/explorer-host   → files
showcase/editor-host     → code
showcase/preview-host    → preview
showcase/repl-host       → repl
```

Each story has:

```text
project.edn
workspace.edn
README.md
src/main.hal
```

The package-local `showcase.edn` contains no source commit. During publication,
the signed request supplies the exact repository, commit and package root. The
registry injects that identity, checks every path and proves each selected
Workspace surface before the story can appear in `packages.hara-lang.org`.

Execution, Problems, Value Inspector and Catalog are documented and shipped,
but their first independent Canvas stories wait for separately addressable
Playground Showcase surfaces. They are not represented by misleading Preview
substitutes.

Run from the repository root:

```sh
npm run check:showcases
npm run pack:check
npm test
```

## Ownership boundary

```text
@greenways/hodos-dev
  serializable execution and developer models plus closed semantic events

@greenways/hodos-dev-ui
  component registration, safe DOM projection, interaction and disposal

Hara browser services / product
  live machine, compiler, promise settlement, source provider, diagnostics,
  retained values, preview sandbox, storage and privileged policy
```

The package has no Hestia or persistence dependency.

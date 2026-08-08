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
registerHodosExplorerUi(registry, options);
registerHodosPreviewUi(registry, options);
registerHodosProblemsUi(registry, options);
registerHodosReplUi(registry, options);
registerHodosValueInspectorUi(registry, options);
```

## Host contract

Every injected host receives a container and semantic dispatcher and returns a
small lifecycle object:

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

Problems, Value Inspector and Catalog are documented and shipped, but their
first independent Canvas stories wait for separately addressable Playground
Showcase surfaces. They are not represented by misleading Preview substitutes.

Run from the repository root:

```sh
npm run check:showcases
npm run pack:check
npm test
```

## Ownership boundary

```text
@greenways/hodos-dev
  serializable models and closed semantic event vocabularies

@greenways/hodos-dev-ui
  component registration, host adaptation, update and disposal

Hara browser services / product
  runtime, editor engine, source provider, diagnostics, retained values,
  preview sandbox, storage and privileged policy
```

The package has no Hestia or persistence dependency.

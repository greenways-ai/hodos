# @greenways/hodos-2d

HAL-first document and graph models for Hodos Workspace components.

The package defines the serializable model and semantic event boundary used by
`hodos.2d/document` and `hodos.2d/graph`. It does not own browser rendering,
persistence, collaboration, evaluation, signing, or capability policy.

## Install

```sh
hara package install greenways/hodos-2d
npm install @greenways/hodos-2d
```

Hara package coordinate:

```text
greenways/hodos-2d
```

JavaScript package:

```text
@greenways/hodos-2d
```

## What ships

| Surface | Hara namespace | Purpose |
|---|---|---|
| Document | `gw.hodos.two-d.document` | Normalize document models and semantic document events. |
| Graph | `gw.hodos.two-d.graph` | Normalize typed graph models and semantic graph events. |

The JavaScript entry point exposes the matching model constructors, event
helpers, component descriptors, and registration functions.

```js
import {
  createDocumentComponentDescriptor,
  createGraphComponentDescriptor,
  registerHodos2d,
} from "@greenways/hodos-2d";

const unregister = registerHodos2d(registry);

const documentArea = createDocumentComponentDescriptor({
  id: "document/review",
  title: "Review",
  children: [],
});

const graphArea = createGraphComponentDescriptor({
  id: "graph/flow",
  nodes: [],
  connections: [],
});
```

Component IDs are stable:

```text
hodos.2d/document
hodos.2d/graph
```

## Workspace contract

A Workspace selects a component by ID and supplies a serializable model:

```clojure
{:area/id "area/document"
 :area/type "hodos.2d/document"
 :area/component
 {:component/id "hodos.2d/document"
  :component/contract "workspace.component/0-alpha"
  :component/model
  {:document {...}
   :selection {...}
   :status "ready"
   :readOnly false
   :capabilities {:select true :editText true}
   :error nil}
  :component/events
  ["document/select"
   "document/edit-text"]}}
```

The model is data. It cannot install code, grant capabilities, execute metadata,
or choose persistence policy. Applications apply emitted events and produce the
next canonical model.

## Package Showcase

This package owns two complete, immutable-story projects:

```text
showcase/document
showcase/graph
```

[`showcase.edn`](showcase.edn) publishes:

- the Document and Graph views;
- named data-only states;
- the source files that define each model;
- complete Playground projects and declared Workspace surfaces.

The package-local manifest deliberately omits source repository and commit.
Those values are injected from the signed publication request, then checked
against the exact Git tree before the story can appear in
`packages.hara-lang.org`.

Run the local source-tree check from the monorepo root:

```sh
npm run check:showcases
```

The registry performs a stricter immutable-commit preflight during publication.

## Authority boundary

```text
Hara / application
  canonical document and graph state
  event application
  capability decisions
  persistence and collaboration

@greenways/hodos-2d
  serializable model normalization
  component descriptors
  semantic event shapes

@greenways/hodos-2d-ui
  trusted visible DOM/SVG mechanics
```

No Hestia integration is required or implied by this package.

## Portable `std.work` recipe graphs

The `./workflow` subpath projects normalized `std.work.recipe/0-alpha` values
through the existing typed Graph contract. It remains a data model: operation
functions, capability grants, scheduling, checkpoint persistence, retries and
receipts stay in Hara and the selected `IWorkRuntime`.

```js
import {
  applyWorkRunOverlay,
  projectWorkRecipeGraph,
  workRecipeFromGraph,
} from "@greenways/hodos-2d/workflow";

const graph = projectWorkRecipeGraph(recipe, {
  registry: trustedOperationDescriptors,
  capabilities: ["sequence.read", "preview.render"],
});

const canonicalRecipe = workRecipeFromGraph(graph);
const running = applyWorkRunOverlay(graph, runtimeProjection);
```

The projection provides one typed node per recipe operation, stable structural
edges for `chain`, `all`, collections, `choose`, `batch` and `ensure`, and a
round-trip boundary whose graph coordinates do not affect workflow identity.
Run overlays are read-only projections derived from runtime queries and never
mutate the recipe.

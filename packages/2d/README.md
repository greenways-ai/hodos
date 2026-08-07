# @greenways/hodos-2d

HAL-first Hodos 2D Workspace models.

The first bounded slice defines two reusable component contracts:

- `hodos.2d/document` projects stable-ID rich documents with embedded Hara artefact nodes;
- `hodos.2d/graph` projects typed node graphs with validated ports, connections, viewport and selection.

```js
import {
  createDocumentArea,
  createGraphArea,
} from "@greenways/hodos-2d";

const documentArea = createDocumentArea({
  document: {
    profile: "hodos.rich-text/2",
    id: "document/main",
    children: [{
      id: "block/artefact",
      type: "hara-artefact",
      attrs: {
        artefactId: "artefact/chart",
        kind: "chart",
        mode: "live",
        entry: "app.chart/view",
        capabilities: ["inspect"],
      },
      children: [{ id: "text/source", type: "text", text: "(chart/view data)" }],
    }],
  },
});

const graphArea = createGraphArea({
  graph: {
    id: "graph/main",
    nodes: [{
      id: "node/source",
      type: "source",
      ports: [{ id: "out:0", direction: "out", dataType: "number" }],
    }],
    connections: [],
  },
});
```

## Authority boundary

Hodos owns visible 2D component models, serializable projection, topology validation, selection shape and semantic event boundaries.

Hara/runtime and host applications continue to own:

- evaluation and retained values;
- artefact rendering services;
- persistence, collaboration and signatures;
- document and graph mutation policy;
- commands, confirmation and privileged capabilities.

Embedded Hara artefacts carry identity, kind, mode, optional entry identity and bounded snapshot evidence. They do not contain executable JavaScript, host credentials or runtime transport.

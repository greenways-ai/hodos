import assert from "node:assert/strict";
import test from "node:test";
import {
  HODOS_2D_GRAPH_AREA_TYPE,
  HODOS_2D_GRAPH_COMPONENT_ID,
  createGraphArea,
  normalizeGraph,
} from "../src/index.js";

const graphValue = () => ({
  id: "graph/process",
  revision: 3,
  metadata: { timelineRoot: "sha256:timeline" },
  nodes: [
    {
      id: "node/source",
      type: "source",
      label: "Source",
      x: 10,
      y: 20,
      ports: [{ id: "out:0", direction: "out", dataType: "number" }],
    },
    {
      id: "node/double",
      type: "transform",
      label: "Double",
      x: 240,
      y: 20,
      ports: [
        { id: "in:0", direction: "in", dataType: "number" },
        { id: "out:0", direction: "out", dataType: "number" },
      ],
    },
  ],
  connections: [{
    id: "connection/source-double",
    from: { nodeId: "node/source", portId: "out:0" },
    to: { nodeId: "node/double", portId: "in:0" },
    type: "data",
  }],
});

test("Graph area validates typed topology, viewport and selection", () => {
  const area = createGraphArea({
    graph: graphValue(),
    viewport: { x: -50, y: 30, zoom: 1.25 },
    selection: {
      nodeIds: ["node/double"],
      connectionIds: ["connection/source-double"],
    },
    capabilities: {
      select: true,
      moveNode: true,
      connect: true,
      createNode: true,
      delete: true,
    },
  });
  const component = area["area/component"];
  const model = component["component/model"];
  assert.equal(area["area/type"], HODOS_2D_GRAPH_AREA_TYPE);
  assert.equal(component["component/id"], HODOS_2D_GRAPH_COMPONENT_ID);
  assert.equal(model.graph.nodes.length, 2);
  assert.equal(model.graph.connections.length, 1);
  assert.deepEqual(model.selection.nodeIds, ["node/double"]);
  assert.deepEqual(model.viewport, { x: -50, y: 30, zoom: 1.25 });
  assert.deepEqual(model.counts, { nodes: 2, connections: 1 });
});

test("Graph normalization rejects invalid topology and values", () => {
  const duplicateNode = graphValue();
  duplicateNode.nodes[1].id = "node/source";
  assert.throws(() => normalizeGraph(duplicateNode), /Duplicate.*node id/);

  const missingPort = graphValue();
  missingPort.connections[0].to.portId = "in:missing";
  assert.throws(() => normalizeGraph(missingPort), /missing target port/);

  const wrongDirection = graphValue();
  wrongDirection.connections[0].from = { nodeId: "node/double", portId: "in:0" };
  assert.throws(() => normalizeGraph(wrongDirection), /out port to an in port/);

  const incompatible = graphValue();
  incompatible.nodes[1].ports[0].dataType = "string";
  assert.throws(() => normalizeGraph(incompatible), /incompatible port types/);

  assert.throws(() => createGraphArea({
    graph: graphValue(),
    selection: { nodeIds: ["node/missing"] },
  }), /Selected.*node is missing/);

  const executable = graphValue();
  executable.nodes[0].metadata = { render() {} };
  assert.throws(() => normalizeGraph(executable), /serializable values/);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  WORK_RECIPE_GRAPH_SCHEMA,
  WorkRecipeProjectionError,
  applyWorkRunOverlay,
  canonicalWorkRecipeJson,
  inspectWorkRecipe,
  normalizeWorkRecipe,
  normalizeWorkRun,
  projectWorkRecipeGraph,
  validateWorkRecipe,
  workRecipeFromGraph,
  workRecipeSemanticSignature,
} from "../src/workflow-graph.js";

const registry = [
  { id: "sequence/validate", kind: "step", version: 1, capabilities: ["sequence.read"], label: "Validate sequence" },
  { id: "character/validate-bindings", kind: "step", version: 2, capabilities: ["character.read"] },
  { id: "preview/render", kind: "step", version: 3, capabilities: ["preview.render"] },
  { id: "sequence/package", kind: "step", version: 1, capabilities: ["package.write"] },
  { id: "publication/intent", kind: "step", version: 4, capabilities: ["publication.intent"] },
  { id: "items/list", kind: "pure", version: 1 },
  { id: "items/keep", kind: "pure", version: 1 },
  { id: "items/process", kind: "step", version: 1 },
  { id: "items/summarise", kind: "pure", version: 1 },
  { id: "selection/read", kind: "pure", version: 1 },
  { id: "cleanup/release", kind: "step", version: 1 },
];

const capabilities = [
  "sequence.read",
  "character.read",
  "preview.render",
  "package.write",
  "publication.intent",
];

function publicationRecipe() {
  return {
    schema: "std.work.recipe/0-alpha",
    "recipe/id": "sequence/publish",
    "recipe/version": 1,
    metadata: { title: "Publish a character sequence", layout: { ignored: true } },
    body: {
      op: "chain",
      id: "publish/body",
      children: [
        { op: "step-ref", id: "sequence/validate", uses: "sequence/validate" },
        { op: "step-ref", id: "character/bindings", uses: "character/validate-bindings" },
        {
          op: "all",
          id: "preview/renditions",
          children: [
            { op: "step-ref", id: "preview/mobile", uses: "preview/render", params: { profile: "mobile" } },
            { op: "step-ref", id: "preview/desktop", uses: "preview/render", params: { profile: "desktop" } },
          ],
        },
        { op: "step-ref", id: "package/build", uses: "sequence/package" },
        { op: "step-ref", id: "publication/create-intent", uses: "publication/intent" },
      ],
    },
  };
}

const configured = { registry, capabilities };

test("projects a sequence publication recipe through the typed Hodos graph contract", () => {
  const graph = projectWorkRecipeGraph(publicationRecipe(), configured);
  assert.equal(graph.metadata.schema, WORK_RECIPE_GRAPH_SCHEMA);
  assert.equal(graph.nodes.length, 8);
  assert.equal(graph.connections.length, 7);
  assert.equal(graph.metadata.recipe.rootNodeId, "work:string%3Apublish%2Fbody");
  assert.ok(graph.nodes.every((node) => node.ports.some((port) => port.id === "control:in")));
  assert.ok(graph.connections.every((edge) => edge.type === "std.work/contains"));
  assert.deepEqual(workRecipeFromGraph(graph), normalizeWorkRecipe(publicationRecipe()));
});

test("graph layout edits do not affect recipe semantics or round-trip data", () => {
  const recipe = publicationRecipe();
  const graph = projectWorkRecipeGraph(recipe, configured);
  const moved = {
    ...graph,
    nodes: graph.nodes.map((node, index) => ({ ...node, x: index * 43, y: 900 - index * 17 })),
  };
  const roundTrip = workRecipeFromGraph(moved);
  assert.deepEqual(roundTrip, normalizeWorkRecipe(recipe));
  assert.equal(workRecipeSemanticSignature(roundTrip), workRecipeSemanticSignature(recipe));
  assert.equal(graph.metadata.semanticSignature, workRecipeSemanticSignature(recipe));
});

test("explicit layout is a visual concern and accepts semantic or graph node ids", () => {
  const graph = projectWorkRecipeGraph(publicationRecipe(), {
    ...configured,
    layout: {
      "preview/mobile": { x: 101, y: 202, width: 303, height: 111 },
      "work:string%3Apreview%2Fdesktop": { x: 404, y: 505 },
    },
  });
  const mobile = graph.nodes.find((node) => node.metadata.recipe.id === "preview/mobile");
  const desktop = graph.nodes.find((node) => node.metadata.recipe.id === "preview/desktop");
  assert.deepEqual([mobile.x, mobile.y, mobile.width, mobile.height], [101, 202, 303, 111]);
  assert.deepEqual([desktop.x, desktop.y], [404, 505]);
});

test("validation reports unknown operations, kind mismatches, capabilities and duplicate ids", () => {
  const recipe = publicationRecipe();
  recipe.body.children[0].uses = "items/list";
  recipe.body.children[1].uses = "missing/operation";
  recipe.body.children[2].children[1].id = "preview/mobile";
  const validation = validateWorkRecipe(recipe, { registry, capabilities: [] });
  assert.equal(validation.valid, false);
  assert.deepEqual(
    new Set(validation.errors.map(({ code }) => code)),
    new Set([
      "recipe/operation-kind",
      "recipe/unknown-operation",
      "recipe/duplicate-node-id",
      "recipe/missing-capability",
    ]),
  );
});

test("without a trusted registry the recipe still normalizes but advertises the unchecked boundary", () => {
  const validation = validateWorkRecipe(publicationRecipe());
  assert.equal(validation.valid, true);
  assert.equal(validation.warnings[0].code, "recipe/registry-unavailable");
  assert.equal(inspectWorkRecipe(publicationRecipe()).graph.nodes.length, 8);
});

test("choose, batch and ensure structural relationships round-trip without semantic drift", () => {
  const recipe = {
    schema: "std.work.recipe/0-alpha",
    "recipe/id": "general/compound",
    "recipe/version": 2,
    body: {
      op: "ensure",
      id: "scope",
      work: {
        op: "choose",
        id: "route",
        selector: { op: "pure-ref", id: "route/read", uses: "selection/read" },
        choices: {
          batch: {
            op: "batch",
            id: "batch",
            list: { op: "pure-ref", id: "batch/list", uses: "items/list" },
            filter: { op: "pure-ref", id: "batch/filter", uses: "items/keep" },
            process: { op: "step-ref", id: "batch/process", uses: "items/process" },
            summarise: { op: "pure-ref", id: "batch/summary", uses: "items/summarise" },
          },
          single: { op: "step-ref", id: "single/process", uses: "items/process" },
        },
      },
      cleanup: { op: "step-ref", id: "scope/cleanup", uses: "cleanup/release" },
    },
  };
  const graph = projectWorkRecipeGraph(recipe, { registry });
  const roles = graph.connections.map(({ metadata }) => [metadata.role, metadata.key]);
  assert.ok(roles.some(([role, key]) => role === "choice" && key === "batch"));
  assert.ok(roles.some(([role]) => role === "cleanup"));
  assert.deepEqual(workRecipeFromGraph(graph), normalizeWorkRecipe(recipe));
});

test("run overlays attach checkpoint state without mutating the recipe projection", () => {
  const graph = projectWorkRecipeGraph(publicationRecipe(), configured);
  const before = workRecipeFromGraph(graph);
  const overlay = applyWorkRunOverlay(graph, {
    "run/id": "run-17",
    status: "running",
    nodes: {
      "sequence/validate": {
        status: "completed",
        attempt: 1,
        replayed: true,
        checkpointId: "checkpoint-1",
        receiptStatus: "published",
      },
      "character/bindings": { status: "running", attempt: 2 },
      "missing/from-recipe": { status: "queued" },
    },
    events: [{ sequence: 1, type: "work/started" }],
  });
  assert.equal(overlay.metadata.run.id, "run-17");
  assert.equal(overlay.metadata.run.counts.completed, 1);
  assert.equal(overlay.metadata.run.counts.running, 1);
  assert.deepEqual(overlay.metadata.run.unknownNodeIds, ["missing/from-recipe"]);
  const validate = overlay.nodes.find((node) => node.metadata.recipe.id === "sequence/validate");
  assert.equal(validate.metadata.run.replayed, true);
  assert.equal(validate.metadata.run.checkpointId, "checkpoint-1");
  assert.deepEqual(workRecipeFromGraph(overlay), before);
});

test("work run normalization is bounded and rejects invalid runtime states", () => {
  assert.equal(normalizeWorkRun({ id: "run", status: "waiting", nodes: [] }).schema, "hodos.work-run/0-alpha");
  assert.throws(
    () => normalizeWorkRun({ id: "run", status: "teleporting", nodes: [] }),
    /unsupported value/i,
  );
  assert.throws(
    () => normalizeWorkRun({ id: "run", nodes: [{ id: "a", status: "running", attempt: -1 }] }),
    /non-negative/i,
  );
});

test("canonical recipe JSON is deterministic across map insertion order", () => {
  const first = publicationRecipe();
  const second = publicationRecipe();
  second.metadata = { layout: { ignored: true }, title: "Publish a character sequence" };
  assert.equal(canonicalWorkRecipeJson(first), canonicalWorkRecipeJson(second));
});

test("non-portable values, cycles and malformed graph relationships fail closed", () => {
  const withFunction = publicationRecipe();
  withFunction.metadata.execute = () => null;
  assert.equal(validateWorkRecipe(withFunction).errors[0].code, "recipe/not-portable");

  const cyclic = publicationRecipe();
  cyclic.body.children.push(cyclic.body);
  assert.equal(validateWorkRecipe(cyclic).errors[0].code, "recipe/not-portable");

  const graph = projectWorkRecipeGraph(publicationRecipe(), configured);
  const unreachable = {
    ...graph,
    nodes: [
      ...graph.nodes,
      {
        ...graph.nodes[1],
        id: "work:string%3Aunreachable",
        metadata: {
          ...graph.nodes[1].metadata,
          recipe: { id: "unreachable", op: "step-ref", fields: { uses: "sequence/validate" } },
        },
      },
    ],
  };
  assert.throws(() => workRecipeFromGraph(unreachable), WorkRecipeProjectionError);
});

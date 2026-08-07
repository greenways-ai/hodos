import assert from "node:assert/strict";
import test from "node:test";
import {
  HODOS_DEV_CATALOG_AREA_TYPE,
  HODOS_DEV_CATALOG_COMPONENT_ID,
  createCatalogArea,
} from "../src/index.js";

const toolsets = [{
  id: "values",
  title: "Value tools",
  shortTitle: "Values",
  description: "Build and inspect live values.",
  tools: [{
    id: "defn",
    label: "Function",
    description: "Insert a function template.",
    snippet: "(defn name [x] x)",
  }],
}];

const activities = [{
  id: "values/greeting",
  toolsetId: "values",
  title: "Shape a greeting",
  level: "Beginner",
  summary: "Change a value and evaluate it.",
  instructions: ["Open the activity", "Change the greeting", "Run checks"],
  path: "src/main.hal",
  source: "(def greeting \"hello\")",
  checks: [{ label: "Greeting exists", expr: "greeting", expected: ["hello"] }],
  checkCount: 1,
}];

test("Catalog area projects descriptive tools, activities and run evidence", () => {
  const area = createCatalogArea({
    catalogId: "catalog/playground",
    catalogTitle: "Hara Playground",
    version: "1",
    source: "playground",
    surface: "activity",
    toolsets,
    activities,
    selectedToolsetId: "values",
    selectedActivityId: "values/greeting",
    run: {
      status: "failed",
      message: "One check needs attention",
      checks: [{
        id: "check/1",
        label: "Greeting exists",
        status: "failed",
        actual: "goodbye",
        expected: ["hello", "Hello"],
        error: "Unexpected greeting",
        expr: "greeting",
      }],
    },
    capabilities: {
      selectToolset: true,
      selectActivity: true,
      insertTool: true,
      openActivity: true,
      checkActivity: true,
      resetActivity: true,
    },
  });
  const component = area["area/component"];
  const model = component["component/model"];

  assert.equal(area["area/type"], HODOS_DEV_CATALOG_AREA_TYPE);
  assert.equal(component["component/id"], HODOS_DEV_CATALOG_COMPONENT_ID);
  assert.equal(component["component/contract"], "workspace.component/1");
  assert.equal(model.selection.toolsetId, "values");
  assert.equal(model.selection.activityId, "values/greeting");
  assert.deepEqual(model.run.counts, { total: 1, pending: 0, passed: 0, failed: 1 });
  assert.deepEqual(model.counts, { toolsets: 1, tools: 1, activities: 1 });
  assert.equal(Object.hasOwn(model.toolsets[0].tools[0], "snippet"), false);
  assert.equal(Object.hasOwn(model.activities[0], "source"), false);
  assert.equal(Object.hasOwn(model.activities[0], "checks"), false);
  assert.equal(Object.hasOwn(model.run.checks[0], "expr"), false);
  assert.equal(JSON.parse(JSON.stringify(area))["area/id"], "catalog/main");
});

test("Catalog area validates identities, surfaces, references and run states", () => {
  assert.throws(() => createCatalogArea({ surface: "lesson" }), /Unsupported.*surface/);
  assert.throws(() => createCatalogArea({ toolsets: [{ ...toolsets[0], tools: [toolsets[0].tools[0], toolsets[0].tools[0]] }] }), /Duplicate.*tool id/);
  assert.throws(() => createCatalogArea({ toolsets, activities: [{ ...activities[0], toolsetId: "missing" }] }), /missing toolset/);
  assert.throws(() => createCatalogArea({ toolsets, activities, selectedToolsetId: "missing" }), /selected toolset is not present/);
  assert.throws(() => createCatalogArea({ toolsets, activities, selectedActivityId: "missing" }), /selected activity is not present/);
  assert.throws(() => createCatalogArea({
    toolsets: [...toolsets, { ...toolsets[0], id: "interfaces", tools: [] }],
    activities,
    selectedToolsetId: "interfaces",
    selectedActivityId: "values/greeting",
  }), /does not belong/);
  assert.throws(() => createCatalogArea({ toolsets, activities, selectedToolsetId: "values", selectedToolId: "missing" }), /selected tool is not present/);
  assert.throws(() => createCatalogArea({ run: { status: "complete" } }), /Unsupported.*run status/);
  assert.throws(() => createCatalogArea({ run: { checks: [{ label: "x", status: "unknown" }] } }), /unsupported status/);
  assert.throws(() => createCatalogArea({ capabilities: { insertTool: "yes" } }), /capability insertTool must be boolean/);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  HODOS_DEV_EXPLORER_AREA_TYPE,
  HODOS_DEV_EXPLORER_COMPONENT_ID,
  createExplorerArea,
} from "../src/index.js";

const entries = [
  { path: "src", kind: "directory" },
  { path: "src/app", kind: "directory" },
  { path: "src/app/main.hal", kind: "file", language: "hara", size: 82 },
  { path: "project.edn", kind: "file", status: "modified" },
];

test("Explorer area projects workspace identity, entries, selection and capabilities", () => {
  const area = createExplorerArea({
    workspaceId: "workspace/local",
    workspaceTitle: "Local project",
    source: "browser",
    revision: "rev-4",
    entries,
    selectedPath: "src/app/main.hal",
    expandedPaths: ["src", "src/app"],
    query: "main",
    capabilities: {
      createFile: true,
      createDirectory: true,
      rename: true,
      delete: true,
      refresh: true,
    },
    metadata: { persistent: true },
  });
  const component = area["area/component"];
  const model = component["component/model"];

  assert.equal(area["area/type"], HODOS_DEV_EXPLORER_AREA_TYPE);
  assert.equal(component["component/id"], HODOS_DEV_EXPLORER_COMPONENT_ID);
  assert.equal(component["component/contract"], "workspace.component/0-alpha");
  assert.equal(model.workspace.id, "workspace/local");
  assert.equal(model.selection.path, "src/app/main.hal");
  assert.deepEqual(model.expanded, ["src", "src/app"]);
  assert.deepEqual(model.counts, { total: 4, files: 2, directories: 2, changed: 1 });
  assert.equal(model.capabilities.delete, true);
  assert.equal(JSON.parse(JSON.stringify(area))["area/id"], "explorer/main");
});

test("Explorer area validates canonical paths, identity and directory expansion", () => {
  assert.throws(() => createExplorerArea({ entries: [{ path: "/src/main.hal", kind: "file" }] }), /canonical relative/);
  assert.throws(() => createExplorerArea({ entries: [{ path: "src/../main.hal", kind: "file" }] }), /parent segments/);
  assert.throws(() => createExplorerArea({ entries: [{ path: "src\\main.hal", kind: "file" }] }), /canonical relative/);
  assert.throws(() => createExplorerArea({ entries: [
    { path: "src", kind: "directory" },
    { path: "src", kind: "file" },
  ] }), /Duplicate.*path/);
  assert.throws(() => createExplorerArea({ entries, selectedPath: "missing.hal" }), /selected path is not present/);
  assert.throws(() => createExplorerArea({ entries, expandedPaths: ["project.edn"] }), /not a directory/);
  assert.throws(() => createExplorerArea({ entries, capabilities: { delete: "yes" } }), /capability delete must be boolean/);
  assert.throws(() => createExplorerArea({ entries: [{ path: "src", kind: "device" }] }), /unsupported kind/);
});

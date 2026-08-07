import assert from "node:assert/strict";
import test from "node:test";
import {
  HODOS_DEV_EDITOR_AREA_TYPE,
  HODOS_DEV_EDITOR_COMPONENT_ID,
  createEditorArea,
} from "../src/index.js";

test("Editor area is a serializable HAL-shaped Workspace value", () => {
  const area = createEditorArea({
    id: "editor/source",
    documentId: "document/main",
    path: "src/main.hal",
    source: "(ns app.core)",
    version: 3,
    namespace: "app.core",
    selection: { start: 4, end: 8 },
    diagnostics: [{ severity: "warning", message: "Example" }],
    settings: { paredit: true, rainbow: true },
  });
  const component = area["area/component"];
  assert.equal(area["area/type"], HODOS_DEV_EDITOR_AREA_TYPE);
  assert.equal(component["component/id"], HODOS_DEV_EDITOR_COMPONENT_ID);
  assert.equal(component["component/contract"], "workspace.component/1");
  assert.equal(component["component/model"].document.path, "src/main.hal");
  assert.deepEqual(component["component/model"].selection, { start: 4, end: 8 });
  assert.equal(JSON.parse(JSON.stringify(area))["area/id"], "editor/source");
});

test("Editor area rejects invalid source, version and selection models", () => {
  assert.throws(() => createEditorArea({ source: null }), /source must be a string/);
  assert.throws(() => createEditorArea({ version: -1 }), /version must be a non-negative integer/);
  assert.throws(() => createEditorArea({ selection: { start: 8, end: 4 } }), /selection/);
});

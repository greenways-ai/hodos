import assert from "node:assert/strict";
import test from "node:test";
import {
  HODOS_DEV_PREVIEW_AREA_TYPE,
  HODOS_DEV_PREVIEW_COMPONENT_ID,
  createPreviewArea,
} from "../src/index.js";

test("Preview area is a serializable HAL-shaped Workspace value", () => {
  const area = createPreviewArea({
    id: "preview/catalog",
    output: { type: "render", tree: ["main", "Ready"] },
    theme: "dark",
    viewport: { id: "phone", width: 390, height: 844 },
  });
  assert.equal(area["area/type"], HODOS_DEV_PREVIEW_AREA_TYPE);
  assert.equal(area["area/component"]["component/id"], HODOS_DEV_PREVIEW_COMPONENT_ID);
  assert.deepEqual(area["area/component"]["component/model"].viewport, {
    id: "phone",
    width: 390,
    height: 844,
  });
  assert.equal(JSON.parse(JSON.stringify(area))["area/id"], "preview/catalog");
});

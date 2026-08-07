import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeWorkspaceDescriptor,
  workspaceLayoutAreaIds,
} from "../src/index.js";

const descriptor = () => ({
  "workspace/id": ":workspace/demo",
  "workspace/revision": 4,
  "workspace/layout": {
    "layout/type": ":split",
    "layout/id": "layout/main",
    "layout/direction": ":horizontal",
    "layout/ratio": 0.25,
    "layout/first": { "layout/type": ":area", "layout/area": "area/files" },
    "layout/second": {
      "layout/type": ":split",
      "layout/direction": ":horizontal",
      "layout/ratio": 0.66,
      "layout/first": { "layout/type": ":area", "layout/area": "area/editor" },
      "layout/second": { "layout/type": ":area", "layout/area": "area/output" },
    },
  },
  "workspace/areas": [
    {
      "area/id": "area/files",
      "area/type": ":project",
      "area/title": "Project",
      "area/presentation": {
        "presentation/label": "Files",
        "presentation/icon": ":folder",
        "presentation/role": ":navigation",
      },
    },
    {
      "area/id": "area/editor",
      "area/type": ":code-editor",
      "area/title": "Code",
      "area/component": {
        "component/id": "hodos.dev/editor",
        "component/model": { source: "(+ 1 2)" },
      },
    },
    {
      "area/id": "area/output",
      "area/type": ":output",
      "area/title": "Output",
    },
  ],
  "workspace/selection": { "area/id": "area/editor", "surface/id": "code" },
  "workspace/customizations": {
    "responsive/breakpoint": 900,
    "responsive/default-surface": "code",
    "responsive/surfaces": [
      { "surface/id": "files", "surface/area": "area/files", "surface/label": "Files" },
      { "surface/id": "code", "surface/area": "area/editor", "surface/label": "Code" },
      {
        "surface/id": "preview",
        "surface/area": "area/output",
        "surface/label": "Preview",
        "surface/mode": "preview",
      },
      {
        "surface/id": "repl",
        "surface/area": "area/output",
        "surface/label": "REPL",
        "surface/mode": "repl",
        "surface/auto-focus": true,
      },
    ],
  },
});

test("Workspace shell normalizes recursive layout and responsive surfaces", () => {
  const workspace = normalizeWorkspaceDescriptor(descriptor());
  assert.equal(workspace.id, "workspace/demo");
  assert.equal(workspace.revision, 4);
  assert.equal(workspace.layout.id, "layout/main");
  assert.equal(workspace.layout.direction, "horizontal");
  assert.deepEqual(workspaceLayoutAreaIds(workspace.layout), [
    "area/files",
    "area/editor",
    "area/output",
  ]);
  assert.equal(workspace.areas[0].component, null);
  assert.equal(workspace.areas[0].presentation.role, "navigation");
  assert.equal(workspace.areas[1].component.id, "hodos.dev/editor");
  assert.equal(workspace.selection.areaId, "area/editor");
  assert.equal(workspace.selection.surfaceId, "code");
  assert.equal(workspace.responsive.breakpoint, 900);
  assert.deepEqual(
    workspace.responsive.surfaces.map(({ id, areaId, mode, autoFocus }) => ({
      id,
      areaId,
      mode,
      autoFocus,
    })),
    [
      { id: "files", areaId: "area/files", mode: null, autoFocus: false },
      { id: "code", areaId: "area/editor", mode: null, autoFocus: false },
      { id: "preview", areaId: "area/output", mode: "preview", autoFocus: false },
      { id: "repl", areaId: "area/output", mode: "repl", autoFocus: true },
    ],
  );
});

test("Workspace shell derives compact surfaces from area presentation", () => {
  const value = descriptor();
  value["workspace/selection"] = { "area/id": "area/files" };
  value["workspace/customizations"] = { "responsive/breakpoint": 720 };
  value["workspace/areas"][0]["area/presentation"]["presentation/order"] = 10;
  value["workspace/areas"][1]["area/presentation"] = {
    "presentation/label": "Editor",
    "presentation/surface": "code",
    "presentation/order": 1,
  };
  value["workspace/areas"][2]["area/presentation"] = {
    "presentation/compact": false,
  };
  const workspace = normalizeWorkspaceDescriptor(value);
  assert.deepEqual(workspace.responsive.surfaces.map((surface) => surface.id), ["code", "area/files"]);
  assert.equal(workspace.responsive.defaultSurfaceId, "code");
});

test("Workspace shell rejects malformed identities and layout references", () => {
  const duplicateArea = descriptor();
  duplicateArea["workspace/areas"].push({ ...duplicateArea["workspace/areas"][0] });
  assert.throws(() => normalizeWorkspaceDescriptor(duplicateArea), /Duplicate.*area id/);

  const missingArea = descriptor();
  missingArea["workspace/layout"]["layout/first"]["layout/area"] = "area/missing";
  assert.throws(() => normalizeWorkspaceDescriptor(missingArea), /references missing area/);

  const duplicateLayout = descriptor();
  duplicateLayout["workspace/layout"]["layout/second"]["layout/second"]["layout/area"] = "area/editor";
  assert.throws(() => normalizeWorkspaceDescriptor(duplicateLayout), /must not reference an area more than once/);

  const badRatio = descriptor();
  badRatio["workspace/layout"]["layout/ratio"] = 1;
  assert.throws(() => normalizeWorkspaceDescriptor(badRatio), /between 0 and 1/);

  const duplicateSurface = descriptor();
  duplicateSurface["workspace/customizations"]["responsive/surfaces"].push({
    "surface/id": "code",
    "surface/area": "area/editor",
  });
  assert.throws(() => normalizeWorkspaceDescriptor(duplicateSurface), /Duplicate.*surface id/);

  const unknownSelection = descriptor();
  unknownSelection["workspace/selection"]["area/id"] = "area/missing";
  assert.throws(() => normalizeWorkspaceDescriptor(unknownSelection), /selected area is missing/);
});

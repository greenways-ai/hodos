import assert from "node:assert/strict";
import test from "node:test";
import {
  HODOS_2D_DOCUMENT_AREA_TYPE,
  HODOS_2D_DOCUMENT_COMPONENT_ID,
  HODOS_2D_DOCUMENT_PROFILE,
  createDocumentArea,
  normalizeRichDocument,
} from "../src/index.js";

const documentValue = () => ({
  profile: HODOS_2D_DOCUMENT_PROFILE,
  id: "document/main",
  title: "Build notes",
  revision: 7,
  metadata: { author: "user/1", signedRoot: "sha256:abc" },
  children: [
    {
      id: "block/title",
      type: "heading",
      attrs: { level: 1 },
      children: [{ id: "text/title", type: "text", text: "Live document" }],
    },
    {
      id: "block/artefact",
      type: "hara-artefact",
      attrs: {
        artefactId: "artefact/chart",
        kind: "chart",
        title: "Retention",
        mode: "live",
        entry: "app.chart/view",
        capabilities: ["inspect", "refresh", "inspect"],
        snapshotRoot: "sha256:value",
        snapshotDisplay: "{:series [1 2 3]}",
        metadata: { timelineEvent: "event/42" },
      },
      children: [{ id: "text/source", type: "text", text: "(chart/view series)" }],
    },
  ],
});

test("Document area projects stable rich-document and Hara artefact identity", () => {
  const area = createDocumentArea({
    id: "document/workspace",
    title: "Notes",
    document: documentValue(),
    selection: {
      nodeId: "block/artefact",
      anchor: { textId: "text/source", offset: 2 },
      focus: { textId: "text/source", offset: 8 },
    },
    capabilities: {
      select: true,
      editText: true,
      activateArtefact: true,
      commitArtefact: true,
    },
  });
  const component = area["area/component"];
  const model = component["component/model"];
  const artefact = model.document.children[1];

  assert.equal(area["area/type"], HODOS_2D_DOCUMENT_AREA_TYPE);
  assert.equal(component["component/id"], HODOS_2D_DOCUMENT_COMPONENT_ID);
  assert.equal(component["component/contract"], "workspace.component/1");
  assert.equal(model.document.profile, HODOS_2D_DOCUMENT_PROFILE);
  assert.equal(model.selection.nodeId, "block/artefact");
  assert.equal(model.capabilities.activateArtefact, true);
  assert.equal(artefact.attrs.artefactId, "artefact/chart");
  assert.deepEqual(artefact.attrs.capabilities, ["inspect", "refresh"]);
  assert.equal(artefact.children[0].text, "(chart/view series)");
  assert.equal(JSON.parse(JSON.stringify(area))["area/id"], "document/workspace");
});

test("Document normalization rejects malformed and executable values", () => {
  const duplicate = documentValue();
  duplicate.children[1].id = "block/title";
  assert.throws(() => normalizeRichDocument(duplicate), /Duplicate.*node id/);

  const unsupported = documentValue();
  unsupported.children[0].type = "script";
  assert.throws(() => normalizeRichDocument(unsupported), /unsupported type/);

  const missingSource = documentValue();
  missingSource.children[1].children = [];
  assert.throws(() => normalizeRichDocument(missingSource), /at least one child/);

  const executable = documentValue();
  executable.children[1].attrs.metadata = { onClick() {} };
  assert.throws(() => normalizeRichDocument(executable), /serializable values/);

  const badProfile = documentValue();
  badProfile.profile = "greenways.rich-text/2";
  assert.throws(() => normalizeRichDocument(badProfile), /unsupported profile/);
});

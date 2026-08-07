import assert from "node:assert/strict";
import test from "node:test";
import {
  HODOS_2D_DOCUMENT_PROFILE,
} from "../src/index.js";
import {
  LEGACY_HARA_DOCUMENT_PROFILE,
  createLegacyHaraDocumentArea,
  projectLegacyHaraDocument,
} from "../src/compat/hara-document.js";

const legacyDocument = () => ({
  profile: LEGACY_HARA_DOCUMENT_PROFILE,
  id: "document/legacy",
  title: "Legacy Hara document",
  revision: 4,
  metadata: { source: "hara-ui" },
  children: [{
    id: "block/heading",
    type: "heading",
    attrs: { level: 2 },
    children: [{ id: "text/heading", type: "text", text: "Hello" }],
  }, {
    id: "block/artefact",
    type: "hara-artefact",
    attrs: {
      artefactId: "artefact/value",
      kind: "value",
      title: "Live value",
      mode: "snapshot",
      capabilities: ["studio/eval"],
      snapshotRoot: "sha256:value",
      snapshotDisplay: "42",
    },
    children: [{ id: "text/source", type: "text", text: "(* 6 7)" }],
  }],
});

test("legacy Hara documents project into the Hodos rich-document profile", () => {
  const input = legacyDocument();
  const projected = projectLegacyHaraDocument(input);

  assert.equal(input.profile, LEGACY_HARA_DOCUMENT_PROFILE);
  assert.equal(projected.profile, HODOS_2D_DOCUMENT_PROFILE);
  assert.equal(projected.id, input.id);
  assert.equal(projected.revision, 4);
  assert.equal(projected.children[1].attrs.snapshotDisplay, "42");
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.isFrozen(projected.children), true);
});

test("legacy Hara documents mount through the ordinary Hodos Document area", () => {
  const area = createLegacyHaraDocumentArea({
    id: "document/compatibility",
    document: legacyDocument(),
    capabilities: { select: true, activateArtefact: true },
  });

  assert.equal(area["area/type"], "hodos.2d/document");
  assert.equal(area["area/component"]["component/id"], "hodos.2d/document");
  assert.equal(
    area["area/component"]["component/model"].document.profile,
    HODOS_2D_DOCUMENT_PROFILE,
  );
});

test("legacy projection fails closed for unrelated profiles", () => {
  assert.throws(
    () => projectLegacyHaraDocument({ ...legacyDocument(), profile: "other.document/1" }),
    /unsupported profile/,
  );
});

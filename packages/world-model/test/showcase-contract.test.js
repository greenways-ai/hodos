import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseEDNString } from "edn-data";
import {
  normalizeAdvancedEditor,
  normalizeAuthoringDocument,
  transformSelectionItems,
} from "../src/world-authoring-model.js";

const parse = (source) => parseEDNString(source, {
  mapAs: "object",
  setAs: "array",
  listAs: "array",
  keywordAs: "string",
  charAs: "string",
  objectKeysAs: "string",
});

const fixture = async (relative) => parse(await readFile(
  new URL(relative, import.meta.url),
  "utf8",
));

test("world-model Showcase transaction is derived from the published state", async () => {
  const state = await fixture("../showcase/states/authoring-normalized.edn");
  const document = normalizeAuthoringDocument(state.document);
  const editor = normalizeAdvancedEditor(state.editor);
  const items = transformSelectionItems(document, editor, {
    tool: "translate",
    axes: [0],
    amount: 1,
  });
  assert.deepEqual(
    items.map(({ id, transform }) => [id, transform.position]),
    [["cube-a", [1, 0, 0]], ["cube-b", [3, 0, 0]]],
  );
  assert.deepEqual(state.selectionPivot, [1, 0, 0]);
  assert.equal(document.prefabs[0].id, "block-pair");
  assert.equal(document.animations[0].tracks[0].entity, "cube-a");
});

test("draft Showcase retains one exact undo boundary", async () => {
  const state = await fixture("../../addon-drafts/showcase/states/reversible-transform.edn");
  assert.equal(state.before.revision, 0);
  assert.equal(state.after.revision, 1);
  assert.equal(state.after.history.undo.length, 1);
  assert.equal(state.restored.revision, 2);
  assert.deepEqual(
    state.restored.entities.map((entity) => entity.transform.position),
    [[0, 0, 0], [2, 0, 0]],
  );
  assert.deepEqual(
    state.effects.map(({ effect, method }) => `${effect}/${method}`),
    ["scene/sync-world-entities", "storage/save-world-draft"],
  );
});

test("publication Showcase accepts only the selected proposal subset", async () => {
  const state = await fixture("../../addon-publication/showcase/states/selected-review.edn");
  assert.equal(state.proposal.baseRevision, state.draft.revision);
  assert.deepEqual(state.review.selected, ["entity:cube-a", "source:source-a"]);
  assert.deepEqual(state.accepted.excluded, ["source:source-b"]);
  assert.equal(state.boundary.signed, false);
  assert.equal(state.boundary.submitted, false);
  assert.deepEqual(
    state.publicationIntents.map(({ effect, method }) => `${effect}/${method}`),
    ["publication/repository-patch", "publication/hestia-contribution"],
  );
});

test("authoring Showcase retains prefab, animation and explicit script boundaries", async () => {
  const state = await fixture("../../addon-authoring/showcase/states/complete-session.edn");
  assert.equal(state.document.prefabs[0].id, "pair");
  assert.equal(state.document.animations[0].tracks[0].entity, "cube-a");
  assert.equal(state.document.entities[0].components.script.language, "hara");
  assert.equal(state.scriptRequest.effect, "script");
  assert.equal(state.scriptRequest.method, "evaluate");
  assert.equal(state.boundary.scriptEvaluatedByShowcase, false);
  assert.equal(state.boundary.persistedByShowcase, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createSequence } from "@greenways/hodos-world-model/sequence";
import {
  HODOS_SEQUENCE_AUTHORING_COMPONENT_ID,
  createSequenceAuthoringActivityFactory,
  createSequenceAuthoringController,
  registerHodosSequenceAuthoringUi,
  sequenceAuthoringActivityPlugin,
} from "../src/sequence-authoring-activity.js";

const sequence = () => createSequence({
  id: "activity/test",
  cues: [{ id: "open", start: { at: 0 }, action: { op: "world/emit", event: "open" } }],
});

test("sequence authoring controller owns canonical history and deterministic preview transitions", () => {
  const changes = [];
  const previews = [];
  const controller = createSequenceAuthoringController({
    sequence: sequence(),
    onChange: (change) => changes.push(change),
    onPreview: (preview) => previews.push(preview),
  });
  controller.dispatch({
    type: "sequence/cue-insert",
    cue: { id: "close", start: { after: "open" }, action: { op: "world/emit", event: "close" } },
  });
  assert.deepEqual(controller.state.sequence.cues.map(({ id }) => id), ["open", "close"]);
  controller.dispatch({ type: "history/undo" });
  assert.deepEqual(controller.state.sequence.cues.map(({ id }) => id), ["open"]);
  controller.dispatch({ type: "history/redo" });
  assert.deepEqual(controller.state.sequence.cues.map(({ id }) => id), ["open", "close"]);

  const first = controller.seek(1);
  const second = controller.seek(1);
  assert.deepEqual(first, second);
  assert.equal(changes.length >= 5, true);
  assert.equal(previews.length, 2);
  controller.destroy();
  assert.throws(() => controller.snapshot(), /destroyed/i);
});

test("activity factory preserves the Hodos host lifecycle and component registry boundary", () => {
  const calls = [];
  const factory = createSequenceAuthoringActivityFactory({
    createSequenceAuthoringHost({ model }) {
      calls.push(["create", model.id]);
      return {
        update(next) { calls.push(["update", next.id]); },
        destroy() { calls.push(["destroy"]); },
      };
    },
  });
  const mounted = factory({ root: {}, model: { id: "first" }, services: {}, dispatch() {} });
  mounted.update({ id: "second" });
  mounted.destroy();
  assert.deepEqual(calls, [["create", "first"], ["update", "second"], ["destroy"]]);

  const registry = { register(id, registered) { return { id, registered }; } };
  const registration = registerHodosSequenceAuthoringUi(registry, {});
  assert.equal(registration.id, HODOS_SEQUENCE_AUTHORING_COMPONENT_ID);
  assert.equal(typeof registration.registered, "function");
  assert.equal(sequenceAuthoringActivityPlugin.schema, "hodos.sequence/0-alpha");
});

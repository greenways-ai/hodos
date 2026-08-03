import assert from "node:assert/strict";
import test from "node:test";
import { withStudioHistory } from "../src/studio-history.js";

function fakeElement() {
  return {
    children: [],
    listeners: new Map(),
    disabled: false,
    isContentEditable: false,
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    },
    prepend(...items) {
      this.children.unshift(...items);
    },
    click() {
      this.listeners.get("click")?.({ target: this });
    },
  };
}

test("studio history decorates a surface with Hara-backed controls", () => {
  const app = fakeElement();
  const actions = fakeElement();
  const created = [];
  const document = {
    createElement() {
      const element = fakeElement();
      created.push(element);
      return element;
    },
  };
  const root = {
    ownerDocument: document,
    querySelector(selector) {
      return selector === ".studio-app" ? app : selector === "[data-actions]" ? actions : null;
    },
  };
  const events = [];
  let updated;
  let destroyed = false;
  const factory = withStudioHistory(() => ({
    update(state) { updated = state; },
    destroy() { destroyed = true; },
  }), { HTMLInputElement: class {}, HTMLTextAreaElement: class {} });
  const controller = factory({ root, dispatch: (event) => events.push(event) });

  const [undo, redo] = actions.children;
  assert.equal(undo.textContent, "Undo");
  assert.equal(redo.textContent, "Redo");
  controller.update({ studio: { history: { undo: [{}], redo: [] } } });
  assert.equal(undo.disabled, false);
  assert.equal(redo.disabled, true);
  assert.ok(updated);

  undo.click();
  assert.deepEqual(events.pop(), { "event/type": "studio/history-undo" });
  let prevented = false;
  app.listeners.get("keydown")({
    target: {}, key: "z", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true,
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.deepEqual(events.pop(), { "event/type": "studio/history-redo" });

  controller.destroy();
  assert.equal(destroyed, true);
});

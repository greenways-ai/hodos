import "./world-editor-workspace.css";
import { WorldEditorPanel } from "./world-editor-panel.js";
import { WorldEditorAdvanced } from "./world-editor-advanced.js";
import { editorState } from "@greenways/hodos-world-model/editor";

class MultiSelectionEditorPanel extends WorldEditorPanel {
  constructor(root, options) {
    super(root, options);
    this.advanced = null;
  }

  decorateSelectionControl(control, type, id) {
    control.addEventListener("click", (event) => {
      if (!event.shiftKey && !event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.dispatch({
        "event/type": "world/editor-select",
        target: { type, id },
        mode: event.shiftKey ? "toggle" : "add",
      });
    }, { capture: true });
  }

  entityRow(entity, depth, active) {
    const row = super.entityRow(entity, depth, active);
    const selected = editorState(this.state?.world?.editor).selection
      .some((target) => target.type === "entity" && target.id === entity.id);
    row.dataset.selected = String(selected);
    this.decorateSelectionControl(row.querySelector(".hodos-editor-tree-main"), "entity", entity.id);
    return row;
  }

  audioRow(source, active) {
    const row = super.audioRow(source, active);
    const selected = editorState(this.state?.world?.editor).selection
      .some((target) => target.type === "audio" && target.id === source.id);
    row.dataset.selected = String(selected);
    this.decorateSelectionControl(row.querySelector(".hodos-editor-tree-main"), "audio", source.id);
    return row;
  }

  duplicateActive() {
    const selection = editorState(this.state?.world?.editor).selection;
    if (selection.length > 1 && this.advanced) return this.advanced.duplicateSelection();
    return super.duplicateActive();
  }

  deleteActive() {
    const selection = editorState(this.state?.world?.editor).selection;
    if (selection.length > 1 && this.advanced) return this.advanced.deleteSelection();
    return super.deleteActive();
  }
}

export class WorldEditorWorkspace {
  constructor(root, options = {}) {
    this.base = new MultiSelectionEditorPanel(root, options);
    this.advanced = new WorldEditorAdvanced(root, options);
    this.base.advanced = this.advanced;
  }

  update(state) {
    this.base.update(state);
    this.advanced.update(state);
  }

  destroy() {
    this.advanced.destroy();
    this.base.destroy();
  }
}

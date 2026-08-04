import { WorldEditorPanel } from "./world-editor-panel.js";
import { WorldEditorAdvanced } from "./world-editor-advanced.js";

export class WorldEditorWorkspace {
  constructor(root, options = {}) {
    this.base = new WorldEditorPanel(root, options);
    this.advanced = new WorldEditorAdvanced(root, options);
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

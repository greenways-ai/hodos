import { defineAddon, HODOS_CORE_ADDON_ID } from "@greenways/hodos-core";
import * as authoring from "./world-authoring-model.js";
import * as character from "./character-model.js";
import * as drafts from "./world-draft-model.js";
import * as drag from "./world-drag.js";
import * as editor from "./world-editor-model.js";
import * as rigging from "./rigging-model.js";
import * as sequence from "./sequence.js";

export * from "./character-model.js";
export * from "./rigging-model.js";
export * from "./sequence.js";
export * from "./world-authoring-model.js";
export * from "./world-draft-model.js";
export * from "./world-drag.js";
export * from "./world-editor-model.js";

export const HODOS_WORLD_MODEL_ADDON_ID = "@greenways/hodos-world-model";

export const hodosWorldModelAddon = defineAddon({
  manifest: {
    id: HODOS_WORLD_MODEL_ADDON_ID,
    version: "0.1.0",
    requires: { [HODOS_CORE_ADDON_ID]: "^0.1.0" },
    capabilities: [],
  },
  activate(context) {
    context.contribute("world.model", "authoring", Object.freeze({
      authoring: Object.freeze({ ...authoring }),
      character: Object.freeze({ ...character }),
      drafts: Object.freeze({ ...drafts }),
      drag: Object.freeze({ ...drag }),
      editor: Object.freeze({ ...editor }),
      rigging: Object.freeze({ ...rigging }),
      sequence: Object.freeze({ ...sequence }),
    }));
  },
});

export default hodosWorldModelAddon;

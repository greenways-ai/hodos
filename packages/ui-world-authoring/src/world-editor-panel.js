import "./world-editor-panel.css";
import {
  activeWorldItem,
  createWorldEntity,
  duplicateWorldEntity,
  editorState,
  flattenWorldHierarchy,
  normalizeWorldEntity,
  patchWorldEntity,
  WORLD_EDITOR_TOOLS,
  WORLD_ENTITY_KINDS,
} from "@greenways/hodos-world-model/editor";

const TOOL_LABELS = Object.freeze({
  select: "Select",
  translate: "Move",
  rotate: "Rotate",
  scale: "Scale",
});

const KIND_LABELS = Object.freeze({
  empty: "Empty",
  box: "Cube",
  sphere: "Sphere",
  plane: "Plane",
  cylinder: "Cylinder",
  cone: "Cone",
  capsule: "Capsule",
  "point-light": "Point Light",
});

function element(document, tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}

function button(document, label, action, className = "") {
  const node = element(document, "button", className, label);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

function randomId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

function editableTarget(target) {
  if (!target) return false;
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target.isContentEditable;
}

function numericInput(document, label, value, step = 0.1) {
  const input = document.createElement("input");
  input.type = "number";
  input.step = String(step);
  input.value = String(Number(value || 0));
  input.setAttribute("aria-label", label);
  return input;
}

function checkbox(document, label, checked) {
  const wrapper = element(document, "label", "hodos-editor-checkbox");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(checked);
  wrapper.append(input, document.createTextNode(label));
  return { wrapper, input };
}

function vectorField(document, title, values, { step = 0.1, onCommit } = {}) {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "hodos-editor-vector";
  const legend = document.createElement("legend");
  legend.textContent = title;
  const inputs = ["X", "Y", "Z"].map((axis, index) => numericInput(
    document,
    `${title} ${axis}`,
    values[index],
    step,
  ));
  const apply = button(document, "Apply", () => {
    const next = inputs.map((input) => Number(input.value));
    if (next.every(Number.isFinite)) onCommit?.(next);
  });
  const row = element(document, "div");
  row.append(...inputs, apply);
  fieldset.append(legend, row);
  return fieldset;
}

export class WorldEditorPanel {
  constructor(root, { dispatch, getRenderer } = {}) {
    if (!root) throw new Error("WorldEditorPanel requires a root element");
    if (typeof dispatch !== "function") throw new Error("WorldEditorPanel requires dispatch");
    this.root = root;
    this.dispatch = dispatch;
    this.getRenderer = getRenderer || (() => null);
    this.state = null;
    this.destroyed = false;
    this.abort = new AbortController();
    this.renderShell();
    this.installKeyboard();
  }

  renderShell() {
    const document = this.root.ownerDocument ?? globalThis.document;
    this.root.className = "hodos-world-editor";
    this.root.innerHTML = `
      <header class="hodos-editor-toolbar">
        <div class="hodos-editor-brand"><span>HODOS</span><strong>World Editor</strong></div>
        <button type="button" data-editor-mode>Edit mode</button>
        <div class="hodos-editor-tools" data-editor-tools></div>
        <div class="hodos-editor-add"><select aria-label="Object type" data-editor-kind></select><button type="button" data-editor-add>Add</button></div>
        <div class="hodos-editor-actions" data-editor-actions></div>
      </header>
      <aside class="hodos-editor-outliner">
        <header><span>SCENE</span><strong>Outliner</strong><input type="search" placeholder="Filter objects" aria-label="Filter scene objects" data-editor-filter></header>
        <div class="hodos-editor-tree" data-editor-tree></div>
      </aside>
      <aside class="hodos-editor-inspector">
        <header><span>PROPERTIES</span><strong data-editor-inspector-title>World</strong></header>
        <div class="hodos-editor-properties" data-editor-properties></div>
      </aside>
      <footer class="hodos-editor-status"><span data-editor-status></span><span>Q Select · W Move · E Rotate · R Scale · Tab Preview · Shift-D Duplicate · F Frame</span></footer>`;

    this.mode = this.root.querySelector("[data-editor-mode]");
    this.tools = this.root.querySelector("[data-editor-tools]");
    this.kind = this.root.querySelector("[data-editor-kind]");
    this.tree = this.root.querySelector("[data-editor-tree]");
    this.properties = this.root.querySelector("[data-editor-properties]");
    this.inspectorTitle = this.root.querySelector("[data-editor-inspector-title]");
    this.status = this.root.querySelector("[data-editor-status]");
    this.filter = this.root.querySelector("[data-editor-filter]");

    for (const kind of WORLD_ENTITY_KINDS) {
      const option = document.createElement("option");
      option.value = kind;
      option.textContent = KIND_LABELS[kind] || kind;
      this.kind.append(option);
    }
    for (const tool of WORLD_EDITOR_TOOLS) {
      const control = button(document, TOOL_LABELS[tool], () => this.dispatch({
        "event/type": "world/editor-tool",
        tool,
      }));
      control.dataset.tool = tool;
      this.tools.append(control);
    }

    const actions = this.root.querySelector("[data-editor-actions]");
    this.undo = button(document, "Undo", () => this.dispatch({ "event/type": "world/history-undo" }));
    this.redo = button(document, "Redo", () => this.dispatch({ "event/type": "world/history-redo" }));
    this.duplicate = button(document, "Duplicate", () => this.duplicateActive());
    this.remove = button(document, "Delete", () => this.deleteActive());
    this.frame = button(document, "Frame", () => this.getRenderer()?.focusEditorSelection?.());
    this.export = button(document, "Export", () => this.dispatch({ "event/type": "world/draft-export" }));
    actions.append(this.undo, this.redo, this.duplicate, this.remove, this.frame, this.export);

    this.root.querySelector("[data-editor-add]").addEventListener("click", () => this.addEntity());
    this.mode.addEventListener("click", () => {
      const editor = editorState(this.state?.world?.editor);
      this.dispatch({
        "event/type": "world/editor-mode",
        mode: editor.mode === "edit" ? "preview" : "edit",
      });
    });
    this.filter.addEventListener("input", () => this.renderOutliner());
  }

  installKeyboard() {
    const document = this.root.ownerDocument ?? globalThis.document;
    document.addEventListener("keydown", (event) => {
      if (this.destroyed || editableTarget(event.target)) return;
      const editor = editorState(this.state?.world?.editor);
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        this.dispatch({ "event/type": event.shiftKey ? "world/history-redo" : "world/history-undo" });
        return;
      }
      if (modifier && event.key.toLowerCase() === "y") {
        event.preventDefault();
        this.dispatch({ "event/type": "world/history-redo" });
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        this.dispatch({
          "event/type": "world/editor-mode",
          mode: editor.mode === "edit" ? "preview" : "edit",
        });
        return;
      }
      if (editor.mode !== "edit") return;
      const shortcuts = { q: "select", w: "translate", e: "rotate", r: "scale" };
      const tool = shortcuts[event.key.toLowerCase()];
      if (tool && !modifier) {
        event.preventDefault();
        this.dispatch({ "event/type": "world/editor-tool", tool });
      } else if ((event.key === "Delete" || event.key === "Backspace") && !modifier) {
        event.preventDefault();
        this.deleteActive();
      } else if (modifier && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        this.duplicateActive();
      } else if (event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        this.duplicateActive();
      } else if (event.key.toLowerCase() === "f" && !modifier) {
        event.preventDefault();
        this.getRenderer()?.focusEditorSelection?.();
      } else if (event.key === "Escape") {
        this.dispatch({ "event/type": "world/editor-select", target: null });
      }
    }, { signal: this.abort.signal });
  }

  spawnPosition() {
    return this.getRenderer()?.editorSpawnPosition?.() ?? [0, 0.5, 0];
  }

  addEntity() {
    const kind = this.kind.value || "box";
    const entity = createWorldEntity(kind, {
      id: randomId(kind === "point-light" ? "light" : "entity"),
      position: this.spawnPosition(),
    });
    this.dispatch({ "event/type": "world/entity-create", entity });
  }

  duplicateActive() {
    const item = activeWorldItem(this.state);
    if (item?.type !== "entity") return;
    const duplicate = duplicateWorldEntity(item.value, randomId("entity"));
    this.dispatch({
      "event/type": "world/entity-duplicate",
      source: item.value.id,
      entity: duplicate,
    });
  }

  deleteActive() {
    const item = activeWorldItem(this.state);
    if (!item) return;
    if (item.type === "audio") {
      this.dispatch({ "event/type": "world/audio-remove", source: item.value.id });
    } else {
      this.dispatch({ "event/type": "world/entity-delete", entity: item.value.id });
    }
  }

  select(type, id) {
    this.dispatch({ "event/type": "world/editor-select", target: { type, id } });
  }

  collection(title, count) {
    const document = this.root.ownerDocument ?? globalThis.document;
    const header = element(document, "div", "hodos-editor-collection");
    header.append(element(document, "strong", "", title), element(document, "span", "", String(count)));
    return header;
  }

  entityRow(entity, depth, active) {
    const document = this.root.ownerDocument ?? globalThis.document;
    const row = element(document, "div", "hodos-editor-tree-row");
    row.dataset.active = String(active);
    row.dataset.locked = String(Boolean(entity.locked));
    row.style.setProperty("--tree-depth", depth);
    const select = button(document, "", () => this.select("entity", entity.id), "hodos-editor-tree-main");
    const icon = element(document, "span", "hodos-editor-kind", entity.kind === "point-light" ? "☀" : entity.kind === "empty" ? "◇" : "◆");
    const copy = element(document, "span");
    copy.append(element(document, "strong", "", entity.name), element(document, "small", "", entity.kind));
    select.append(icon, copy);
    const visible = button(document, entity.visible === false ? "○" : "●", () => {
      this.dispatch({
        "event/type": "world/entity-update",
        entity: patchWorldEntity(entity, { visible: entity.visible === false }),
      });
    }, "hodos-editor-tree-state");
    visible.title = entity.visible === false ? "Show object" : "Hide object";
    const locked = button(document, entity.locked ? "L" : "U", () => {
      this.dispatch({
        "event/type": "world/entity-update",
        entity: patchWorldEntity(entity, { locked: !entity.locked }),
      });
    }, "hodos-editor-tree-state");
    locked.title = entity.locked ? "Unlock object" : "Lock object";
    row.append(select, visible, locked);
    return row;
  }

  audioRow(source, active) {
    const document = this.root.ownerDocument ?? globalThis.document;
    const row = element(document, "div", "hodos-editor-tree-row hodos-editor-tree-row--audio");
    row.dataset.active = String(active);
    const select = button(document, "", () => this.select("audio", source.id), "hodos-editor-tree-main");
    const icon = element(document, "span", "hodos-editor-kind", "♫");
    const copy = element(document, "span");
    copy.append(
      element(document, "strong", "", source.label || source.id),
      element(document, "small", "", source.playing ? "spatial audio · playing" : "spatial audio · paused"),
    );
    select.append(icon, copy);
    const toggle = button(document, source.playing ? "■" : "▶", () => this.dispatch({
      "event/type": "world/audio-toggle",
      source: source.id,
    }), "hodos-editor-tree-state");
    toggle.title = source.playing ? "Pause source" : "Play source";
    row.append(select, toggle);
    return row;
  }

  renderOutliner() {
    if (!this.state) return;
    const document = this.root.ownerDocument ?? globalThis.document;
    const query = this.filter.value.trim().toLowerCase();
    const editor = editorState(this.state.world?.editor);
    const active = editor.active;
    const entities = (this.state.world?.draft?.entities ?? []).map(normalizeWorldEntity);
    const audio = this.state.world?.draft?.audioSources ?? this.state.world?.audioSources ?? [];
    const touchpoints = this.state.world?.touchpoints ?? [];
    const layers = this.state.world?.layers ?? [];
    const children = [];

    children.push(this.collection("Base world", layers.length + touchpoints.length));
    for (const layer of layers) {
      if (query && !String(layer.id).toLowerCase().includes(query)) continue;
      const row = element(document, "div", "hodos-editor-tree-row hodos-editor-tree-row--readonly");
      row.innerHTML = `<span class="hodos-editor-kind">▧</span><span><strong></strong><small>immutable layer</small></span>`;
      row.querySelector("strong").textContent = layer.id;
      children.push(row);
    }
    for (const touchpoint of touchpoints) {
      const text = `${touchpoint.label || touchpoint.id} ${touchpoint.surface}`.toLowerCase();
      if (query && !text.includes(query)) continue;
      const row = element(document, "div", "hodos-editor-tree-row hodos-editor-tree-row--readonly");
      row.innerHTML = `<span class="hodos-editor-kind">◎</span><span><strong></strong><small></small></span>`;
      row.querySelector("strong").textContent = touchpoint.label || touchpoint.id;
      row.querySelector("small").textContent = touchpoint.surface;
      children.push(row);
    }

    const hierarchy = flattenWorldHierarchy(entities).filter(({ entity }) => {
      const text = `${entity.name} ${entity.id} ${entity.kind}`.toLowerCase();
      return !query || text.includes(query);
    });
    children.push(this.collection("Draft objects", entities.length));
    children.push(...hierarchy.map(({ entity, depth }) => this.entityRow(
      entity,
      depth,
      active?.type === "entity" && active.id === entity.id,
    )));

    children.push(this.collection("Spatial audio", audio.length));
    children.push(...audio.filter((source) => {
      const text = `${source.label || source.id} ${source.id}`.toLowerCase();
      return !query || text.includes(query);
    }).map((source) => this.audioRow(
      source,
      active?.type === "audio" && active.id === source.id,
    )));
    this.tree.replaceChildren(...children);
  }

  entityInspector(entity) {
    const document = this.root.ownerDocument ?? globalThis.document;
    const fragment = document.createDocumentFragment();
    const identity = element(document, "section", "hodos-editor-section");
    identity.append(element(document, "h3", "", "Object"));
    const name = document.createElement("input");
    name.type = "text";
    name.value = entity.name;
    name.setAttribute("aria-label", "Object name");
    name.addEventListener("change", () => this.dispatch({
      "event/type": "world/entity-update",
      entity: patchWorldEntity(entity, { name: name.value || entity.id }),
    }));
    const parent = document.createElement("select");
    parent.setAttribute("aria-label", "Object parent");
    const rootOption = document.createElement("option");
    rootOption.value = "";
    rootOption.textContent = "Scene root";
    parent.append(rootOption);
    for (const candidate of this.state.world?.draft?.entities ?? []) {
      if (candidate.id === entity.id) continue;
      const option = document.createElement("option");
      option.value = candidate.id;
      option.textContent = candidate.name || candidate.id;
      option.selected = candidate.id === entity.parent;
      parent.append(option);
    }
    parent.addEventListener("change", () => this.dispatch({
      "event/type": "world/entity-update",
      entity: patchWorldEntity(entity, { parent: parent.value || null }),
    }));
    const flags = element(document, "div", "hodos-editor-flags");
    const visible = checkbox(document, "Visible", entity.visible !== false);
    visible.input.addEventListener("change", () => this.dispatch({
      "event/type": "world/entity-update",
      entity: patchWorldEntity(entity, { visible: visible.input.checked }),
    }));
    const locked = checkbox(document, "Locked", entity.locked);
    locked.input.addEventListener("change", () => this.dispatch({
      "event/type": "world/entity-update",
      entity: patchWorldEntity(entity, { locked: locked.input.checked }),
    }));
    flags.append(visible.wrapper, locked.wrapper);
    identity.append(name, parent, flags);

    const transform = element(document, "section", "hodos-editor-section");
    transform.append(
      element(document, "h3", "", "Transform"),
      vectorField(document, "Location", entity.transform.position, {
        step: 0.1,
        onCommit: (position) => this.dispatch({
          "event/type": "world/entity-transform",
          entity: entity.id,
          transform: { ...entity.transform, position },
        }),
      }),
      vectorField(document, "Rotation", entity.transform.rotation, {
        step: 1,
        onCommit: (rotation) => this.dispatch({
          "event/type": "world/entity-transform",
          entity: entity.id,
          transform: { ...entity.transform, rotation },
        }),
      }),
      vectorField(document, "Scale", entity.transform.scale, {
        step: 0.1,
        onCommit: (scale) => this.dispatch({
          "event/type": "world/entity-transform",
          entity: entity.id,
          transform: { ...entity.transform, scale },
        }),
      }),
    );

    fragment.append(identity, transform);
    if (entity.components.primitive) fragment.append(this.primitiveInspector(entity));
    if (entity.components.light) fragment.append(this.lightInspector(entity));
    return fragment;
  }

  primitiveInspector(entity) {
    const document = this.root.ownerDocument ?? globalThis.document;
    const section = element(document, "section", "hodos-editor-section");
    section.append(element(document, "h3", "", "Primitive"));
    const colorLabel = element(document, "label", "hodos-editor-property", "Color");
    const color = document.createElement("input");
    color.type = "color";
    color.value = entity.components.primitive.color || "#c8ad73";
    color.addEventListener("change", () => this.dispatch({
      "event/type": "world/entity-update",
      entity: patchWorldEntity(entity, {
        components: {
          ...entity.components,
          primitive: { ...entity.components.primitive, color: color.value },
        },
      }),
    }));
    colorLabel.append(color);
    const opacityLabel = element(document, "label", "hodos-editor-property", "Opacity");
    const opacity = document.createElement("input");
    opacity.type = "range";
    opacity.min = "0.1";
    opacity.max = "1";
    opacity.step = "0.05";
    opacity.value = String(entity.components.primitive.opacity ?? 1);
    opacity.addEventListener("change", () => this.dispatch({
      "event/type": "world/entity-update",
      entity: patchWorldEntity(entity, {
        components: {
          ...entity.components,
          primitive: { ...entity.components.primitive, opacity: Number(opacity.value) },
        },
      }),
    }));
    opacityLabel.append(opacity);
    section.append(colorLabel, opacityLabel);
    return section;
  }

  lightInspector(entity) {
    const document = this.root.ownerDocument ?? globalThis.document;
    const light = entity.components.light;
    const section = element(document, "section", "hodos-editor-section");
    section.append(element(document, "h3", "", "Point light"));
    const colorLabel = element(document, "label", "hodos-editor-property", "Color");
    const color = document.createElement("input");
    color.type = "color";
    color.value = light.color || "#fff1ca";
    colorLabel.append(color);
    const intensityLabel = element(document, "label", "hodos-editor-property", "Intensity");
    const intensity = numericInput(document, "Light intensity", light.intensity, 0.1);
    intensityLabel.append(intensity);
    const rangeLabel = element(document, "label", "hodos-editor-property", "Range");
    const range = numericInput(document, "Light range", light.range, 0.5);
    rangeLabel.append(range);
    const shadows = checkbox(document, "Cast shadows", light.castShadows);
    const commit = () => this.dispatch({
      "event/type": "world/entity-update",
      entity: patchWorldEntity(entity, {
        components: {
          ...entity.components,
          light: {
            ...light,
            color: color.value,
            intensity: Number(intensity.value),
            range: Number(range.value),
            castShadows: shadows.input.checked,
          },
        },
      }),
    });
    color.addEventListener("change", commit);
    intensity.addEventListener("change", commit);
    range.addEventListener("change", commit);
    shadows.input.addEventListener("change", commit);
    section.append(colorLabel, intensityLabel, rangeLabel, shadows.wrapper);
    return section;
  }

  audioInspector(source) {
    const document = this.root.ownerDocument ?? globalThis.document;
    const fragment = document.createDocumentFragment();
    const identity = element(document, "section", "hodos-editor-section");
    identity.append(
      element(document, "h3", "", "Spatial audio"),
      element(document, "p", "hodos-editor-readonly", source.kind === "studio/clip" ? `Clip · ${source.clip}` : `Track · ${source.track}`),
    );
    const actions = element(document, "div", "hodos-editor-inline-actions");
    actions.append(
      button(document, source.playing ? "Pause" : "Play", () => this.dispatch({
        "event/type": "world/audio-toggle",
        source: source.id,
      })),
      button(document, "Delete", () => this.dispatch({
        "event/type": "world/audio-remove",
        source: source.id,
      })),
    );
    identity.append(actions);
    const transform = element(document, "section", "hodos-editor-section");
    transform.append(
      element(document, "h3", "", "Transform"),
      vectorField(document, "Location", source.position ?? [0, 0, 0], {
        onCommit: (position) => this.dispatch({
          "event/type": "world/audio-move",
          source: source.id,
          position,
        }),
      }),
    );
    const sound = element(document, "section", "hodos-editor-section");
    sound.append(element(document, "h3", "", "Sound"));
    const gainLabel = element(document, "label", "hodos-editor-property", "Gain dB");
    const gain = numericInput(document, "Spatial gain", source.gainDb, 0.5);
    gain.addEventListener("change", () => this.dispatch({
      "event/type": "world/audio-gain",
      source: source.id,
      gainDb: Number(gain.value),
    }));
    gainLabel.append(gain);
    const rangeLabel = element(document, "label", "hodos-editor-property", "Max range");
    const range = numericInput(document, "Maximum audio distance", source.maxDistance ?? 30, 1);
    range.addEventListener("change", () => this.dispatch({
      "event/type": "world/audio-range",
      source: source.id,
      refDistance: Math.min(source.refDistance ?? 1, Number(range.value)),
      maxDistance: Number(range.value),
      rolloffFactor: source.rolloffFactor ?? 1,
    }));
    rangeLabel.append(range);
    const loop = checkbox(document, "Loop", source.loop !== false);
    loop.input.addEventListener("change", () => this.dispatch({
      "event/type": "world/audio-loop",
      source: source.id,
      loop: loop.input.checked,
    }));
    sound.append(gainLabel, rangeLabel, loop.wrapper);
    fragment.append(identity, transform, sound);
    return fragment;
  }

  renderInspector() {
    const item = activeWorldItem(this.state);
    this.properties.replaceChildren();
    if (!item) {
      const document = this.root.ownerDocument ?? globalThis.document;
      this.inspectorTitle.textContent = "World";
      const summary = element(document, "section", "hodos-editor-section hodos-editor-world-summary");
      const draft = this.state?.world?.draft ?? {};
      summary.append(
        element(document, "h3", "", "Scene document"),
        element(document, "p", "", `${draft.entities?.length ?? 0} draft object(s)`),
        element(document, "p", "", `${draft.audioSources?.length ?? 0} spatial audio source(s)`),
        element(document, "p", "", `Revision ${draft.revision ?? 0}${draft.dirty ? " · saving" : " · saved"}`),
      );
      this.properties.append(summary);
      return;
    }
    this.inspectorTitle.textContent = item.value.name || item.value.label || item.value.id;
    this.properties.append(item.type === "entity"
      ? this.entityInspector(item.value)
      : this.audioInspector(item.value));
  }

  update(state) {
    if (this.destroyed) return;
    this.state = state;
    const editor = editorState(state?.world?.editor ?? state?.world?.draft?.editor);
    const draft = state?.world?.draft ?? { entities: [], audioSources: [], history: {} };
    this.root.dataset.mode = editor.mode;
    this.mode.textContent = editor.mode === "edit" ? "Edit mode" : "Preview mode";
    this.mode.dataset.active = String(editor.mode === "edit");
    for (const control of this.tools.querySelectorAll("[data-tool]")) {
      control.dataset.active = String(control.dataset.tool === editor.tool);
      control.disabled = editor.mode !== "edit";
    }
    const history = draft.history ?? { undo: [], redo: [] };
    this.undo.disabled = !(history.undo?.length);
    this.redo.disabled = !(history.redo?.length);
    const active = activeWorldItem(state);
    this.duplicate.disabled = active?.type !== "entity" || editor.mode !== "edit";
    this.remove.disabled = !active || editor.mode !== "edit";
    this.frame.disabled = !active;
    this.export.disabled = !(draft.entities?.length || draft.audioSources?.length);
    this.status.textContent = `${editor.mode.toUpperCase()} · ${TOOL_LABELS[editor.tool]} · ${draft.entities?.length ?? 0} objects · revision ${draft.revision ?? 0}${draft.dirty ? " · unsaved" : ""}`;
    this.renderOutliner();
    this.renderInspector();
  }

  destroy() {
    this.destroyed = true;
    this.abort.abort();
    this.root.replaceChildren();
  }
}

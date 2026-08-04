import "./world-editor-advanced.css";
import {
  attachScript,
  capturePrefab,
  createCollection,
  DEFAULT_HARA_SCRIPT,
  deleteCollection,
  instantiatePrefab,
  moveSelectionToCollection,
  normalizeAdvancedEditor,
  normalizeAnimation,
  normalizeAsset,
  normalizeAuthoringDocument,
  setAnimationKeyframe,
} from "@greenways/hodos-world-model/authoring";
import {
  activeWorldItem,
  createWorldEntity,
  editorState,
  normalizeWorldEntity,
  selectedWorldItems,
  structuredCloneSafe,
} from "@greenways/hodos-world-model/editor";

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

function numberInput(document, value, step = 0.1, label = "") {
  const input = document.createElement("input");
  input.type = "number";
  input.step = String(step);
  input.value = String(Number(value ?? 0));
  if (label) input.setAttribute("aria-label", label);
  return input;
}

function editableTarget(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target.isContentEditable;
}

function selectedEntities(state) {
  return selectedWorldItems(state).filter((item) => item.type === "entity").map((item) => item.value);
}

export class WorldEditorAdvanced {
  constructor(root, { dispatch, getRenderer } = {}) {
    if (!root) throw new Error("WorldEditorAdvanced requires a root element");
    this.root = root;
    this.dispatch = dispatch;
    this.getRenderer = getRenderer || (() => null);
    this.state = null;
    this.tab = "assets";
    this.abort = new AbortController();
    this.installToolbar();
    this.installDock();
    this.installKeyboard();
  }

  editor() {
    return normalizeAdvancedEditor(this.state?.world?.editor ?? this.state?.world?.draft?.editor);
  }

  document() {
    return normalizeAuthoringDocument(this.state?.world?.draft ?? {});
  }

  commit(document, command) {
    return this.dispatch({
      "event/type": "world/document-commit",
      command,
      document,
    });
  }

  editorPatch(patch) {
    return this.dispatch({
      "event/type": "world/editor-settings",
      patch,
    });
  }

  installToolbar() {
    const document = this.root.ownerDocument ?? globalThis.document;
    const toolbar = this.root.querySelector(".hodos-editor-toolbar");
    const actions = this.root.querySelector(".hodos-editor-actions");
    if (!toolbar || !actions) return;

    const box = toolbar.querySelector('[data-tool="box"]');
    if (box) box.textContent = "Box";

    this.options = element(document, "div", "hodos-editor-options");
    this.space = document.createElement("select");
    this.space.setAttribute("aria-label", "Transform orientation");
    this.space.innerHTML = '<option value="world">World</option><option value="local">Local</option>';
    this.space.addEventListener("change", () => this.editorPatch({ space: this.space.value }));

    this.pivot = document.createElement("select");
    this.pivot.setAttribute("aria-label", "Transform pivot");
    this.pivot.innerHTML = '<option value="median">Median</option><option value="active">Active</option><option value="individual">Individual</option><option value="cursor">3D Cursor</option>';
    this.pivot.addEventListener("change", () => this.editorPatch({ pivot: this.pivot.value }));

    const snapLabel = element(document, "label", "hodos-editor-snap");
    this.snapEnabled = document.createElement("input");
    this.snapEnabled.type = "checkbox";
    this.snapEnabled.addEventListener("change", () => this.commitSnap());
    snapLabel.append(this.snapEnabled, document.createTextNode("Snap"));

    this.translateSnap = numberInput(document, 0.25, 0.05, "Translation snap");
    this.rotateSnap = numberInput(document, 5, 1, "Rotation snap");
    this.scaleSnap = numberInput(document, 0.1, 0.05, "Scale snap");
    for (const input of [this.translateSnap, this.rotateSnap, this.scaleSnap]) {
      input.addEventListener("change", () => this.commitSnap());
    }
    this.options.append(this.space, this.pivot, snapLabel, this.translateSnap, this.rotateSnap, this.scaleSnap);
    actions.before(this.options);

    const multi = element(document, "div", "hodos-editor-multi-actions");
    multi.append(
      button(document, "All", () => this.selectAll()),
      button(document, "To cursor", () => this.moveSelectionToCursor()),
      button(document, "Origin→Cursor", () => this.originToCursor()),
    );
    actions.before(multi);
  }

  commitSnap() {
    const editor = this.editor();
    this.editorPatch({
      snap: {
        ...editor.snap,
        enabled: this.snapEnabled.checked,
        translate: Math.max(0.0001, Number(this.translateSnap.value) || 0.25),
        rotate: Math.max(0.1, Number(this.rotateSnap.value) || 5),
        scale: Math.max(0.001, Number(this.scaleSnap.value) || 0.1),
      },
    });
  }

  installDock() {
    const document = this.root.ownerDocument ?? globalThis.document;
    this.dock = element(document, "section", "hodos-editor-dock");
    this.dock.innerHTML = `
      <header>
        <nav data-advanced-tabs></nav>
        <button type="button" data-dock-collapse>Hide</button>
      </header>
      <div class="hodos-editor-dock-content" data-advanced-content></div>`;
    this.root.append(this.dock);
    this.tabs = this.dock.querySelector("[data-advanced-tabs]");
    this.content = this.dock.querySelector("[data-advanced-content]");
    for (const [id, label] of [
      ["assets", "Assets"],
      ["prefabs", "Prefabs"],
      ["collections", "Collections"],
      ["animation", "Animation"],
      ["scripts", "Hara Scripts"],
    ]) {
      const control = button(document, label, () => {
        this.tab = id;
        this.renderDock();
      });
      control.dataset.tab = id;
      this.tabs.append(control);
    }
    this.dock.querySelector("[data-dock-collapse]").addEventListener("click", (event) => {
      const collapsed = this.dock.dataset.collapsed === "true";
      this.dock.dataset.collapsed = String(!collapsed);
      event.currentTarget.textContent = collapsed ? "Hide" : "Show";
    });
  }

  installKeyboard() {
    const document = this.root.ownerDocument ?? globalThis.document;
    document.addEventListener("keydown", (event) => {
      if (editableTarget(event.target) || this.editor().mode !== "edit") return;
      const modifier = event.metaKey || event.ctrlKey;
      if (event.key.toLowerCase() === "b" && !modifier) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.dispatch({ "event/type": "world/editor-settings", patch: { tool: "box" } });
      } else if (modifier && event.key.toLowerCase() === "a") {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.selectAll();
      } else if (event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.duplicateSelection();
      } else if ((event.key === "Delete" || event.key === "Backspace") && !modifier) {
        const selection = this.editor().selection;
        if (selection.length > 1) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.deleteSelection();
        }
      } else if (event.key === "." && !modifier) {
        event.preventDefault();
        this.getRenderer()?.focusEditorSelection?.();
      }
    }, { capture: true, signal: this.abort.signal });
  }

  selectAll() {
    const document = this.document();
    const targets = [
      ...document.entities.filter((entity) => !entity.locked).map((entity) => ({ type: "entity", id: entity.id })),
      ...document.audioSources.map((source) => ({ type: "audio", id: source.id })),
    ];
    this.dispatch({ "event/type": "world/editor-select", targets, mode: "replace" });
  }

  duplicateSelection() {
    const document = this.document();
    const editor = this.editor();
    const selected = new Set(editor.selection.filter((target) => target.type === "entity").map((target) => target.id));
    if (!selected.size) return;
    const ids = new Map([...selected].map((id) => [id, randomId("entity")]));
    const copies = document.entities.filter((entity) => selected.has(entity.id)).map((entity) => ({
      ...structuredCloneSafe(entity),
      id: ids.get(entity.id),
      name: `${entity.name} Copy`,
      parent: selected.has(entity.parent) ? ids.get(entity.parent) : entity.parent,
      transform: {
        ...entity.transform,
        position: entity.transform.position.map((value, axis) => value + (axis === 0 || axis === 2 ? 0.35 : 0)),
      },
    }));
    this.commit({ ...document, entities: [...document.entities, ...copies] }, "duplicate-selection");
    this.dispatch({
      "event/type": "world/editor-select",
      targets: copies.map((entity) => ({ type: "entity", id: entity.id })),
      mode: "replace",
    });
  }

  deleteSelection() {
    const document = this.document();
    const editor = this.editor();
    const entityIds = new Set(editor.selection.filter((target) => target.type === "entity").map((target) => target.id));
    const sourceIds = new Set(editor.selection.filter((target) => target.type === "audio").map((target) => target.id));
    const entities = document.entities.filter((entity) => !entityIds.has(entity.id)).map((entity) => (
      entityIds.has(entity.parent) ? { ...entity, parent: null } : entity
    ));
    const audioSources = document.audioSources.filter((source) => !sourceIds.has(source.id));
    this.commit({ ...document, entities, audioSources }, "delete-selection");
    this.dispatch({ "event/type": "world/editor-select", targets: [], mode: "replace" });
  }

  moveSelectionToCursor() {
    const editor = this.editor();
    const document = this.document();
    if (!editor.selection.length) return;
    const anchor = editor.active ?? editor.selection.at(-1);
    const activeItem = anchor?.type === "audio"
      ? document.audioSources.find((source) => source.id === anchor.id)
      : document.entities.find((entity) => entity.id === anchor?.id);
    const activePosition = anchor?.type === "audio" ? activeItem?.position : activeItem?.transform?.position;
    if (!activePosition) return;
    const delta = editor.cursor.map((value, axis) => value - activePosition[axis]);
    const items = editor.selection.flatMap((target) => {
      if (target.type === "audio") {
        const source = document.audioSources.find((entry) => entry.id === target.id);
        return source ? [{ type: "audio", id: source.id, position: source.position.map((value, axis) => value + delta[axis]) }] : [];
      }
      const entity = document.entities.find((entry) => entry.id === target.id);
      return entity ? [{
        type: "entity",
        id: entity.id,
        transform: {
          ...entity.transform,
          position: entity.transform.position.map((value, axis) => value + delta[axis]),
        },
      }] : [];
    });
    this.dispatch({ "event/type": "world/editor-transform-selection", items });
  }

  originToCursor() {
    const document = this.document();
    const editor = this.editor();
    const selected = new Set(editor.selection.filter((target) => target.type === "entity").map((target) => target.id));
    if (!selected.size) return;
    const entities = document.entities.map((entity) => selected.has(entity.id)
      ? { ...entity, origin: editor.cursor.map((value, axis) => value - entity.transform.position[axis]) }
      : entity);
    this.commit({ ...document, entities }, "origin-to-cursor");
  }

  renderDock() {
    if (!this.state) return;
    for (const tab of this.tabs.querySelectorAll("button")) tab.dataset.active = String(tab.dataset.tab === this.tab);
    const render = {
      assets: () => this.renderAssets(),
      prefabs: () => this.renderPrefabs(),
      collections: () => this.renderCollections(),
      animation: () => this.renderAnimation(),
      scripts: () => this.renderScripts(),
    }[this.tab];
    this.content.replaceChildren(render());
  }

  renderAssets() {
    const document = this.root.ownerDocument ?? globalThis.document;
    const authoring = this.document();
    const section = element(document, "section", "hodos-asset-browser");
    const builtins = element(document, "div", "hodos-asset-grid");
    for (const [kind, label, icon] of [
      ["box", "Cube", "◇"], ["sphere", "Sphere", "●"], ["plane", "Plane", "▱"],
      ["cylinder", "Cylinder", "▥"], ["cone", "Cone", "△"], ["capsule", "Capsule", "⬭"],
      ["point-light", "Point Light", "☀"], ["camera", "Camera", "▣"], ["trigger", "Trigger", "⬚"],
    ]) {
      const control = button(document, "", () => {
        const entity = createWorldEntity(kind, {
          id: randomId(kind),
          position: this.getRenderer()?.editorSpawnPosition?.() ?? [0, 0.5, 0],
          collection: this.editor().activeCollection,
        });
        this.commit({ ...authoring, entities: [...authoring.entities, entity] }, `add-${kind}`);
        this.dispatch({ "event/type": "world/editor-select", targets: [{ type: "entity", id: entity.id }], mode: "replace" });
      }, "hodos-asset-card");
      control.append(element(document, "span", "", icon), element(document, "strong", "", label));
      builtins.append(control);
    }

    const custom = element(document, "form", "hodos-asset-register");
    custom.innerHTML = '<input name="name" placeholder="Asset name" required><input name="url" type="url" placeholder="https://…/model.glb" required><button type="submit">Register GLB</button>';
    custom.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(custom);
      const asset = normalizeAsset({
        id: randomId("asset"),
        name: data.get("name"),
        kind: "gltf",
        url: data.get("url"),
      });
      this.commit({ ...authoring, assets: [...authoring.assets, asset] }, "register-asset");
      custom.reset();
    });

    const registered = element(document, "div", "hodos-registered-assets");
    for (const asset of authoring.assets) {
      const item = element(document, "article");
      const copy = element(document, "div");
      copy.append(element(document, "strong", "", asset.name), element(document, "small", "", asset.url || asset.kind));
      const add = button(document, "Add", () => {
        const entity = createWorldEntity("asset-instance", {
          id: randomId("asset"),
          name: asset.name,
          position: this.getRenderer()?.editorSpawnPosition?.() ?? [0, 0.5, 0],
          collection: this.editor().activeCollection,
        });
        entity.components.asset = { id: asset.id, url: asset.url, format: "gltf" };
        this.commit({ ...authoring, entities: [...authoring.entities, entity] }, "instantiate-asset");
      });
      item.append(copy, add);
      registered.append(item);
    }
    section.append(builtins, custom, registered);
    return section;
  }

  renderPrefabs() {
    const document = this.root.ownerDocument ?? globalThis.document;
    const authoring = this.document();
    const section = element(document, "section", "hodos-prefab-browser");
    const create = element(document, "form", "hodos-prefab-create");
    create.innerHTML = '<input name="name" placeholder="Prefab name" required><button type="submit">Save selection</button>';
    create.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = String(new FormData(create).get("name") || "Prefab");
      try {
        const prefab = capturePrefab(authoring, this.editor(), { id: randomId("prefab"), name });
        this.commit({ ...authoring, prefabs: [...authoring.prefabs, prefab] }, "create-prefab");
        create.reset();
      } catch (error) {
        create.querySelector("input").setCustomValidity(error.message);
        create.reportValidity();
        create.querySelector("input").setCustomValidity("");
      }
    });
    const list = element(document, "div", "hodos-prefab-list");
    for (const prefab of authoring.prefabs) {
      const item = element(document, "article");
      const copy = element(document, "div");
      copy.append(element(document, "strong", "", prefab.name), element(document, "small", "", `${prefab.entities.length} object(s)`));
      const actions = element(document, "div");
      actions.append(
        button(document, "Instantiate", () => {
          const entities = instantiatePrefab(prefab, {
            position: this.getRenderer()?.editorSpawnPosition?.() ?? [0, 0, 0],
            collection: this.editor().activeCollection,
          });
          this.commit({ ...authoring, entities: [...authoring.entities, ...entities] }, "instantiate-prefab");
          this.dispatch({
            "event/type": "world/editor-select",
            targets: entities.map((entity) => ({ type: "entity", id: entity.id })),
            mode: "replace",
          });
        }),
        button(document, "Delete", () => this.commit({
          ...authoring,
          prefabs: authoring.prefabs.filter((entry) => entry.id !== prefab.id),
        }, "delete-prefab")),
      );
      item.append(copy, actions);
      list.append(item);
    }
    section.append(create, list);
    return section;
  }

  renderCollections() {
    const document = this.root.ownerDocument ?? globalThis.document;
    const authoring = this.document();
    const editor = this.editor();
    const section = element(document, "section", "hodos-collection-browser");
    const create = element(document, "form", "hodos-collection-create");
    create.innerHTML = '<input name="name" placeholder="Collection name" required><button type="submit">New collection</button>';
    create.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = String(new FormData(create).get("name") || "Collection");
      const id = randomId("collection");
      this.commit(createCollection(authoring, { id, name }), "create-collection");
      this.editorPatch({ activeCollection: id });
      create.reset();
    });
    const list = element(document, "div", "hodos-collection-list");
    const rootItem = element(document, "article");
    rootItem.append(
      element(document, "strong", "", "Scene Collection"),
      button(document, "Move selection", () => this.commit(moveSelectionToCollection(authoring, editor, null), "move-to-root")),
      button(document, editor.isolation ? "Show all" : "Isolate root", () => this.editorPatch({ isolation: editor.isolation ? null : "__root__" })),
    );
    list.append(rootItem);
    for (const collection of authoring.collections) {
      const item = element(document, "article");
      item.dataset.active = String(editor.activeCollection === collection.id);
      const copy = element(document, "div");
      copy.append(
        element(document, "strong", "", collection.name),
        element(document, "small", "", `${authoring.entities.filter((entity) => entity.collection === collection.id).length} object(s)`),
      );
      const actions = element(document, "div");
      actions.append(
        button(document, "Active", () => this.editorPatch({ activeCollection: collection.id })),
        button(document, editor.isolation === collection.id ? "Exit isolate" : "Isolate", () => this.editorPatch({
          isolation: editor.isolation === collection.id ? null : collection.id,
        })),
        button(document, "Move selected", () => this.commit(moveSelectionToCollection(authoring, editor, collection.id), "move-to-collection")),
        button(document, "Delete", () => this.commit(deleteCollection(authoring, collection.id), "delete-collection")),
      );
      item.append(copy, actions);
      list.append(item);
    }
    section.append(create, list);
    return section;
  }

  renderAnimation() {
    const document = this.root.ownerDocument ?? globalThis.document;
    const authoring = this.document();
    const editor = this.editor();
    const animation = normalizeAnimation(
      authoring.animations.find((entry) => entry.id === editor.timeline.animation) ?? authoring.animations[0],
    );
    const section = element(document, "section", "hodos-animation-editor");
    const transport = element(document, "header", "hodos-animation-transport");
    const play = button(document, editor.timeline.playing ? "Pause" : "Play", () => this.editorPatch({
      timeline: { ...editor.timeline, playing: !editor.timeline.playing },
    }));
    const stop = button(document, "Stop", () => this.editorPatch({
      timeline: { ...editor.timeline, playing: false, time: 0 },
    }));
    const loop = element(document, "label");
    const loopInput = document.createElement("input");
    loopInput.type = "checkbox";
    loopInput.checked = editor.timeline.loop;
    loopInput.addEventListener("change", () => this.editorPatch({
      timeline: { ...editor.timeline, loop: loopInput.checked },
    }));
    loop.append(loopInput, document.createTextNode(" Loop"));
    const duration = numberInput(document, animation.duration, 0.5, "Animation duration");
    duration.addEventListener("change", () => {
      const next = { ...animation, duration: Math.max(0.1, Number(duration.value) || 10) };
      this.commit({
        ...authoring,
        animations: authoring.animations.map((entry) => entry.id === animation.id ? next : entry),
      }, "animation-duration");
    });
    transport.append(play, stop, loop, element(document, "span", "", "Duration"), duration);

    const scrub = document.createElement("input");
    scrub.type = "range";
    scrub.min = "0";
    scrub.max = String(animation.duration);
    scrub.step = String(1 / animation.fps);
    scrub.value = String(Math.min(animation.duration, editor.timeline.time));
    scrub.addEventListener("input", () => this.editorPatch({
      timeline: { ...editor.timeline, playing: false, time: Number(scrub.value) },
    }));

    const keyActions = element(document, "div", "hodos-animation-key-actions");
    const active = activeWorldItem(this.state);
    for (const property of ["position", "rotation", "scale"]) {
      const control = button(document, `Key ${property}`, () => {
        if (active?.type !== "entity") return;
        const value = structuredCloneSafe(active.value.transform[property]);
        const next = setAnimationKeyframe(animation, {
          entity: active.value.id,
          property,
          time: editor.timeline.time,
          value,
        });
        this.commit({
          ...authoring,
          animations: authoring.animations.map((entry) => entry.id === animation.id ? next : entry),
        }, `keyframe-${property}`);
      });
      control.disabled = active?.type !== "entity";
      keyActions.append(control);
    }

    const tracks = element(document, "div", "hodos-animation-tracks");
    for (const track of animation.tracks) {
      const row = element(document, "article");
      const label = element(document, "div");
      const entity = authoring.entities.find((entry) => entry.id === track.entity);
      label.append(element(document, "strong", "", entity?.name || track.entity), element(document, "small", "", track.property));
      const lane = element(document, "div", "hodos-keyframe-lane");
      for (const keyframe of track.keyframes) {
        const marker = button(document, "◆", () => this.editorPatch({
          timeline: { ...editor.timeline, playing: false, time: keyframe.time },
        }), "hodos-keyframe");
        marker.style.left = `${animation.duration ? keyframe.time / animation.duration * 100 : 0}%`;
        marker.title = `${keyframe.time.toFixed(3)} s`;
        lane.append(marker);
      }
      row.append(label, lane);
      tracks.append(row);
    }
    section.append(transport, scrub, keyActions, tracks);
    return section;
  }

  renderScripts() {
    const document = this.root.ownerDocument ?? globalThis.document;
    const authoring = this.document();
    const active = activeWorldItem(this.state);
    const section = element(document, "section", "hodos-script-editor");
    if (active?.type !== "entity") {
      section.append(element(document, "p", "hodos-script-empty", "Select a draft object to attach and run a live Hara script."));
      return section;
    }
    const entity = normalizeWorldEntity(active.value);
    const script = entity.components.script ?? {
      enabled: true,
      events: ["world/start", "world/entity-transform"],
      source: DEFAULT_HARA_SCRIPT,
    };
    const form = element(document, "div", "hodos-script-form");
    const enabled = element(document, "label");
    const enabledInput = document.createElement("input");
    enabledInput.type = "checkbox";
    enabledInput.checked = script.enabled !== false;
    enabled.append(enabledInput, document.createTextNode(" Enabled"));
    const events = document.createElement("input");
    events.type = "text";
    events.value = (script.events ?? []).join(", ");
    events.placeholder = "world/start, world/entity-transform";
    const source = document.createElement("textarea");
    source.spellcheck = false;
    source.value = script.source || DEFAULT_HARA_SCRIPT;
    const actions = element(document, "div");
    actions.append(
      button(document, "Attach / update", () => {
        const updated = attachScript(entity, {
          source: source.value,
          events: events.value.split(",").map((entry) => entry.trim()).filter(Boolean),
          enabled: enabledInput.checked,
        });
        this.commit({
          ...authoring,
          entities: authoring.entities.map((entry) => entry.id === entity.id ? updated : entry),
        }, "attach-hara-script");
      }),
      button(document, "Run now", () => this.dispatch({
        "event/type": "world/script-run",
        entity: entity.id,
        event: { "event/type": "world/editor-run", source: "script-panel" },
        trace: randomId("trace"),
      })),
      button(document, "Clear trace", () => this.dispatch({ "event/type": "world/script-clear-traces" })),
    );
    form.append(enabled, events, source, actions);

    const traces = element(document, "div", "hodos-script-traces");
    const values = this.state?.world?.scripting?.traces ?? [];
    for (const trace of values.slice().reverse().slice(0, 40)) {
      const item = element(document, "article");
      item.dataset.status = trace.status;
      item.append(
        element(document, "strong", "", `${trace.status || "completed"} · ${trace.entity || "world"}`),
        element(document, "small", "", trace.event?.["event/type"] || "event"),
      );
      const pre = element(document, "pre");
      pre.textContent = trace.error || JSON.stringify(trace.result, null, 2);
      item.append(pre);
      traces.append(item);
    }
    section.append(form, traces);
    return section;
  }

  update(state) {
    this.state = state;
    const editor = this.editor();
    this.space.value = editor.space;
    this.pivot.value = editor.pivot;
    this.snapEnabled.checked = editor.snap.enabled;
    this.translateSnap.value = String(editor.snap.translate);
    this.rotateSnap.value = String(editor.snap.rotate);
    this.scaleSnap.value = String(editor.snap.scale);
    this.root.dataset.advancedDock = "true";
    this.renderDock();
  }

  destroy() {
    this.abort.abort();
    this.dock?.remove();
    this.options?.remove();
  }
}

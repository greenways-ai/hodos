import "./world-draft-panel.css";
import {
  nudgePosition,
  sourcePosition,
  WORLD_DRAFT_NUDGE_STEP,
} from "./world-draft-model.js";

function button(document, label, action, className = "") {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  if (className) element.className = className;
  element.addEventListener("click", action);
  return element;
}

function numberInput(document, label, value) {
  const input = document.createElement("input");
  input.type = "number";
  input.step = String(WORLD_DRAFT_NUDGE_STEP);
  input.value = String(value);
  input.setAttribute("aria-label", label);
  return input;
}

export class WorldDraftPanel {
  constructor(root, { dispatch, getRenderer } = {}) {
    if (!root) throw new Error("WorldDraftPanel requires a root element");
    if (typeof dispatch !== "function") throw new Error("WorldDraftPanel requires dispatch");
    this.root = root;
    this.dispatch = dispatch;
    this.getRenderer = getRenderer || (() => null);
    this.selected = null;
    this.placementCleanup = null;
    this.destroyed = false;
    this.renderShell();
  }

  renderShell() {
    const document = this.root.ownerDocument ?? globalThis.document;
    this.root.className = "hodos-world-draft";
    this.root.innerHTML = "";

    const header = document.createElement("header");
    const identity = document.createElement("div");
    const eyebrow = document.createElement("span");
    eyebrow.textContent = "HARA WORLD DRAFT";
    const title = document.createElement("strong");
    title.textContent = "Spatial audio";
    identity.append(eyebrow, title);
    const collapse = button(document, "Hide", () => {
      const collapsed = this.root.dataset.collapsed === "true";
      this.root.dataset.collapsed = String(!collapsed);
      collapse.textContent = collapsed ? "Hide" : "Show";
    }, "hodos-world-draft-collapse");
    header.append(identity, collapse);

    const toolbar = document.createElement("div");
    toolbar.className = "hodos-world-draft-toolbar";
    this.undo = button(document, "Undo", () => this.dispatch({ "event/type": "world/history-undo" }));
    this.redo = button(document, "Redo", () => this.dispatch({ "event/type": "world/history-redo" }));
    this.export = button(document, "Export", () => this.dispatch({ "event/type": "world/draft-export" }));
    this.status = document.createElement("span");
    this.status.className = "hodos-world-draft-status";
    toolbar.append(this.undo, this.redo, this.export, this.status);

    this.list = document.createElement("div");
    this.list.className = "hodos-world-draft-list";
    this.root.append(header, toolbar, this.list);
  }

  cancelPlacement() {
    this.placementCleanup?.();
    this.placementCleanup = null;
    delete this.root.dataset.placing;
  }

  beginPlacement(source) {
    this.cancelPlacement();
    const renderer = this.getRenderer();
    const canvas = renderer?.canvas;
    if (!renderer?.worldPointAt || !canvas) return;
    this.root.dataset.placing = "true";
    this.status.textContent = `Click the world to place ${source.label || source.id}. Escape cancels.`;

    const document = canvas.ownerDocument ?? globalThis.document;
    const finish = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const position = renderer.worldPointAt(event.clientX, event.clientY);
      this.cancelPlacement();
      this.dispatch({ "event/type": "world/audio-move", source: source.id, position });
    };
    const keydown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.cancelPlacement();
      this.status.textContent = "Placement cancelled.";
    };
    const cleanup = () => {
      canvas.removeEventListener("pointerdown", finish, true);
      document?.removeEventListener("keydown", keydown, true);
    };
    this.placementCleanup = cleanup;
    canvas.addEventListener("pointerdown", finish, { capture: true });
    document?.addEventListener("keydown", keydown, { capture: true });
  }

  dispatchPosition(source, position) {
    this.dispatch({ "event/type": "world/audio-move", source: source.id, position });
  }

  sourceEditor(source) {
    const document = this.root.ownerDocument ?? globalThis.document;
    const details = document.createElement("details");
    details.className = "hodos-world-source-editor";
    details.open = this.selected === source.id;
    details.addEventListener("toggle", () => {
      if (details.open) this.selected = source.id;
      else if (this.selected === source.id) this.selected = null;
    });

    const summary = document.createElement("summary");
    const name = document.createElement("strong");
    name.textContent = source.label || source.id;
    const meta = document.createElement("span");
    meta.textContent = `${source.kind === "studio/clip" ? "Clip" : "Track"} · ${source.playing ? "playing" : "paused"}`;
    summary.append(name, meta);

    const body = document.createElement("div");
    body.className = "hodos-world-source-body";
    const actions = document.createElement("div");
    actions.className = "hodos-world-source-actions";
    actions.append(
      button(document, source.playing ? "Pause" : "Play", () => this.dispatch({
        "event/type": "world/audio-toggle", source: source.id,
      })),
      button(document, "Place", () => this.beginPlacement(source), "hodos-world-source-primary"),
      button(document, "Remove", () => this.dispatch({
        "event/type": "world/audio-remove", source: source.id,
      })),
    );

    const position = sourcePosition(source);
    const positionField = document.createElement("fieldset");
    const positionLegend = document.createElement("legend");
    positionLegend.textContent = "Transform";
    const coordinates = document.createElement("div");
    coordinates.className = "hodos-world-coordinates";
    const inputs = position.map((value, index) => numberInput(document, ["X", "Y", "Z"][index], value));
    const apply = button(document, "Apply", () => {
      const next = inputs.map((input) => Number(input.value));
      if (next.every(Number.isFinite)) this.dispatchPosition(source, next);
    });
    coordinates.append(...inputs, apply);

    const nudges = document.createElement("div");
    nudges.className = "hodos-world-nudges";
    for (const [axis, label] of ["X", "Y", "Z"].entries()) {
      nudges.append(
        button(document, `${label}−`, () => this.dispatchPosition(source, nudgePosition(position, axis, -WORLD_DRAFT_NUDGE_STEP))),
        button(document, `${label}+`, () => this.dispatchPosition(source, nudgePosition(position, axis, WORLD_DRAFT_NUDGE_STEP))),
      );
    }
    positionField.append(positionLegend, coordinates, nudges);

    const acoustic = document.createElement("fieldset");
    const acousticLegend = document.createElement("legend");
    acousticLegend.textContent = "Spatial sound";
    const gainLabel = document.createElement("label");
    gainLabel.textContent = "Gain";
    const gainValue = document.createElement("output");
    const gain = document.createElement("input");
    gain.type = "range";
    gain.min = "-24";
    gain.max = "12";
    gain.step = "0.5";
    gain.value = String(Number(source.gainDb || 0));
    gainValue.textContent = `${gain.value} dB`;
    gain.addEventListener("input", () => { gainValue.textContent = `${gain.value} dB`; });
    gain.addEventListener("change", () => this.dispatch({
      "event/type": "world/audio-gain", source: source.id, gainDb: Number(gain.value),
    }));
    gainLabel.append(gain, gainValue);

    const rangeLabel = document.createElement("label");
    rangeLabel.textContent = "Range";
    const rangeValue = document.createElement("output");
    const range = document.createElement("input");
    range.type = "range";
    range.min = "2";
    range.max = "250";
    range.step = "1";
    range.value = String(Number(source.maxDistance || 30));
    rangeValue.textContent = `${range.value} m`;
    range.addEventListener("input", () => { rangeValue.textContent = `${range.value} m`; });
    range.addEventListener("change", () => this.dispatch({
      "event/type": "world/audio-range",
      source: source.id,
      refDistance: Math.min(Number(source.refDistance || 1), Number(range.value)),
      maxDistance: Number(range.value),
      rolloffFactor: Number(source.rolloffFactor || 1),
    }));
    rangeLabel.append(range, rangeValue);

    const loopLabel = document.createElement("label");
    loopLabel.className = "hodos-world-loop";
    const loop = document.createElement("input");
    loop.type = "checkbox";
    loop.checked = source.loop !== false;
    loop.addEventListener("change", () => this.dispatch({
      "event/type": "world/audio-loop", source: source.id, loop: loop.checked,
    }));
    loopLabel.append(loop, document.createTextNode(" Loop source"));
    acoustic.append(acousticLegend, gainLabel, rangeLabel, loopLabel);

    body.append(actions, positionField, acoustic);
    details.append(summary, body);
    return details;
  }

  update(state) {
    if (this.destroyed) return;
    const draft = state?.world?.draft ?? {
      dirty: false,
      revision: 0,
      audioSources: state?.world?.audioSources ?? [],
      history: { undo: [], redo: [] },
    };
    const sources = draft.audioSources ?? [];
    const history = draft.history ?? { undo: [], redo: [] };
    this.undo.disabled = !(history.undo?.length);
    this.redo.disabled = !(history.redo?.length);
    this.export.disabled = sources.length === 0;
    this.status.textContent = draft.dirty
      ? `Unsaved draft · revision ${draft.revision}`
      : `Saved locally · revision ${draft.revision}`;
    if (this.selected && !sources.some((source) => source.id === this.selected)) this.selected = null;
    this.list.replaceChildren();
    if (!sources.length) {
      const empty = (this.root.ownerDocument ?? globalThis.document).createElement("p");
      empty.className = "hodos-world-draft-empty";
      empty.textContent = "Drag a Studio track or clip into the world to begin a spatial draft.";
      this.list.append(empty);
      return;
    }
    this.list.append(...sources.map((source) => this.sourceEditor(source)));
  }

  destroy() {
    this.destroyed = true;
    this.cancelPlacement();
    this.root.replaceChildren();
  }
}

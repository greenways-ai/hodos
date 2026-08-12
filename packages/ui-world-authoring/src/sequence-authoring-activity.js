import {
  SEQUENCE_AUTHORING_SCHEMA,
  applySequenceAuthoringCommand,
  applySequenceAuthoringPreviewEvent,
  normalizeSequenceAuthoringState,
  openSequenceAuthoring,
  openSequenceAuthoringPreview,
  seekSequenceAuthoringPreview,
  sequenceAuthoringSnapshot,
  tickSequenceAuthoringPreview,
} from "@greenways/hodos-world-model/sequence-authoring";

export const HODOS_SEQUENCE_AUTHORING_COMPONENT_ID = "hodos.sequence/authoring";
export const HODOS_SEQUENCE_AUTHORING_ACTIVITY_ID = "hodos.activity/sequence-timeline";
export const HODOS_SEQUENCE_AUTHORING_EVENTS = Object.freeze([
  "sequence/authoring-change",
  "sequence/selection-change",
  "sequence/preview-effects",
  "sequence/preview-events",
  "sequence/diagnostics",
]);

const stateModel = (model) => (
  model && typeof model === "object" && !Array.isArray(model) && Object.hasOwn(model, "state")
    ? model.state
    : model
);

function sequenceFromModel(model) {
  const value = stateModel(model);
  if (value?.schema === SEQUENCE_AUTHORING_SCHEMA) return { state: value };
  if (value?.sequence?.schema === "hodos.sequence/0-alpha") {
    return {
      sequence: value.sequence,
      characters: value.characters,
      operations: value.operations,
      bindings: value.bindings,
    };
  }
  return { sequence: value };
}

function dispatchEvent(dispatch, type, detail) {
  if (typeof dispatch !== "function") return;
  if (dispatch.length >= 2) dispatch(type, detail);
  else dispatch({ type, ...detail });
}

export function createSequenceAuthoringController({
  sequence,
  state,
  characters = {},
  operations,
  bindings = {},
  onChange,
  onPreview,
} = {}) {
  let authoring = state?.schema === SEQUENCE_AUTHORING_SCHEMA
    ? normalizeSequenceAuthoringState(state)
    : openSequenceAuthoring(sequence, { characters, operations });
  let preview = null;
  let currentBindings = bindings;
  let destroyed = false;

  const ensureActive = () => {
    if (destroyed) throw new Error("Sequence authoring controller has been destroyed");
  };
  const snapshot = () => sequenceAuthoringSnapshot(authoring);
  const changed = (command = null) => {
    const value = snapshot();
    onChange?.({ state: authoring, snapshot: value, command });
    return value;
  };
  const previewed = (result, mode) => {
    preview = result;
    onPreview?.({ mode, result, state: authoring, snapshot: snapshot() });
    return result;
  };

  return {
    get state() {
      return authoring;
    },
    get preview() {
      return preview;
    },
    snapshot() {
      ensureActive();
      return snapshot();
    },
    dispatch(command) {
      ensureActive();
      authoring = applySequenceAuthoringCommand(authoring, command);
      preview = null;
      return changed(command);
    },
    openPreview(nextBindings = currentBindings) {
      ensureActive();
      currentBindings = nextBindings ?? {};
      return previewed(openSequenceAuthoringPreview(authoring, currentBindings), "open");
    },
    seek(logicalTime, nextBindings = currentBindings) {
      ensureActive();
      currentBindings = nextBindings ?? {};
      authoring = applySequenceAuthoringCommand(authoring, { type: "timeline/seek", time: logicalTime });
      changed({ type: "timeline/seek", time: logicalTime });
      return previewed(seekSequenceAuthoringPreview(authoring, logicalTime, currentBindings), "seek");
    },
    tick(logicalTime) {
      ensureActive();
      if (!preview) preview = openSequenceAuthoringPreview(authoring, currentBindings);
      return previewed(tickSequenceAuthoringPreview(preview.state, logicalTime), "tick");
    },
    applyEvent(event) {
      ensureActive();
      if (!preview) preview = openSequenceAuthoringPreview(authoring, currentBindings);
      return previewed(applySequenceAuthoringPreviewEvent(preview.state, event), "event");
    },
    update(model) {
      ensureActive();
      const next = sequenceFromModel(model);
      if (next.state) authoring = normalizeSequenceAuthoringState(next.state);
      else {
        authoring = openSequenceAuthoring(next.sequence, {
          characters: next.characters ?? characters,
          operations: next.operations ?? operations,
        });
        currentBindings = next.bindings ?? currentBindings;
      }
      preview = null;
      return changed({ type: "sequence/replace-model" });
    },
    destroy() {
      destroyed = true;
      preview = null;
    },
  };
}

function element(document, tag, attributes = {}, text = null) {
  const node = document.createElement(tag);
  Object.entries(attributes).forEach(([name, value]) => {
    if (name === "className") node.className = value;
    else if (name === "disabled") node.disabled = Boolean(value);
    else if (name.startsWith("data-")) node.setAttribute(name, String(value));
    else node[name] = value;
  });
  if (text !== null) node.textContent = text;
  return node;
}

function nextCueId(sequence) {
  const ids = new Set(sequence.cues.map(({ id }) => id));
  let index = sequence.cues.length + 1;
  while (ids.has(`cue-${index}`)) index += 1;
  return `cue-${index}`;
}

function cueLabel(cue) {
  return `${cue.id} · ${cue.operation}`;
}

function renderDefaultHost(root, controller, dispatch) {
  const document = root?.ownerDocument ?? globalThis.document;
  if (!document || typeof root?.replaceChildren !== "function") return;
  const snapshot = controller.snapshot();
  const selected = snapshot.selection[0]
    ? snapshot.sequence.cues.find(({ id }) => id === snapshot.selection[0])
    : null;

  const shell = element(document, "section", {
    className: "hodos-sequence-authoring",
    "data-hodos-component": HODOS_SEQUENCE_AUTHORING_COMPONENT_ID,
  });
  const header = element(document, "header", { className: "hodos-sequence-authoring__header" });
  header.append(
    element(document, "div", { className: "hodos-sequence-authoring__title" }, snapshot.sequence.name ?? snapshot.sequence.id),
  );
  const toolbar = element(document, "div", { className: "hodos-sequence-authoring__toolbar" });
  const undo = element(document, "button", { type: "button", disabled: !snapshot.canUndo }, "Undo");
  undo.addEventListener("click", () => {
    controller.dispatch({ type: "history/undo" });
    renderDefaultHost(root, controller, dispatch);
  });
  const redo = element(document, "button", { type: "button", disabled: !snapshot.canRedo }, "Redo");
  redo.addEventListener("click", () => {
    controller.dispatch({ type: "history/redo" });
    renderDefaultHost(root, controller, dispatch);
  });
  const addCue = element(document, "button", { type: "button" }, "Add cue");
  addCue.addEventListener("click", () => {
    const id = nextCueId(controller.state.sequence);
    controller.dispatch({
      type: "sequence/cue-insert",
      label: `Add ${id}`,
      cue: {
        id,
        start: { at: controller.state.cursor },
        action: { op: "world/emit", event: id },
        metadata: { duration: 0.5 },
      },
    });
    controller.dispatch({ type: "selection/set", cueIds: [id] });
    renderDefaultHost(root, controller, dispatch);
  });
  toolbar.append(undo, redo, addCue);
  header.append(toolbar);
  shell.append(header);

  const transport = element(document, "div", { className: "hodos-sequence-authoring__transport" });
  const time = element(document, "input", {
    type: "number",
    min: 0,
    step: 0.1,
    value: String(snapshot.cursor),
    ariaLabel: "Timeline time",
  });
  const seek = element(document, "button", { type: "button" }, "Preview");
  seek.addEventListener("click", () => {
    const result = controller.seek(Math.max(0, Number(time.value) || 0));
    dispatchEvent(dispatch, "sequence/preview-effects", { effects: result.effects, state: result.state });
    dispatchEvent(dispatch, "sequence/preview-events", { events: result.events, state: result.state });
    renderDefaultHost(root, controller, dispatch);
  });
  transport.append(element(document, "span", {}, "Time"), time, seek);
  shell.append(transport);

  const body = element(document, "div", { className: "hodos-sequence-authoring__body" });
  const timeline = element(document, "div", { className: "hodos-sequence-authoring__timeline" });
  for (const track of snapshot.tracks) {
    const row = element(document, "div", {
      className: "hodos-sequence-authoring__track",
      "data-track-kind": track.kind,
      "data-track-id": track.id,
    });
    row.append(element(document, "div", { className: "hodos-sequence-authoring__track-label" }, track.id));
    const lane = element(document, "div", { className: "hodos-sequence-authoring__lane" });
    for (const cue of track.cues) {
      const button = element(document, "button", {
        type: "button",
        className: snapshot.selection.includes(cue.id)
          ? "hodos-sequence-authoring__cue is-selected"
          : "hodos-sequence-authoring__cue",
        title: JSON.stringify(cue.startCondition),
        "data-cue-id": cue.id,
      }, cueLabel(cue));
      button.style.marginInlineStart = `${Math.max(0, cue.start) * 12}px`;
      button.addEventListener("click", () => {
        controller.dispatch({ type: "selection/set", cueIds: [cue.id] });
        dispatchEvent(dispatch, "sequence/selection-change", { cueIds: [cue.id] });
        renderDefaultHost(root, controller, dispatch);
      });
      lane.append(button);
    }
    row.append(lane);
    timeline.append(row);
  }
  body.append(timeline);

  const inspector = element(document, "aside", { className: "hodos-sequence-authoring__inspector" });
  if (selected) {
    inspector.append(
      element(document, "h3", {}, selected.id),
      element(document, "p", {}, selected.action.op),
      element(document, "pre", {}, JSON.stringify(selected, null, 2)),
    );
    const remove = element(document, "button", { type: "button" }, "Delete cue");
    remove.addEventListener("click", () => {
      controller.dispatch({ type: "sequence/cue-delete", cueId: selected.id, cascade: true });
      renderDefaultHost(root, controller, dispatch);
    });
    inspector.append(remove);
  } else inspector.append(element(document, "p", {}, "Select a cue to inspect it."));
  body.append(inspector);
  shell.append(body);

  const diagnostics = element(document, "footer", { className: "hodos-sequence-authoring__diagnostics" });
  const allDiagnostics = [...snapshot.diagnostics.errors, ...snapshot.diagnostics.warnings];
  diagnostics.append(element(document, "strong", {}, `${allDiagnostics.length} diagnostics`));
  for (const diagnostic of allDiagnostics) {
    diagnostics.append(element(document, "div", {
      className: `hodos-sequence-authoring__diagnostic is-${diagnostic.severity}`,
    }, `${diagnostic.code}: ${diagnostic.message}`));
  }
  shell.append(diagnostics);
  root.replaceChildren(shell);
  dispatchEvent(dispatch, "sequence/diagnostics", { diagnostics: snapshot.diagnostics });
}

export function createDefaultSequenceAuthoringHost({ root, model, dispatch }) {
  const parsed = sequenceFromModel(model);
  const controller = createSequenceAuthoringController({
    ...parsed,
    onChange({ state, snapshot, command }) {
      dispatchEvent(dispatch, "sequence/authoring-change", {
        state,
        sequence: snapshot.sequence,
        revision: snapshot.revision,
        command,
      });
    },
    onPreview({ result, mode }) {
      dispatchEvent(dispatch, "sequence/preview-effects", { mode, effects: result.effects, state: result.state });
      dispatchEvent(dispatch, "sequence/preview-events", { mode, events: result.events, state: result.state });
    },
  });
  renderDefaultHost(root, controller, dispatch);
  return {
    controller,
    update(nextModel) {
      controller.update(nextModel);
      renderDefaultHost(root, controller, dispatch);
    },
    destroy() {
      controller.destroy();
      root?.replaceChildren?.();
    },
  };
}

function hostFactory(options, services) {
  return options.createSequenceAuthoringHost
    ?? services?.createSequenceAuthoringHost
    ?? services?.sequenceAuthoring?.createHost
    ?? createDefaultSequenceAuthoringHost;
}

export function createSequenceAuthoringActivityFactory(options = {}) {
  return ({ root, model, services, dispatch, context }) => {
    const createHost = hostFactory(options, services);
    const host = createHost({ root, container: root, model: stateModel(model), services, dispatch, context });
    if (!host || typeof host !== "object") throw new TypeError("Sequence authoring host factory must return an object");
    if (typeof host.update !== "function") throw new TypeError("Sequence authoring host must implement update(model)");
    return {
      update(nextModel) {
        host.update(stateModel(nextModel));
      },
      destroy() {
        if (typeof host.destroy === "function") host.destroy();
        else host.dispose?.();
      },
    };
  };
}

export function registerHodosSequenceAuthoringUi(registry, options = {}) {
  if (!registry || typeof registry.register !== "function") {
    throw new TypeError("Sequence authoring registration requires a Hodos component registry");
  }
  return registry.register(HODOS_SEQUENCE_AUTHORING_COMPONENT_ID, createSequenceAuthoringActivityFactory(options));
}

export const sequenceAuthoringActivityPlugin = Object.freeze({
  id: HODOS_SEQUENCE_AUTHORING_ACTIVITY_ID,
  componentId: HODOS_SEQUENCE_AUTHORING_COMPONENT_ID,
  schema: "hodos.sequence/0-alpha",
  events: HODOS_SEQUENCE_AUTHORING_EVENTS,
  createFactory: createSequenceAuthoringActivityFactory,
  createController: createSequenceAuthoringController,
  createHost: createDefaultSequenceAuthoringHost,
});

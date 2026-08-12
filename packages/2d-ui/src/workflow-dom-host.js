import {
  WORK_RECIPE_GRAPH_SCHEMA,
  applyWorkRunOverlay,
  inspectWorkRecipe,
  normalizeWorkOperationRegistry,
  projectWorkRecipeGraph,
} from "@greenways/hodos-2d/workflow";
import { createGraphDomHost } from "./graph-dom-host.js";

export const HODOS_WORKFLOW_VIEW_SCHEMA = "hodos.workflow-view/0-alpha";
export const HODOS_WORKFLOW_EVENTS = Object.freeze([
  "workflow/select",
  "workflow/move-node",
  "workflow/run",
  "workflow/cancel",
  "workflow/resume",
  "workflow/fork",
  "workflow/command",
]);

const ACTIVE_RUN_STATUSES = new Set(["created", "queued", "running", "waiting"]);
const RESUMABLE_RUN_STATUSES = new Set(["failed", "cancelled"]);

const objectValue = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
};

const stringValue = (value, fallback = "") => value == null ? fallback : String(value);

const clonePortable = (value) => {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const capabilityValue = (value = {}) => {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.freeze({
    select: input.select !== false,
    moveNode: input.moveNode === true,
    run: input.run === true,
    cancel: input.cancel === true,
    resume: input.resume === true,
    fork: input.fork === true,
    command: input.command === true,
  });
};

const graphNodeForSemantic = (graph, value) => {
  if (value == null) return null;
  const direct = graph.nodes.find((node) => node.id === value);
  if (direct) return direct;
  return graph.nodes.find((node) => node.metadata?.recipe?.id === value) ?? null;
};

const selectionValue = (value, graph) => {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : value == null ? {} : { nodeId: value };
  const raw = Array.isArray(input.nodeIds)
    ? input.nodeIds
    : input.nodeId == null ? [] : [input.nodeId];
  const nodeIds = [...new Set(raw.map((id) => graphNodeForSemantic(graph, id)?.id).filter(Boolean))];
  return Object.freeze({ nodeIds: Object.freeze(nodeIds), connectionIds: Object.freeze([]) });
};

const operationPalette = (registryValue) => {
  const registry = normalizeWorkOperationRegistry(registryValue ?? null);
  return Object.freeze(Object.values(registry.operations)
    .map((descriptor) => Object.freeze({
      id: clonePortable(descriptor.id),
      kind: descriptor.kind,
      version: descriptor.version,
      label: descriptor.label,
      capabilities: Object.freeze([...descriptor.capabilities]),
      metadata: clonePortable(descriptor.metadata),
    }))
    .sort((left, right) => left.label.localeCompare(right.label)));
};

const emptyGraph = (recipeValue, validation) => ({
  id: `work-recipe:${stringValue(recipeValue?.["recipe/id"] ?? recipeValue?.recipeId, "invalid")}`,
  revision: 0,
  nodes: [],
  connections: [],
  metadata: {
    schema: WORK_RECIPE_GRAPH_SCHEMA,
    title: "Invalid workflow",
    diagnostics: {
      errors: validation.errors.map((entry) => clonePortable(entry)),
      warnings: validation.warnings.map((entry) => clonePortable(entry)),
    },
  },
});

const selectedInspector = (selected) => {
  if (!selected) return null;
  const recipe = selected.metadata?.recipe ?? {};
  const operation = selected.metadata?.operation ?? null;
  const run = selected.metadata?.run ?? null;
  return Object.freeze({
    graphNodeId: selected.id,
    nodeId: clonePortable(recipe.id),
    op: recipe.op ?? null,
    fields: clonePortable(recipe.fields ?? {}),
    operation: operation == null ? null : clonePortable(operation),
    run: run == null ? null : clonePortable(run),
  });
};

export function projectWorkflowDomView(modelValue) {
  const model = objectValue(modelValue, "Hodos workflow DOM model");
  const capabilities = capabilityValue(model.capabilities);
  const inspected = inspectWorkRecipe(model.recipe, {
    registry: model.registry ?? null,
    capabilities: model.installedCapabilities ?? model.workCapabilities ?? [],
    layout: model.layout ?? {},
    graphId: model.graphId,
    readOnly: model.readOnly === true,
  });
  let graph = inspected.graph ?? emptyGraph(model.recipe, inspected.validation);
  if (inspected.validation.valid && model.run) graph = applyWorkRunOverlay(graph, model.run);
  const selection = selectionValue(model.selection, graph);
  const selected = selection.nodeIds.length
    ? graph.nodes.find((node) => node.id === selection.nodeIds[0]) ?? null
    : null;
  const run = graph.metadata?.run ?? null;
  const runStatus = run?.status ?? null;
  const selectedCheckpoint = selected?.metadata?.run?.checkpointId ?? null;
  const valid = inspected.validation.valid;
  const commands = Object.freeze({
    run: valid && capabilities.run && (!runStatus || !ACTIVE_RUN_STATUSES.has(runStatus)),
    cancel: valid && capabilities.cancel && ACTIVE_RUN_STATUSES.has(runStatus),
    resume: valid && capabilities.resume && RESUMABLE_RUN_STATUSES.has(runStatus),
    fork: valid && capabilities.fork && selectedCheckpoint != null,
    command: valid && capabilities.command,
  });
  const status = model.status
    ?? (!valid ? "error" : runStatus ?? "ready");
  const graphModel = Object.freeze({
    graph,
    selection,
    viewport: clonePortable(model.viewport ?? { x: 0, y: 0, zoom: 1 }),
    status,
    readOnly: model.readOnly === true,
    capabilities: Object.freeze({
      select: capabilities.select,
      moveNode: capabilities.moveNode && model.readOnly !== true,
      connect: false,
      createNode: false,
      delete: false,
      command: false,
    }),
    counts: Object.freeze({ nodes: graph.nodes.length, connections: graph.connections.length }),
    error: valid ? null : inspected.validation.errors.map(({ message }) => message).join("\n"),
  });
  return Object.freeze({
    schema: HODOS_WORKFLOW_VIEW_SCHEMA,
    title: stringValue(model.title, "Flow"),
    recipeId: clonePortable(
      inspected.validation.recipe?.["recipe/id"]
        ?? model.recipe?.["recipe/id"]
        ?? model.recipe?.recipeId
        ?? null,
    ),
    valid,
    status,
    graphModel,
    graph,
    selection,
    selected: selectedInspector(selected),
    palette: operationPalette(model.registry),
    diagnostics: Object.freeze({
      errors: Object.freeze(inspected.validation.errors.map((entry) => clonePortable(entry))),
      warnings: Object.freeze(inspected.validation.warnings.map((entry) => clonePortable(entry))),
    }),
    run: run == null ? null : clonePortable(run),
    commands,
    compact: model.compact === true,
  });
}

export function workflowEventFromGraph(eventValue, viewValue) {
  const event = objectValue(eventValue, "Hodos workflow graph event");
  const view = objectValue(viewValue, "Hodos workflow view");
  const type = event["event/type"] ?? event.type;
  if (type === "graph/select") {
    const selected = (event.nodeIds ?? [])
      .map((id) => view.graph.nodes.find((node) => node.id === id)?.metadata?.recipe?.id)
      .filter((id) => id != null);
    return Object.freeze({
      "event/type": "workflow/select",
      recipeId: clonePortable(view.recipeId),
      nodeId: selected[0] ?? null,
      nodeIds: Object.freeze(selected.map((entry) => clonePortable(entry))),
    });
  }
  if (type === "graph/move-node") {
    const node = view.graph.nodes.find((candidate) => candidate.id === event.nodeId);
    if (!node) return null;
    return Object.freeze({
      "event/type": "workflow/move-node",
      recipeId: clonePortable(view.recipeId),
      nodeId: clonePortable(node.metadata?.recipe?.id),
      graphNodeId: node.id,
      x: Number(event.x),
      y: Number(event.y),
    });
  }
  if (type === "graph/command") {
    return Object.freeze({
      "event/type": "workflow/command",
      recipeId: clonePortable(view.recipeId),
      command: event.command,
      detail: clonePortable(event),
    });
  }
  return null;
}

const domDocument = (container) => {
  const document = container?.ownerDocument ?? globalThis.document;
  if (!document || typeof document.createElement !== "function") {
    throw new Error("Hodos workflow DOM host requires a DOM Document");
  }
  return document;
};

const className = (node, value) => {
  node.className = value;
  return node;
};

const textElement = (document, tag, text, classValue = null) => {
  const node = document.createElement(tag);
  node.textContent = stringValue(text);
  if (classValue) node.className = classValue;
  return node;
};

const addListener = (target, type, listener, controller) => {
  try {
    target.addEventListener(type, listener, { signal: controller.signal });
  } catch {
    target.addEventListener(type, listener);
    controller.signal.addEventListener("abort", () => target.removeEventListener(type, listener), { once: true });
  }
};

const actionButton = (document, label, enabled, action, controller) => {
  const button = className(document.createElement("button"), "hodos-workflow-action");
  button.type = "button";
  button.textContent = label;
  button.disabled = !enabled;
  addListener(button, "click", () => {
    if (!button.disabled) action();
  }, controller);
  return button;
};

const appendField = (document, target, label, value) => {
  const row = className(document.createElement("div"), "hodos-workflow-field");
  row.append(textElement(document, "dt", label), textElement(document, "dd", value));
  target.append(row);
};

export function createWorkflowDomHost({
  container,
  dispatch = () => {},
  services = {},
  reportError = null,
  createGraphHost = createGraphDomHost,
} = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Hodos workflow DOM host requires a container element");
  }
  if (typeof createGraphHost !== "function") {
    throw new TypeError("Hodos workflow DOM host requires createGraphHost");
  }
  const document = domDocument(container);
  const errorReporter = reportError ?? services?.workflow?.reportError ?? services?.reportError ?? (() => {});
  let controller = new AbortController();
  let graphHost = null;
  let view = null;
  let disposed = false;

  const report = (error) => {
    try { errorReporter(error); } catch { /* reporting is best effort */ }
  };
  const send = (event) => {
    try {
      const result = dispatch(event);
      if (result && typeof result.then === "function") result.catch(report);
    } catch (error) {
      report(error);
    }
  };
  const command = (type, detail = {}) => send(Object.freeze({
    "event/type": type,
    recipeId: clonePortable(view.recipeId),
    runId: view.run?.id ?? null,
    ...detail,
  }));

  const renderInspector = (inspector) => {
    const panel = className(document.createElement("aside"), "hodos-workflow-inspector");
    panel.append(textElement(document, "h2", inspector ? String(inspector.nodeId) : "Workflow inspector"));
    if (!inspector) {
      panel.append(textElement(document, "p", "Select a workflow node to inspect its operation, policy and run evidence."));
      return panel;
    }
    const fields = document.createElement("dl");
    appendField(document, fields, "Operation", inspector.op ?? "—");
    appendField(document, fields, "Installed operation", inspector.operation?.id ?? inspector.fields?.uses ?? "—");
    appendField(document, fields, "Version", inspector.operation?.version ?? "—");
    appendField(document, fields, "Run status", inspector.run?.status ?? "Not started");
    appendField(document, fields, "Attempt", inspector.run?.attempt ?? 0);
    appendField(document, fields, "Checkpoint", inspector.run?.checkpointId ?? "—");
    panel.append(fields);
    const value = textElement(document, "pre", JSON.stringify(inspector.fields ?? {}, null, 2), "hodos-workflow-value");
    panel.append(value);
    return panel;
  };

  const render = (model) => {
    if (disposed) throw new Error("Hodos workflow DOM host has been disposed");
    view = projectWorkflowDomView(model);
    controller.abort();
    controller = new AbortController();
    graphHost?.dispose?.();
    graphHost?.destroy?.();

    container.classList?.add("hodos-workflow-host");
    container.dataset.hodosComponent = "hodos.flow/workflow";
    container.dataset.workflowStatus = view.status;

    const shell = className(document.createElement("section"), `hodos-workflow${view.compact ? " compact" : ""}`);
    const toolbar = className(document.createElement("header"), "hodos-workflow-toolbar");
    const identity = document.createElement("div");
    identity.append(
      textElement(document, "strong", view.title),
      textElement(document, "span", `${stringValue(view.recipeId, "invalid")} · ${view.status}`),
    );
    const actions = className(document.createElement("nav"), "hodos-workflow-actions");
    actions.setAttribute?.("aria-label", "Workflow actions");
    actions.append(
      actionButton(document, "Run", view.commands.run, () => command("workflow/run"), controller),
      actionButton(document, "Cancel", view.commands.cancel, () => command("workflow/cancel"), controller),
      actionButton(document, "Resume", view.commands.resume, () => command("workflow/resume"), controller),
      actionButton(document, "Fork", view.commands.fork, () => command("workflow/fork", {
        nodeId: clonePortable(view.selected?.nodeId ?? null),
        checkpointId: view.selected?.run?.checkpointId ?? null,
      }), controller),
    );
    toolbar.append(identity, actions);

    const body = className(document.createElement("div"), "hodos-workflow-body");
    const graphContainer = className(document.createElement("div"), "hodos-workflow-graph");
    graphHost = createGraphHost({
      container: graphContainer,
      services,
      reportError: report,
      dispatch(event) {
        const translated = workflowEventFromGraph(event, view);
        if (translated) send(translated);
      },
    });
    if (!graphHost || typeof graphHost.update !== "function") {
      throw new TypeError("createGraphHost must return a graph host with update(model)");
    }
    graphHost.update(view.graphModel);
    body.append(graphContainer, renderInspector(view.selected));

    const footer = className(document.createElement("footer"), "hodos-workflow-footer");
    footer.append(
      textElement(document, "span", `${view.graph.nodes.length} nodes · ${view.graph.connections.length} relationships`),
      textElement(document, "span", `${view.diagnostics.errors.length} errors · ${view.diagnostics.warnings.length} warnings`),
    );
    shell.append(toolbar, body, footer);
    container.replaceChildren(shell);
  };

  return {
    update(model) {
      render(model);
    },
    view() {
      return view;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort();
      graphHost?.dispose?.();
      graphHost?.destroy?.();
      graphHost = null;
      container.replaceChildren();
      container.classList?.remove("hodos-workflow-host");
      delete container.dataset.hodosComponent;
      delete container.dataset.workflowStatus;
    },
  };
}

export const createHodosWorkflowDomHost = createWorkflowDomHost;

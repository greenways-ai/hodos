import { projectExecutionDomView } from "./execution-dom-view.js";
import {
  actionButton,
  addListener,
  className,
  domDocument,
  renderSnapshot,
  sectionHeading,
  textElement,
} from "./execution-dom-elements.js";

export { projectExecutionDomView } from "./execution-dom-view.js";

/**
 * Creates the product-neutral visible Execution host. It renders only bounded,
 * normalized evidence and emits semantic requests; compilation, stepping,
 * promise settlement and machine lifetime remain application responsibilities.
 */
export function createExecutionDomHost({
  container,
  dispatch = () => {},
  dispatchSourceSelection = null,
  services = {},
  context = {},
  reportError = null,
} = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Hodos Dev Execution DOM host requires a container element");
  }

  const document = domDocument(container);
  const errorReporter = reportError
    ?? services?.execution?.reportError
    ?? services?.reportError
    ?? (() => {});
  const sourceDispatcher = dispatchSourceSelection
    ?? services?.execution?.dispatchSourceSelection
    ?? null;
  let controller = null;
  let disposed = false;
  let currentView = null;

  const report = (error) => {
    try {
      errorReporter(error);
    } catch {
      // Error reporting must not cause a second UI failure.
    }
  };

  const send = (type, detail = {}) => {
    try {
      const result = dispatch({ "event/type": type, ...detail });
      if (result && typeof result.then === "function") result.catch(report);
    } catch (error) {
      report(error);
    }
  };

  const sendSourceSelection = (source, boundary) => {
    if (!source || source.offset == null || typeof sourceDispatcher !== "function") return;
    try {
      const result = sourceDispatcher({
        "event/type": "editor/selection",
        sourceId: source.sourceId,
        start: source.offset,
        end: source.offset,
        source,
        boundary: {
          function: boundary.function,
          ip: boundary.ip,
          eventIndex: boundary.kind === "event" ? boundary.index : null,
          traceIndex: boundary.traceIndex,
        },
      });
      if (result && typeof result.then === "function") result.catch(report);
    } catch (error) {
      report(error);
    }
  };

  const select = (boundary) => {
    send("execution/select", {
      sessionId: currentView?.sessionId,
      function: boundary.function,
      ip: boundary.ip,
      eventIndex: boundary.kind === "event" ? boundary.index : null,
      traceIndex: boundary.traceIndex,
      source: boundary.source,
    });
    sendSourceSelection(boundary.source, boundary);
  };

  const renderHeader = (view) => {
    const header = className(document.createElement("header"), "hodos-dev-execution-header");
    const identity = className(document.createElement("div"), "hodos-dev-execution-identity");
    identity.append(
      textElement(document, "h2", "Execution"),
      textElement(document, "p", view.summary),
    );
    const status = textElement(document, "span", view.statusLabel, {
      className: "hodos-dev-execution-status",
    });
    status.dataset.status = view.status;

    const actions = className(document.createElement("div"), "hodos-dev-execution-actions");
    actions.append(
      actionButton(document, "Pause", () => send("execution/pause", {
        sessionId: view.sessionId,
      }), controller, !view.controls.pause, "pause"),
      actionButton(document, "Resume", () => send("execution/resume", {
        sessionId: view.sessionId,
      }), controller, !view.controls.resume, "resume"),
      actionButton(document, "Reset", () => send("execution/reset", {
        sessionId: view.sessionId,
      }), controller, !view.controls.reset, "reset"),
      actionButton(document, "Full trace", () => send("execution/request-trace", {
        sessionId: view.sessionId,
        function: view.selected?.function ?? null,
        ip: view.selected?.ip ?? null,
      }), controller, !view.controls.requestTrace, "request-trace"),
    );
    header.append(identity, status, actions);
    return header;
  };

  const renderMetrics = (view) => {
    const section = className(document.createElement("section"), "hodos-dev-execution-metrics");
    section.append(sectionHeading(document, "Metrics"));
    const cards = className(document.createElement("div"), "hodos-dev-execution-scorecards");
    const entries = [
      ["Instructions", view.metrics.instructions],
      ["Calls", view.metrics.calls],
      ["Returns", view.metrics.returns],
      ["Unwinds", view.metrics.unwinds],
      ["Stack depth", view.metrics.maxStackDepth],
      ["Call depth", view.metrics.maxCallDepth],
    ];
    for (const [label, value] of entries) {
      const card = className(document.createElement("article"), "hodos-dev-execution-scorecard");
      card.append(
        textElement(document, "strong", Number(value).toLocaleString("en-US")),
        textElement(document, "span", label),
      );
      cards.append(card);
    }
    section.append(cards);

    const opcodes = className(document.createElement("div"), "hodos-dev-execution-opcodes");
    opcodes.append(sectionHeading(document, "Opcode distribution"));
    const maximum = Math.max(1, ...view.metrics.opcodeCounts.map((entry) => entry.count));
    if (view.metrics.opcodeCounts.length === 0) {
      opcodes.append(textElement(document, "p", "No opcode counts available.", {
        className: "hodos-dev-execution-empty",
      }));
    } else {
      for (const entry of view.metrics.opcodeCounts) {
        const row = className(document.createElement("div"), "hodos-dev-execution-opcode");
        const label = textElement(document, "span", entry.opcode);
        const progress = document.createElement("progress");
        progress.max = maximum;
        progress.value = entry.count;
        const count = textElement(document, "strong", entry.count.toLocaleString("en-US"));
        row.append(label, progress, count);
        opcodes.append(row);
      }
    }
    section.append(opcodes);
    return section;
  };

  const renderTimeline = (view) => {
    const section = className(document.createElement("section"), "hodos-dev-execution-timeline");
    const heading = className(document.createElement("header"), "hodos-dev-execution-timeline-header");
    heading.append(
      sectionHeading(document, "Timeline"),
      textElement(
        document,
        "small",
        `${view.retention.droppedEvents + view.retention.eventsOmitted} events omitted · ${view.retention.traceOmitted} trace steps omitted`,
      ),
    );
    section.append(heading);
    if (view.timeline.length === 0) {
      section.append(textElement(document, "p", "No execution events yet.", {
        className: "hodos-dev-execution-empty",
      }));
      return section;
    }

    const list = className(document.createElement("ol"), "hodos-dev-execution-timeline-list");
    for (const boundary of view.timeline) {
      const item = document.createElement("li");
      const button = className(document.createElement("button"), "hodos-dev-execution-boundary");
      button.type = "button";
      button.dataset.timelineKind = boundary.kind;
      button.dataset.timelineIndex = String(boundary.index);
      const isSelected = view.selected?.key === boundary.key;
      button.dataset.selected = isSelected ? "true" : "false";
      button.append(
        textElement(document, "strong", boundary.label),
        textElement(document, "span", boundary.detail),
      );
      addListener(button, "click", () => select(boundary), controller);
      item.append(button);
      list.append(item);
    }
    section.append(list);
    return section;
  };

  const renderSelected = (view) => {
    const section = className(document.createElement("section"), "hodos-dev-execution-selected");
    section.append(sectionHeading(document, "Selected boundary"));
    if (!view.selected) {
      section.append(textElement(document, "p", "Select a timeline boundary to inspect it.", {
        className: "hodos-dev-execution-empty",
      }));
      return section;
    }

    const identity = className(document.createElement("dl"), "hodos-dev-execution-boundary-details");
    const entries = [
      ["Kind", view.selected.label],
      ["Function", view.selected.function == null ? "—" : String(view.selected.function)],
      ["Instruction", view.selected.ip == null ? "—" : String(view.selected.ip)],
      ["Opcode", view.selected.opcode ?? "—"],
      ["Source", view.selected.source == null
        ? "Unavailable"
        : `${view.selected.source.sourceId ?? "source"}:${view.selected.source.line ?? "—"}:${view.selected.source.column ?? "—"}`],
    ];
    for (const [term, detail] of entries) {
      identity.append(textElement(document, "dt", term), textElement(document, "dd", detail));
    }
    section.append(identity);

    if (view.selected.source?.offset != null && typeof sourceDispatcher === "function") {
      section.append(actionButton(document, "Open source", () => sendSourceSelection(
        view.selected.source,
        view.selected,
      ), controller, false, "open-source"));
    }

    if (view.selected.instruction != null) {
      section.append(textElement(document, "pre", view.selected.instruction, {
        className: "hodos-dev-execution-instruction",
      }));
    }
    if (view.selected.error != null) {
      section.append(textElement(document, "pre", view.selected.error, {
        className: "hodos-dev-execution-error",
      }));
    }

    const snapshots = className(document.createElement("div"), "hodos-dev-execution-snapshots");
    snapshots.append(
      renderSnapshot(document, "Before", view.selected.before),
      renderSnapshot(document, "After", view.selected.after),
    );
    section.append(snapshots);
    return section;
  };

  const renderDiagnostics = (view) => {
    const section = className(document.createElement("section"), "hodos-dev-execution-diagnostics");
    section.append(sectionHeading(document, "Diagnostics"));
    if (view.diagnostics.length === 0) {
      section.append(textElement(document, "p", "No execution diagnostics.", {
        className: "hodos-dev-execution-empty",
      }));
      return section;
    }
    const list = document.createElement("ul");
    for (const diagnostic of view.diagnostics) {
      const item = document.createElement("li");
      item.dataset.severity = diagnostic.severity;
      item.append(
        textElement(document, "strong", diagnostic.code ?? diagnostic.severity),
        textElement(document, "span", diagnostic.message),
      );
      list.append(item);
    }
    section.append(list);
    return section;
  };

  const render = (view) => {
    controller?.abort();
    controller = new AbortController();
    const root = className(document.createElement("section"), "hodos-dev-execution");
    root.dataset.status = view.status;
    const body = className(document.createElement("div"), "hodos-dev-execution-body");
    const evidence = className(document.createElement("div"), "hodos-dev-execution-evidence");
    const inspection = className(document.createElement("div"), "hodos-dev-execution-inspection");
    evidence.append(renderMetrics(view), renderTimeline(view));
    inspection.append(renderSelected(view), renderDiagnostics(view));
    body.append(evidence, inspection);
    root.append(renderHeader(view), body);
    container.dataset.hodosComponent = view.componentId;
    container.replaceChildren(root);
  };

  return {
    update(model) {
      if (disposed) throw new Error("Hodos Dev Execution DOM host is disposed");
      currentView = projectExecutionDomView(model);
      render(currentView);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      controller?.abort();
      controller = null;
      currentView = null;
      container.replaceChildren();
      delete container.dataset.hodosComponent;
    },
  };
}

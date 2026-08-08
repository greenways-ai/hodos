export const domDocument = (container) => {
  const value = container?.ownerDocument ?? globalThis.document;
  if (!value || typeof value.createElement !== "function") {
    throw new Error("Hodos Dev Execution DOM host requires a DOM Document");
  }
  return value;
};

export const className = (node, value) => {
  node.className = value;
  return node;
};

export const addListener = (target, type, listener, controller) => {
  try {
    target.addEventListener(type, listener, { signal: controller.signal });
  } catch {
    target.addEventListener(type, listener);
    controller.signal.addEventListener("abort", () => target.removeEventListener(type, listener), {
      once: true,
    });
  }
};

export const textElement = (document, tag, text, value = {}) => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (value.className) node.className = value.className;
  if (value.title) node.title = value.title;
  return node;
};

export const actionButton = (document, label, action, controller, disabled = false, actionId = "") => {
  const node = className(document.createElement("button"), "hodos-dev-execution-action");
  node.type = "button";
  node.textContent = label;
  node.disabled = disabled;
  node.dataset.action = actionId;
  addListener(node, "click", (event) => {
    event.stopPropagation?.();
    action();
  }, controller);
  return node;
};

export const sectionHeading = (document, text) => textElement(document, "h3", text, {
  className: "hodos-dev-execution-section-title",
});

export const renderValueList = (document, title, list) => {
  const section = className(document.createElement("section"), "hodos-dev-execution-values");
  section.append(sectionHeading(document, title));
  if (list.values.length === 0) {
    section.append(textElement(document, "p", "Empty", { className: "hodos-dev-execution-empty" }));
  } else {
    const ordered = document.createElement("ol");
    for (const value of list.values) {
      ordered.append(textElement(document, "li", value));
    }
    section.append(ordered);
  }
  if (list.omitted > 0) {
    section.append(textElement(document, "small", `${list.omitted} omitted`, {
      className: "hodos-dev-execution-omitted",
    }));
  }
  return section;
};

export const renderSnapshot = (document, title, snapshot) => {
  const section = className(document.createElement("section"), "hodos-dev-execution-snapshot");
  const header = className(document.createElement("header"), "hodos-dev-execution-snapshot-header");
  header.append(
    sectionHeading(document, title),
    textElement(document, "span", `${snapshot.status} · f${snapshot.function ?? "—"}:${snapshot.ip ?? "—"}`),
  );
  section.append(header);
  const values = className(document.createElement("div"), "hodos-dev-execution-value-grid");
  values.append(
    renderValueList(document, "Stack", snapshot.stack),
    renderValueList(document, "Locals", snapshot.locals),
    renderValueList(document, "Calls", snapshot.calls),
    renderValueList(document, "Handlers", snapshot.handlers),
  );
  section.append(values);
  if (snapshot.result != null) {
    section.append(textElement(document, "pre", snapshot.result, {
      className: "hodos-dev-execution-result",
    }));
  }
  if (snapshot.error != null) {
    section.append(textElement(document, "pre", snapshot.error, {
      className: "hodos-dev-execution-error",
    }));
  }
  return section;
};


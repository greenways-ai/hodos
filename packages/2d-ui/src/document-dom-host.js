const BLOCK_TAGS = Object.freeze({
  paragraph: "p",
  heading: "h1",
  blockquote: "blockquote",
  "bullet-list": "ul",
  "ordered-list": "ol",
  "list-item": "li",
  "code-block": "pre",
  "horizontal-rule": "hr",
  "hara-artefact": "figure",
});

const objectValue = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
};

const stringValue = (value, fallback = "") => value == null ? fallback : String(value);

const projectTextNode = (node, label) => {
  const input = objectValue(node, label);
  if (input.type !== "text") throw new Error(`${label} must have type text`);
  return Object.freeze({
    id: stringValue(input.id),
    text: stringValue(input.text),
    marks: input.marks ?? [],
  });
};

const projectBlock = (block, label) => {
  const input = objectValue(block, label);
  const type = stringValue(input.type);
  const rawChildren = Array.isArray(input.children) ? input.children : [];
  const texts = [];
  const children = [];
  for (const [index, child] of rawChildren.entries()) {
    if (child?.type === "text") texts.push(projectTextNode(child, `${label} text ${index}`));
    else children.push(projectBlock(child, `${label} child ${index}`));
  }
  const attrs = input.attrs && typeof input.attrs === "object" ? input.attrs : {};
  const headingLevel = type === "heading"
    ? Math.max(1, Math.min(6, Number(attrs.level) || 1))
    : null;
  return Object.freeze({
    id: stringValue(input.id),
    type,
    tag: type === "heading" ? `h${headingLevel}` : (BLOCK_TAGS[type] ?? "section"),
    attrs,
    texts: Object.freeze(texts),
    children: Object.freeze(children),
  });
};

/**
 * Produces the inert render plan used by the default DOM host. The plan keeps
 * only the already-normalized Hodos model and never admits callbacks or
 * executable artefact source as host code.
 */
export function projectDocumentDomView(model) {
  const input = objectValue(model, "Hodos 2D Document DOM model");
  const document = objectValue(input.document, "Hodos 2D Document DOM document");
  const capabilities = input.capabilities && typeof input.capabilities === "object"
    ? input.capabilities
    : {};
  return Object.freeze({
    id: stringValue(document.id),
    title: stringValue(document.title, "Untitled document"),
    revision: Number(document.revision) || 0,
    status: stringValue(input.status, "ready"),
    readOnly: Boolean(input.readOnly),
    error: input.error == null ? null : String(input.error),
    selectedNodeId: input.selection?.nodeId == null ? null : String(input.selection.nodeId),
    capabilities: Object.freeze({
      select: Boolean(capabilities.select),
      editText: Boolean(capabilities.editText),
      insertBlock: Boolean(capabilities.insertBlock),
      deleteBlock: Boolean(capabilities.deleteBlock),
      activateArtefact: Boolean(capabilities.activateArtefact),
      commitArtefact: Boolean(capabilities.commitArtefact),
      command: Boolean(capabilities.command),
    }),
    blocks: Object.freeze((document.children ?? []).map((block, index) =>
      projectBlock(block, `Hodos 2D Document DOM block ${index}`))),
  });
}

const domDocument = (container) => {
  const value = container?.ownerDocument ?? globalThis.document;
  if (!value || typeof value.createElement !== "function") {
    throw new Error("Hodos 2D Document DOM host requires a DOM Document");
  }
  return value;
};

const addListener = (target, type, listener, controller) => {
  try {
    target.addEventListener(type, listener, { signal: controller.signal });
  } catch {
    target.addEventListener(type, listener);
    controller.signal.addEventListener("abort", () => target.removeEventListener(type, listener), {
      once: true,
    });
  }
};

const className = (node, value) => {
  node.className = value;
  return node;
};

const createTextElement = (document, tag, text, value = {}) => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (value.className) node.className = value.className;
  return node;
};

const selectionOffsets = (document, element) => {
  const selection = document.defaultView?.getSelection?.();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;
  const startRange = range.cloneRange();
  startRange.selectNodeContents(element);
  startRange.setEnd(range.startContainer, range.startOffset);
  const endRange = range.cloneRange();
  endRange.selectNodeContents(element);
  endRange.setEnd(range.endContainer, range.endOffset);
  return { start: startRange.toString().length, end: endRange.toString().length };
};

const locateTextOffset = (document, root, offset) => {
  const walker = document.createTreeWalker?.(
    root,
    globalThis.NodeFilter?.SHOW_TEXT ?? 4,
  );
  if (!walker) return { node: root, offset: 0 };
  let remaining = Math.max(0, offset);
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
    node = walker.nextNode();
  }
  return { node: root, offset: root.childNodes?.length ?? 0 };
};

const restoreContentSelection = (document, element, offsets) => {
  const selection = document.defaultView?.getSelection?.();
  if (!selection || !document.createRange) return;
  const start = locateTextOffset(document, element, offsets.start);
  const end = locateTextOffset(document, element, offsets.end);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  selection.removeAllRanges();
  selection.addRange(range);
};

const captureFocus = (container, document) => {
  const active = document.activeElement;
  if (!active || !container.contains?.(active) || !active.dataset?.textId) return null;
  if (typeof active.selectionStart === "number") {
    return {
      textId: active.dataset.textId,
      kind: "control",
      start: active.selectionStart,
      end: active.selectionEnd ?? active.selectionStart,
    };
  }
  const offsets = selectionOffsets(document, active);
  return offsets ? { textId: active.dataset.textId, kind: "content", ...offsets } : null;
};

const restoreFocus = (document, textElements, focus) => {
  if (!focus) return;
  const element = textElements.get(focus.textId);
  if (!element) return;
  element.focus?.({ preventScroll: true });
  if (focus.kind === "control" && typeof element.setSelectionRange === "function") {
    const length = element.value?.length ?? 0;
    element.setSelectionRange(Math.min(focus.start, length), Math.min(focus.end, length));
    return;
  }
  restoreContentSelection(document, element, focus);
};

const button = (document, label, action, controller, disabled = false) => {
  const node = className(document.createElement("button"), "hodos-2d-document-button");
  node.type = "button";
  node.textContent = label;
  node.disabled = disabled;
  addListener(node, "click", (event) => {
    event.stopPropagation?.();
    action();
  }, controller);
  return node;
};

export function createDocumentDomHost({
  container,
  dispatch = () => {},
  services = {},
  context = {},
  renderArtefact = null,
  reportError = null,
} = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Hodos 2D Document DOM host requires a container element");
  }

  const document = domDocument(container);
  const artefactRenderer = renderArtefact
    ?? services?.document?.renderArtefact
    ?? services?.renderArtefact
    ?? null;
  const errorReporter = reportError
    ?? services?.document?.reportError
    ?? services?.reportError
    ?? (() => {});
  let controller = null;
  let artefactDisposers = [];
  let disposed = false;
  let currentModel = null;
  let textElements = new Map();

  const report = (error) => {
    try {
      errorReporter(error);
    } catch {
      // Reporting must not create a second UI failure.
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

  const resetRender = () => {
    controller?.abort();
    controller = new AbortController();
    for (const dispose of artefactDisposers.splice(0).reverse()) {
      try {
        dispose?.();
      } catch (error) {
        report(error);
      }
    }
    textElements = new Map();
  };

  const registerTextElement = (entry, element, view, blockId) => {
    element.dataset.textId = entry.id;
    textElements.set(entry.id, element);
    const editable = !view.readOnly && view.capabilities.editText;
    if (element.tagName === "TEXTAREA") {
      element.readOnly = !editable;
      let previous = entry.text;
      addListener(element, "input", () => {
        const next = element.value;
        send("document/edit-text", {
          documentId: view.id,
          blockId,
          textId: entry.id,
          previous,
          text: next,
        });
        previous = next;
      }, controller);
      return;
    }
    element.contentEditable = editable ? "plaintext-only" : "false";
    element.spellcheck = editable;
    let previous = entry.text;
    addListener(element, "input", () => {
      const next = element.textContent ?? "";
      send("document/edit-text", {
        documentId: view.id,
        blockId,
        textId: entry.id,
        previous,
        text: next,
      });
      previous = next;
    }, controller);
  };

  const renderInlineText = (block, view, target) => {
    for (const entry of block.texts) {
      const text = className(document.createElement("span"), "hodos-2d-document-text");
      text.textContent = entry.text;
      registerTextElement(entry, text, view, block.id);
      target.append(text);
    }
  };

  const selectBlock = (block, view) => {
    if (!view.capabilities.select) return;
    send("document/select", {
      documentId: view.id,
      nodeId: block.id,
    });
  };

  const renderArtefactBlock = (block, view) => {
    const node = className(document.createElement("figure"), "hodos-2d-document-block hodos-2d-document-artefact");
    node.dataset.nodeId = block.id;
    node.dataset.blockType = block.type;
    if (block.id === view.selectedNodeId) node.classList.add("selected");
    addListener(node, "focusin", () => selectBlock(block, view), controller);
    addListener(node, "pointerdown", () => selectBlock(block, view), controller);

    const header = className(document.createElement("header"), "hodos-2d-document-artefact-header");
    const identity = document.createElement("div");
    identity.append(
      createTextElement(document, "strong", stringValue(block.attrs.title, "Hara artefact")),
      createTextElement(
        document,
        "small",
        `${stringValue(block.attrs.kind, "value")} · ${stringValue(block.attrs.mode, "live")}`,
      ),
    );
    const actions = className(document.createElement("div"), "hodos-2d-document-actions");
    const locked = view.readOnly;
    if (view.capabilities.activateArtefact) {
      actions.append(button(document, "Run", () => send("document/activate-artefact", {
        documentId: view.id,
        blockId: block.id,
        artefactId: block.attrs.artefactId,
      }), controller, locked));
    }
    if (view.capabilities.commitArtefact) {
      actions.append(button(document, "Commit snapshot", () => send("document/commit-artefact", {
        documentId: view.id,
        blockId: block.id,
        artefactId: block.attrs.artefactId,
      }), controller, locked));
    }
    if (view.capabilities.deleteBlock) {
      actions.append(button(document, "Remove", () => send("document/delete-block", {
        documentId: view.id,
        blockId: block.id,
      }), controller, locked));
    }
    header.append(identity, actions);

    const sourceWrap = className(document.createElement("label"), "hodos-2d-document-artefact-source");
    sourceWrap.append(createTextElement(document, "span", "Hara source"));
    const source = document.createElement("textarea");
    const sourceEntry = block.texts[0] ?? { id: `${block.id}/source`, text: "" };
    source.value = sourceEntry.text;
    source.spellcheck = false;
    registerTextElement(sourceEntry, source, view, block.id);
    sourceWrap.append(source);

    const output = className(document.createElement("div"), "hodos-2d-document-artefact-output");
    output.dataset.artefactOutput = stringValue(block.attrs.artefactId);
    if (typeof artefactRenderer === "function") {
      try {
        const result = artefactRenderer({
          container: output,
          block,
          model: currentModel,
          context,
          dispatch: send,
        });
        if (typeof result === "function") artefactDisposers.push(result);
        else if (result?.dispose) artefactDisposers.push(() => result.dispose());
        else if (result?.destroy) artefactDisposers.push(() => result.destroy());
      } catch (error) {
        report(error);
        output.append(createTextElement(document, "pre", error.message || String(error), {
          className: "hodos-2d-document-error",
        }));
      }
    } else {
      const snapshot = block.attrs.snapshotDisplay;
      output.append(createTextElement(
        document,
        "pre",
        snapshot == null ? "Run this artefact through an injected Hara service." : String(snapshot),
      ));
    }

    node.append(header, sourceWrap, output);
    return node;
  };

  const renderBlock = (block, view) => {
    if (block.type === "hara-artefact") return renderArtefactBlock(block, view);
    if (block.type === "horizontal-rule") {
      const rule = className(document.createElement("hr"), "hodos-2d-document-block hodos-2d-document-rule");
      rule.dataset.nodeId = block.id;
      rule.dataset.blockType = block.type;
      addListener(rule, "pointerdown", () => selectBlock(block, view), controller);
      return rule;
    }

    const node = className(
      document.createElement(block.tag),
      `hodos-2d-document-block hodos-2d-document-${block.type}`,
    );
    node.dataset.nodeId = block.id;
    node.dataset.blockType = block.type;
    if (block.id === view.selectedNodeId) node.classList.add("selected");
    addListener(node, "focusin", () => selectBlock(block, view), controller);
    addListener(node, "pointerdown", () => selectBlock(block, view), controller);

    const textTarget = block.type === "code-block"
      ? className(document.createElement("code"), "hodos-2d-document-code")
      : node;
    renderInlineText(block, view, textTarget);
    if (textTarget !== node) node.append(textTarget);
    for (const child of block.children) node.append(renderBlock(child, view));

    if (!view.readOnly && view.capabilities.deleteBlock && block.type !== "list-item") {
      const controls = className(document.createElement("span"), "hodos-2d-document-block-controls");
      controls.append(button(document, "Delete", () => send("document/delete-block", {
        documentId: view.id,
        blockId: block.id,
      }), controller));
      node.append(controls);
    }
    return node;
  };

  const render = (model) => {
    if (disposed) throw new Error("Hodos 2D Document DOM host has been disposed");
    const view = projectDocumentDomView(model);
    const focus = captureFocus(container, document);
    currentModel = model;
    resetRender();

    container.classList?.add("hodos-2d-document-host");
    container.dataset.hodosComponent = "hodos.2d/document";
    container.dataset.documentId = view.id;
    container.dataset.documentStatus = view.status;

    const shell = className(document.createElement("section"), "hodos-2d-document");
    shell.dataset.documentId = view.id;
    const toolbar = className(document.createElement("header"), "hodos-2d-document-toolbar");
    const title = document.createElement("div");
    title.append(
      createTextElement(document, "strong", view.title),
      createTextElement(document, "span", `revision ${view.revision} · ${view.status}`),
    );
    const toolbarActions = className(document.createElement("nav"), "hodos-2d-document-actions");
    toolbarActions.setAttribute("aria-label", "Document actions");
    if (!view.readOnly && view.capabilities.insertBlock) {
      const afterId = view.selectedNodeId ?? view.blocks.at(-1)?.id ?? null;
      toolbarActions.append(
        button(document, "Paragraph", () => send("document/insert-block", {
          documentId: view.id,
          blockType: "paragraph",
          afterId,
        }), controller),
        button(document, "Heading", () => send("document/insert-block", {
          documentId: view.id,
          blockType: "heading",
          afterId,
        }), controller),
        button(document, "Hara artefact", () => send("document/insert-block", {
          documentId: view.id,
          blockType: "hara-artefact",
          artefactKind: "value",
          afterId,
        }), controller),
      );
    }
    if (view.capabilities.command) {
      toolbarActions.append(button(document, "Commands", () => send("document/command", {
        documentId: view.id,
        command: "document/commands",
      }), controller));
    }
    toolbar.append(title, toolbarActions);

    const page = className(document.createElement("main"), "hodos-2d-document-page");
    for (const block of view.blocks) page.append(renderBlock(block, view));
    if (!view.blocks.length) {
      page.append(createTextElement(document, "p", "This document is empty.", {
        className: "hodos-2d-document-empty",
      }));
    }

    const footer = className(document.createElement("footer"), "hodos-2d-document-footer");
    footer.append(
      createTextElement(document, "span", `${view.blocks.length} blocks`),
      createTextElement(document, "span", view.readOnly ? "Read only" : "Semantic editing enabled"),
    );

    shell.append(toolbar, page);
    if (view.error) {
      shell.append(createTextElement(document, "p", view.error, {
        className: "hodos-2d-document-error",
      }));
    }
    shell.append(footer);
    container.replaceChildren(shell);
    restoreFocus(document, textElements, focus);
  };

  return {
    update(model) {
      render(model);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      controller?.abort();
      for (const dispose of artefactDisposers.splice(0).reverse()) {
        try {
          dispose?.();
        } catch (error) {
          report(error);
        }
      }
      container.replaceChildren();
      container.classList?.remove("hodos-2d-document-host");
      delete container.dataset.hodosComponent;
      delete container.dataset.documentId;
      delete container.dataset.documentStatus;
    },
  };
}

export const createHodosDocumentDomHost = createDocumentDomHost;

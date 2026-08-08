import { WorkspaceShellHost as BaseWorkspaceShellHost } from "./shell.js";

const contains = (root, node) => {
  if (!root || !node) return false;
  if (typeof root.contains === "function") return root.contains(node);
  if (root === node) return true;
  return Array.from(root.children ?? []).some((child) => contains(child, node));
};

const textNodes = (root, output = []) => {
  if (!root) return output;
  if (root.dataset?.textId) output.push(root);
  for (const child of root.children ?? []) textNodes(child, output);
  return output;
};

const selectionOffsets = (document, element) => {
  const selection = document?.defaultView?.getSelection?.();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!contains(element, range.startContainer) || !contains(element, range.endContainer)) return null;
  const startRange = range.cloneRange();
  startRange.selectNodeContents(element);
  startRange.setEnd(range.startContainer, range.startOffset);
  const endRange = range.cloneRange();
  endRange.selectNodeContents(element);
  endRange.setEnd(range.endContainer, range.endOffset);
  return { start: startRange.toString().length, end: endRange.toString().length };
};

const locateTextOffset = (document, root, offset) => {
  const showText = document?.defaultView?.NodeFilter?.SHOW_TEXT
    ?? globalThis.NodeFilter?.SHOW_TEXT
    ?? 4;
  const walker = document?.createTreeWalker?.(root, showText);
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

const restoreContentSelection = (document, element, focus) => {
  const selection = document?.defaultView?.getSelection?.();
  if (!selection || typeof document?.createRange !== "function") return;
  const start = locateTextOffset(document, element, focus.start);
  const end = locateTextOffset(document, element, focus.end);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  selection.removeAllRanges();
  selection.addRange(range);
};

export function captureWorkspaceFocus(root, document = root?.ownerDocument ?? globalThis.document) {
  const active = document?.activeElement;
  if (!active || !contains(root, active)) return null;
  const focus = {
    element: active,
    textId: active.dataset?.textId || null,
    id: typeof active.id === "string" && active.id ? active.id : null,
    scrollTop: Number(active.scrollTop) || 0,
    scrollLeft: Number(active.scrollLeft) || 0,
    kind: "focus",
  };
  if (typeof active.selectionStart === "number") {
    focus.kind = "control";
    focus.start = active.selectionStart;
    focus.end = active.selectionEnd ?? active.selectionStart;
    return focus;
  }
  const offsets = selectionOffsets(document, active);
  if (offsets) Object.assign(focus, { kind: "content", ...offsets });
  return focus;
}

const focusTarget = (root, document, focus) => {
  if (contains(root, focus.element)) return focus.element;
  if (focus.textId) {
    const candidates = typeof root?.querySelectorAll === "function"
      ? root.querySelectorAll("[data-text-id]")
      : textNodes(root);
    for (const candidate of candidates ?? []) {
      if (candidate.dataset?.textId === focus.textId) return candidate;
    }
  }
  if (focus.id && typeof document?.getElementById === "function") {
    const candidate = document.getElementById(focus.id);
    if (contains(root, candidate)) return candidate;
  }
  return null;
};

export function restoreWorkspaceFocus(
  root,
  focus,
  document = root?.ownerDocument ?? globalThis.document,
) {
  if (!focus) return false;
  const element = focusTarget(root, document, focus);
  if (!element) return false;
  element.focus?.({ preventScroll: true });
  if ("scrollTop" in element) element.scrollTop = focus.scrollTop;
  if ("scrollLeft" in element) element.scrollLeft = focus.scrollLeft;
  if (focus.kind === "control" && typeof element.setSelectionRange === "function") {
    const length = typeof element.value === "string" ? element.value.length : 0;
    element.setSelectionRange(
      Math.min(focus.start, length),
      Math.min(focus.end, length),
    );
  } else if (focus.kind === "content") {
    restoreContentSelection(document, element, focus);
  }
  return true;
}

export class WorkspaceShellHost extends BaseWorkspaceShellHost {
  constructor(options = {}) {
    super(options);
    this.focusRoot = options.root;
    this.focusDocument = options.document ?? options.root?.ownerDocument ?? globalThis.document;
  }

  update(value, context = {}) {
    const focus = captureWorkspaceFocus(this.focusRoot, this.focusDocument);
    const result = super.update(value, context);
    restoreWorkspaceFocus(this.focusRoot, focus, this.focusDocument);
    return result;
  }
}

export const createWorkspaceShellHost = (options) => new WorkspaceShellHost(options);

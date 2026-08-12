import "./rigging-workspace.css";
import {
  buildRigEditorIntent,
  buildRigMoveTransactionIntent,
  createRigAuthoringState,
  createRigMoveTransaction,
  createRiggingSession,
  flattenRigHierarchy,
  nudgeRigMoveTransaction,
  prepareRigWorkfileRestore,
  reduceRigAuthoringEvent,
  serializeRigWorkfileEdn,
  serializeRigWorkfileJson,
  createRigWorkfile,
  rigJointSubtree,
  rigLocalPointToWorld,
  RIG_NUDGE_KEYS,
  rigRestWorldTransforms,
  updateRigMoveTransaction,
} from "@greenways/hodos-world-model/rigging";
import {
  createLocalRiggingAssetHost,
  RiggingAuthoringRenderer,
} from "@greenways/hodos-renderer-playcanvas";
import {
  createRigWorkfileAutosave,
  createWebStorageRigWorkfileProvider,
} from "./rigging-workfile-browser.js";

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

function valueState(value) {
  return value?.rigging?.authoring ?? value?.authoring ?? value;
}

function activeHandle(state) {
  return state?.session?.active?.source?.handle?.id ?? null;
}

function randomId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

function editableTarget(target, host = globalThis) {
  const Input = host.HTMLInputElement;
  const Textarea = host.HTMLTextAreaElement;
  const Select = host.HTMLSelectElement;
  return Boolean((Input && target instanceof Input)
    || (Textarea && target instanceof Textarea)
    || (Select && target instanceof Select)
    || target?.isContentEditable);
}

function resolveWorkfileProvider(value, host) {
  if (value === null) return null;
  if (value && typeof value.get === "function" && typeof value.set === "function" && typeof value.delete === "function") return value;
  const storage = value === undefined ? (() => {
    try { return host.localStorage ?? null; } catch { return null; }
  })() : value;
  if (!storage) return null;
  return createWebStorageRigWorkfileProvider(storage);
}

function safeDownloadName(value, extension) {
  const stem = String(value || "rig").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "rig";
  return `${stem}.${extension}`;
}

function input(document, type, label, value = "") {
  const node = document.createElement("input");
  node.type = type;
  node.value = String(value ?? "");
  node.setAttribute("aria-label", label);
  return node;
}

export class RiggingWorkspace {
  constructor(root, {
    dispatch = null,
    onChange = null,
    initialState = null,
    assetHost = null,
    createRenderer = null,
    rendererOptions = {},
    workfileStorage = undefined,
    autosave = true,
    autosaveDelay = 750,
    maximumWorkfileBytes = undefined,
    host = globalThis,
  } = {}) {
    if (!root) throw new TypeError("RiggingWorkspace requires a root element");
    this.root = root;
    this.dispatch = typeof dispatch === "function" ? dispatch : null;
    this.onChange = typeof onChange === "function" ? onChange : null;
    this.host = host;
    this.state = createRigAuthoringState(valueState(initialState ?? {}));
    this.ownsAssetHost = !assetHost;
    this.assetHost = assetHost ?? createLocalRiggingAssetHost({ id: randomId("rig-workspace") });
    this.loadedHandle = null;
    this.loadingHandle = null;
    this.destroyed = false;
    this.abort = new AbortController();
    this.moveTransaction = null;
    this.moveKeys = new Set();
    this.moveCommitTimer = null;
    this.maximumWorkfileBytes = maximumWorkfileBytes;
    const provider = autosave ? resolveWorkfileProvider(workfileStorage, host) : null;
    this.autosave = provider ? createRigWorkfileAutosave({
      provider,
      delay: autosaveDelay,
      maximumBytes: maximumWorkfileBytes,
      timers: host,
    }) : null;
    this.renderShell();
    const factory = typeof createRenderer === "function"
      ? createRenderer
      : (canvas, options) => new RiggingAuthoringRenderer(canvas, options);
    this.renderer = factory(this.canvas, {
      assetHost: this.assetHost,
      entityOverlayRoot: this.viewportOverlay,
      onRigIntent: ({ intent, editorAfter }) => this.emit({ "event/type": "rig/intent", intent, editorAfter }),
      onRigEditor: (event) => this.handleRendererEditorEvent(event),
      ...rendererOptions,
    });
    this.installKeyboard();
    this.update(this.state);
  }

  renderShell() {
    const document = this.root.ownerDocument ?? globalThis.document;
    this.root.className = "hodos-rigging-workspace";
    this.root.innerHTML = `
      <header class="hodos-rigging-toolbar">
        <div class="hodos-rigging-brand"><span>HODOS</span><strong>Rigging</strong></div>
        <label class="hodos-rigging-open">Open GLB<input type="file" accept=".glb,model/gltf-binary" data-rig-open></label>
        <label class="hodos-rigging-open">Open rig<input type="file" accept=".json,.rig.json,application/json" data-rig-workfile-open></label>
        <div class="hodos-rigging-tools" data-rig-tools></div>
        <label>Space<select data-rig-space><option value="world">World</option><option value="local">Local</option></select></label>
        <label>Snap<select data-rig-snap><option value="surface">Surface</option><option value="depth">Depth</option><option value="grid">Grid</option><option value="none">None</option></select></label>
        <label>Rig mismatch<select data-rig-mismatch><option value="reject">Require same model</option><option value="rebind">Rebind skeleton</option></select></label>
        <div class="hodos-rigging-actions" data-rig-actions></div>
      </header>
      <aside class="hodos-rigging-outliner">
        <header><span>SKELETON</span><strong>Hierarchy</strong><input type="search" placeholder="Filter joints" aria-label="Filter joints" data-rig-filter></header>
        <div class="hodos-rigging-tree" role="tree" aria-label="Rig hierarchy" data-rig-tree></div>
      </aside>
      <main class="hodos-rigging-viewport">
        <canvas data-rig-canvas></canvas>
        <div class="hodos-rigging-viewport-overlay" data-rig-viewport-overlay></div>
        <div class="hodos-rigging-empty" data-rig-empty><strong>Open a local GLB</strong><span>The model remains on this device.</span></div>
      </main>
      <aside class="hodos-rigging-inspector">
        <header><span>PROPERTIES</span><strong data-rig-inspector-title>Rig</strong></header>
        <div data-rig-properties></div>
      </aside>
      <div class="hodos-rigging-live" aria-live="polite" aria-atomic="true" data-rig-live></div>
      <footer class="hodos-rigging-status"><span data-rig-status></span><span>Arrows XY · Page Up/Down Z · Alt fine · Shift coarse · Shift-A add child · Esc cancel</span></footer>`;
    this.openInput = this.root.querySelector("[data-rig-open]");
    this.workfileInput = this.root.querySelector("[data-rig-workfile-open]");
    this.mismatchPolicy = this.root.querySelector("[data-rig-mismatch]");
    this.tools = this.root.querySelector("[data-rig-tools]");
    this.space = this.root.querySelector("[data-rig-space]");
    this.snap = this.root.querySelector("[data-rig-snap]");
    this.actions = this.root.querySelector("[data-rig-actions]");
    this.filter = this.root.querySelector("[data-rig-filter]");
    this.tree = this.root.querySelector("[data-rig-tree]");
    this.canvas = this.root.querySelector("[data-rig-canvas]");
    this.viewportOverlay = this.root.querySelector("[data-rig-viewport-overlay]");
    this.empty = this.root.querySelector("[data-rig-empty]");
    this.properties = this.root.querySelector("[data-rig-properties]");
    this.inspectorTitle = this.root.querySelector("[data-rig-inspector-title]");
    this.status = this.root.querySelector("[data-rig-status]");
    this.live = this.root.querySelector("[data-rig-live]");

    for (const [tool, label] of [["select", "Select"], ["joint-create", "Add joint"], ["translate", "Move"]]) {
      const control = button(document, label, () => this.emit({
        "event/type": "rig/editor-settings",
        patch: { tool },
      }));
      control.dataset.rigTool = tool;
      this.tools.append(control);
    }
    this.undo = button(document, "Undo", () => this.emit({ "event/type": "rig/history-undo" }));
    this.redo = button(document, "Redo", () => this.emit({ "event/type": "rig/history-redo" }));
    this.addChild = button(document, "Add child", () => this.createKeyboardJoint());
    this.duplicate = button(document, "Duplicate", () => this.commitAction({ type: "duplicate" }));
    this.mirror = button(document, "Mirror X", () => this.commitAction({ type: "mirror", axis: "x" }));
    this.remove = button(document, "Delete subtree", () => this.commitAction({ type: "delete", cascade: true }));
    this.frame = button(document, "Frame", () => this.renderer?.focusRigSelection?.());
    this.saveJson = button(document, "Save JSON", () => this.downloadWorkfile("json"));
    this.saveEdn = button(document, "Save EDN", () => this.downloadWorkfile("edn"));
    this.clearAutosave = button(document, "Clear autosave", () => this.removeAutosave());
    this.actions.append(this.undo, this.redo, this.addChild, this.duplicate, this.mirror, this.remove, this.frame, this.saveJson, this.saveEdn, this.clearAutosave);

    this.openInput.addEventListener("change", () => {
      const file = this.openInput.files?.[0];
      if (file) this.openFile(file);
      this.openInput.value = "";
    }, { signal: this.abort.signal });
    this.workfileInput.addEventListener("change", () => {
      const file = this.workfileInput.files?.[0];
      if (file) this.openWorkfile(file);
      this.workfileInput.value = "";
    }, { signal: this.abort.signal });
    this.space.addEventListener("change", () => this.emit({
      "event/type": "rig/editor-settings",
      patch: { space: this.space.value },
    }), { signal: this.abort.signal });
    this.snap.addEventListener("change", () => this.emit({
      "event/type": "rig/editor-settings",
      patch: { snap: { ...this.state.editor.snap, mode: this.snap.value } },
    }), { signal: this.abort.signal });
    this.filter.addEventListener("input", () => this.renderTree(), { signal: this.abort.signal });
  }

  handleRendererEditorEvent(event) {
    if (event.action === "select") {
      this.emit({
        "event/type": "rig/editor-select",
        jointIds: event.jointId ? [event.jointId] : [],
        mode: event.mode ?? "replace",
      });
    }
  }

  activeWorldPosition() {
    const active = this.state.editor.active;
    return active
      ? rigRestWorldTransforms(this.state.document).find((entry) => entry.id === active)?.translation ?? null
      : null;
  }

  announce(message) {
    if (!this.live) return;
    this.live.textContent = "";
    queueMicrotask(() => {
      if (!this.destroyed && this.live) this.live.textContent = String(message ?? "");
    });
  }

  announceActive(prefix = "Selected") {
    const active = this.state.editor.active;
    const position = this.activeWorldPosition();
    if (!active || !position) return this.announce("No joint selected");
    this.announce(`${prefix} ${active}. Position ${position.map((entry) => Number(entry).toFixed(3)).join(", ")}.`);
  }

  focusCurrentTreeItem() {
    queueMicrotask(() => this.tree?.querySelector('[tabindex="0"]')?.focus?.());
  }

  beginMoveTransaction(source = "keyboard") {
    const active = this.state.editor.active;
    if (!active) throw new RangeError("Select a joint before moving it");
    const current = this.moveTransaction;
    if (current
      && current.jointId === active
      && current.revision === this.state.document.revision
      && current.source === source) return current;
    this.cancelMoveTransaction({ announce: false });
    this.moveTransaction = createRigMoveTransaction(this.state.document, this.state.editor, {
      jointId: active,
      source,
    });
    return this.moveTransaction;
  }

  previewMovePosition(worldPosition, source = "numeric") {
    const transaction = this.beginMoveTransaction(source);
    this.moveTransaction = updateRigMoveTransaction(transaction, worldPosition);
    this.renderer?.previewRigJoint?.(transaction.jointId, this.moveTransaction.current);
    this.announce(`${transaction.jointId} preview. Position ${this.moveTransaction.current.map((entry) => entry.toFixed(3)).join(", ")}. Enter or Apply commits; Escape cancels.`);
    return this.moveTransaction;
  }

  commitMoveTransaction() {
    const transaction = this.moveTransaction;
    if (!transaction) return this.state;
    clearTimeout(this.moveCommitTimer);
    this.moveCommitTimer = null;
    this.moveKeys.clear();
    this.moveTransaction = null;
    this.renderer?.clearRigPreview?.();
    if (!transaction.steps) return this.state;
    try {
      const intent = buildRigMoveTransactionIntent(this.state.document, this.state.editor, transaction);
      return this.emit({
        "event/type": "rig/intent",
        intent,
        editorAfter: { selection: [transaction.jointId], active: transaction.jointId, focused: transaction.jointId },
      });
    } catch (error) {
      this.setStatus(error.message || String(error), "error");
      return this.state;
    }
  }

  cancelMoveTransaction({ announce = true, render = false } = {}) {
    const transaction = this.moveTransaction;
    clearTimeout(this.moveCommitTimer);
    this.moveCommitTimer = null;
    this.moveKeys.clear();
    this.moveTransaction = null;
    this.renderer?.clearRigPreview?.();
    if (render) this.renderInspector();
    if (transaction && announce) this.announce(`Cancelled ${transaction.jointId} move preview.`);
    return Boolean(transaction);
  }

  scheduleMoveCommit() {
    clearTimeout(this.moveCommitTimer);
    this.moveCommitTimer = setTimeout(() => {
      if (!this.moveKeys.size) this.commitMoveTransaction();
    }, 220);
  }

  createKeyboardJoint() {
    const active = this.state.editor.active;
    const origin = this.activeWorldPosition() ?? this.renderer?.rigAssetBounds?.center ?? [0, 0, 0];
    const offset = Math.max(this.state.editor.snap.translate * 10, 0.1);
    return this.commitAction({
      type: "create",
      parentId: active,
      worldPosition: [origin[0], origin[1] + offset, origin[2]],
      prefix: active ? `${active}-joint` : "joint",
    });
  }

  async openFile(file) {
    this.setStatus(`Opening ${file.name || "local GLB"}…`);
    const session = this.state.session ?? createRiggingSession({ id: randomId("rig-session") });
    const result = await this.assetHost.open(session, file, {
      fileName: file.name,
      mediaType: file.type,
    });
    const opened = {
      "event/type": "rig/source-opened",
      session: result.session,
      preserveDocument: false,
    };
    if (result.source) opened.rigId = `rig:${result.source.contentId.slice(7, 19)}`;
    this.emit(opened);
    if (!result.ok) {
      this.setStatus(result.error?.message ?? "Unable to open the local GLB", "error");
      return result;
    }
    await this.loadHandle(result.handle);
    await this.restoreAutosave(result.source.contentId);
    const summary = result.preflight.summary;
    this.setStatus(`${file.name || "GLB"} · ${summary.status} · ${result.preflight.geometry.vertices} vertices`, summary.errors ? "error" : summary.warnings ? "warning" : "ready");
    return result;
  }

  currentWorkfile() {
    return createRigWorkfile(this.state, { maximumBytes: this.maximumWorkfileBytes });
  }

  downloadWorkfile(format = "json") {
    try {
      const workfile = this.currentWorkfile();
      const text = format === "edn"
        ? serializeRigWorkfileEdn(workfile, { maximumBytes: this.maximumWorkfileBytes })
        : serializeRigWorkfileJson(workfile, { maximumBytes: this.maximumWorkfileBytes });
      const BlobCtor = this.host.Blob ?? globalThis.Blob;
      const URLApi = this.host.URL ?? globalThis.URL;
      if (!BlobCtor || !URLApi?.createObjectURL) throw new Error("Browser download APIs are unavailable");
      const url = URLApi.createObjectURL(new BlobCtor([text], { type: format === "edn" ? "application/edn" : "application/json" }));
      const anchor = this.root.ownerDocument.createElement("a");
      anchor.href = url;
      anchor.download = safeDownloadName(this.state.document.id, format === "edn" ? "rig.edn" : "rig.json");
      anchor.hidden = true;
      this.root.append(anchor);
      anchor.click();
      anchor.remove();
      queueMicrotask(() => URLApi.revokeObjectURL(url));
      this.setStatus(`Saved ${format.toUpperCase()} rig workfile`, "ready");
    } catch (error) {
      this.setStatus(error.message || String(error), "error");
    }
  }

  async openWorkfile(file) {
    try {
      const text = await file.text();
      const prepared = prepareRigWorkfileRestore(this.state, text, {
        mismatchPolicy: this.mismatchPolicy.value,
        maximumBytes: this.maximumWorkfileBytes,
      });
      if (!prepared.ok) {
        this.setStatus(prepared.error.message, "error");
        return prepared;
      }
      this.emit(prepared.event);
      this.setStatus(prepared.source.rebound ? prepared.warnings[0].message : `Restored ${file.name || "rig workfile"}`, prepared.source.rebound ? "warning" : "ready");
      return prepared;
    } catch (error) {
      this.setStatus(error.message || String(error), "error");
      return { ok: false, error };
    }
  }

  async restoreAutosave(contentId) {
    if (!this.autosave) return null;
    try {
      const workfile = await this.autosave.load(contentId);
      if (!workfile) return null;
      const prepared = prepareRigWorkfileRestore(this.state, workfile, {
        mismatchPolicy: "reject",
        maximumBytes: this.maximumWorkfileBytes,
      });
      if (!prepared.ok) return prepared;
      this.emit(prepared.event);
      this.setStatus("Restored the matching local autosave", "ready");
      return prepared;
    } catch (error) {
      this.setStatus(`Autosave restore failed: ${error.message || error}`, "warning");
      return null;
    }
  }

  async removeAutosave() {
    const contentId = this.state.session?.active?.source?.contentId;
    if (!this.autosave || !contentId) return this.setStatus("No active source autosave to clear", "warning");
    await this.autosave.remove(contentId);
    this.setStatus("Cleared the local rig autosave", "ready");
  }

  async loadHandle(handle) {
    if (!handle || handle === this.loadedHandle || handle === this.loadingHandle) return;
    if (!this.assetHost.has(handle)) {
      this.setStatus("The saved rig source handle is not available in this browser session", "warning");
      return;
    }
    this.loadingHandle = handle;
    try {
      await this.renderer.loadRiggingAsset(handle);
      this.loadedHandle = handle;
    } finally {
      this.loadingHandle = null;
    }
  }

  emit(event) {
    if (this.destroyed) return this.state;
    const type = event["event/type"] ?? event.type;
    if (["rig/source-opened", "rig/history-undo", "rig/history-redo", "studio/history-undo", "studio/history-redo"].includes(type)) {
      this.cancelMoveTransaction({ announce: false });
    }
    try {
      this.state = reduceRigAuthoringEvent(this.state, event);
      this.update(this.state);
      this.dispatch?.(event);
      this.onChange?.(this.state, event);
      if (type !== "rig/source-opened") this.autosave?.schedule(this.state);
      if (this.state.lastOutcome?.status === "rejected") {
        this.announce(this.state.lastOutcome.error?.message ?? "Rig operation rejected");
      } else if (type === "rig/editor-select" || type === "rig/editor-focus") {
        this.announceActive(type === "rig/editor-focus" ? "Focused" : "Selected");
      } else if (["rig/history-undo", "studio/history-undo", "world/history-undo"].includes(type)) {
        this.announceActive("Undo restored");
        this.focusCurrentTreeItem();
      } else if (["rig/history-redo", "studio/history-redo", "world/history-redo"].includes(type)) {
        this.announceActive("Redo restored");
        this.focusCurrentTreeItem();
      } else if (type === "rig/intent" && event.intent?.type === "rig/joint-update") {
        this.announceActive("Moved");
      } else if (type === "rig/intent" && event.intent?.type === "rig/joint-create") {
        this.announceActive("Created");
      }
      return this.state;
    } catch (error) {
      this.setStatus(error.message || String(error), "error");
      return this.state;
    }
  }

  commitAction(action, editorAfter = null) {
    try {
      const intent = buildRigEditorIntent(this.state.document, this.state.editor, action);
      const after = editorAfter ?? this.editorAfterIntent(intent);
      return this.emit({ "event/type": "rig/intent", intent, editorAfter: after });
    } catch (error) {
      this.setStatus(error.message || String(error), "error");
      return this.state;
    }
  }

  editorAfterIntent(intent) {
    if (intent.type === "rig/joint-create") {
      return { selection: [intent.joint.id], active: intent.joint.id, focused: intent.joint.id };
    }
    if (intent.type === "rig/joint-rename") {
      return { selection: [intent.nextId], active: intent.nextId, focused: intent.nextId };
    }
    if (intent.type === "rig/joint-duplicate" || intent.type === "rig/joint-mirror") {
      const selection = intent.jointIds.map((id) => intent.idMap[id]).filter(Boolean);
      return { selection, active: selection.at(-1) ?? null, focused: selection.at(-1) ?? null };
    }
    if (intent.type === "rig/joint-delete") return { selection: [], active: null };
    return null;
  }

  installKeyboard() {
    const document = this.root.ownerDocument ?? globalThis.document;
    const signal = this.abort.signal;
    document.addEventListener("keydown", (event) => {
      if (this.destroyed || editableTarget(event.target, this.host)) return;
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (RIG_NUDGE_KEYS.includes(event.key) && this.state.editor.active && !modifier) {
        event.preventDefault();
        try {
          const transaction = this.beginMoveTransaction("keyboard");
          this.moveKeys.add(event.key);
          this.moveTransaction = nudgeRigMoveTransaction(transaction, event.key, {
            baseStep: this.state.editor.snap.translate,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
          });
          this.renderer?.previewRigJoint?.(transaction.jointId, this.moveTransaction.current);
          this.announce(`${transaction.jointId} preview. Position ${this.moveTransaction.current.map((entry) => entry.toFixed(3)).join(", ")}.`);
          this.scheduleMoveCommit();
        } catch (error) {
          this.setStatus(error.message || String(error), "error");
        }
      } else if (modifier && key === "z") {
        event.preventDefault();
        this.emit({ "event/type": event.shiftKey ? "rig/history-redo" : "rig/history-undo" });
      } else if (modifier && key === "y") {
        event.preventDefault();
        this.emit({ "event/type": "rig/history-redo" });
      } else if ((event.shiftKey && key === "a") || event.key === "Insert") {
        event.preventDefault();
        this.createKeyboardJoint();
      } else if (key === "q") {
        event.preventDefault();
        this.emit({ "event/type": "rig/editor-settings", patch: { tool: "select" } });
      } else if (key === "a") {
        event.preventDefault();
        this.emit({ "event/type": "rig/editor-settings", patch: { tool: "joint-create" } });
      } else if (key === "w") {
        event.preventDefault();
        this.emit({ "event/type": "rig/editor-settings", patch: { tool: "translate" } });
      } else if (key === "f") {
        event.preventDefault();
        this.renderer?.focusRigSelection?.();
      } else if ((event.key === "Delete" || event.key === "Backspace") && this.state.editor.active) {
        event.preventDefault();
        this.commitAction({ type: "delete", cascade: true });
      } else if (event.shiftKey && key === "d") {
        event.preventDefault();
        this.commitAction({ type: "duplicate" });
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (!this.cancelMoveTransaction({ render: true })) {
          this.emit({ "event/type": "rig/editor-select", jointIds: [], mode: "replace" });
        }
      }
    }, { signal });
    document.addEventListener("keyup", (event) => {
      if (!RIG_NUDGE_KEYS.includes(event.key)) return;
      this.moveKeys.delete(event.key);
      if (!this.moveKeys.size) this.commitMoveTransaction();
    }, { signal });
  }

  update(value) {
    if (this.destroyed) return;
    this.state = createRigAuthoringState(valueState(value));
    if (this.moveTransaction && (
      this.moveTransaction.revision !== this.state.document.revision
      || !this.state.document.joints.some((joint) => joint.id === this.moveTransaction.jointId)
    )) this.cancelMoveTransaction({ announce: false });
    this.renderer?.syncRigging?.(this.state.document, this.state.editor);
    if (this.moveTransaction) this.renderer?.previewRigJoint?.(this.moveTransaction.jointId, this.moveTransaction.current);
    const handle = activeHandle(this.state);
    if (handle && this.assetHost.has(handle)) this.loadHandle(handle).catch((error) => this.setStatus(error.message, "error"));
    this.renderToolbar();
    this.renderTree();
    this.renderInspector();
    this.renderStatus();
    this.empty.hidden = Boolean(handle);
  }

  renderToolbar() {
    this.space.value = this.state.editor.space;
    this.snap.value = this.state.editor.snap.mode;
    for (const control of this.tools.querySelectorAll("[data-rig-tool]")) {
      control.dataset.active = String(control.dataset.rigTool === this.state.editor.tool);
      control.setAttribute("aria-pressed", String(control.dataset.rigTool === this.state.editor.tool));
    }
    this.undo.disabled = !this.state.history.undo.length;
    this.redo.disabled = !this.state.history.redo.length;
    this.addChild.disabled = !this.state.session?.active;
    const selected = this.state.editor.selection.length;
    this.duplicate.disabled = !selected;
    this.mirror.disabled = !selected;
    this.remove.disabled = !this.state.editor.active;
    this.frame.disabled = !this.state.editor.active && !this.state.session?.active;
    const sourceReady = Boolean(this.state.session?.active?.source?.contentId);
    this.saveJson.disabled = !sourceReady;
    this.saveEdn.disabled = !sourceReady;
    this.clearAutosave.disabled = !sourceReady || !this.autosave;
  }

  renderTree() {
    const document = this.root.ownerDocument ?? globalThis.document;
    const query = this.filter.value.trim().toLowerCase();
    const { rows, validation } = flattenRigHierarchy(
      this.state.document,
      this.state.editor,
      { includeCollapsed: Boolean(query) },
    );
    const visible = rows.filter((row) => {
      const joint = this.state.document.joints[row.index];
      return !query || `${row.id} ${joint.role || ""}`.toLowerCase().includes(query);
    });
    const nodes = visible.map((row) => {
      const wrapper = element(document, "div", "hodos-rigging-tree-row");
      wrapper.setAttribute("role", "treeitem");
      wrapper.setAttribute("aria-level", String(row.depth + 1));
      wrapper.setAttribute("aria-selected", String(row.selected));
      wrapper.setAttribute("aria-expanded", row.hasChildren ? String(row.expanded) : "false");
      wrapper.tabIndex = row.focused ? 0 : -1;
      wrapper.dataset.active = String(row.active);
      wrapper.dataset.jointId = row.id;
      wrapper.dataset.issues = String(row.issues.length);
      wrapper.style.setProperty("--rig-depth", row.depth);
      const disclosure = button(document, row.hasChildren ? row.expanded ? "▾" : "▸" : "·", () => {
        if (row.hasChildren) this.emit({ "event/type": "rig/editor-toggle-expanded", jointId: row.id });
      }, "hodos-rigging-disclosure");
      disclosure.disabled = !row.hasChildren;
      disclosure.setAttribute("aria-label", `${row.expanded ? "Collapse" : "Expand"} ${row.id}`);
      const select = button(document, "", (event) => this.emit({
        "event/type": "rig/editor-select",
        jointIds: [row.id],
        mode: event.shiftKey ? "toggle" : event.metaKey || event.ctrlKey ? "add" : "replace",
      }), "hodos-rigging-tree-main");
      select.innerHTML = `<span class="hodos-rigging-joint-icon">${row.parent ? "◇" : "◆"}</span><span><strong></strong><small></small></span>`;
      select.querySelector("strong").textContent = row.id;
      select.querySelector("small").textContent = row.role || "joint";
      const badge = row.issues.length ? element(document, "span", "hodos-rigging-issue", String(row.issues.length)) : null;
      wrapper.append(disclosure, select);
      if (badge) wrapper.append(badge);
      wrapper.addEventListener("focus", () => this.emit({ "event/type": "rig/editor-focus", jointId: row.id }));
      wrapper.addEventListener("keydown", (event) => this.handleTreeKey(event, row, visible));
      return wrapper;
    });
    if (!nodes.length) nodes.push(element(document, "p", "hodos-rigging-empty-list", query ? "No matching joints" : "No joints"));
    this.tree.replaceChildren(...nodes);
    this.tree.dataset.valid = String(validation.valid);
  }

  handleTreeKey(event, row, rows) {
    if (this.state.editor.tool === "translate" && RIG_NUDGE_KEYS.includes(event.key)) return;
    const index = rows.findIndex((entry) => entry.id === row.id);
    let target = null;
    if (event.key === "ArrowDown") target = rows[Math.min(rows.length - 1, index + 1)];
    else if (event.key === "ArrowUp") target = rows[Math.max(0, index - 1)];
    else if (event.key === "ArrowRight") {
      if (row.hasChildren && !row.expanded) this.emit({ "event/type": "rig/editor-toggle-expanded", jointId: row.id });
      else target = rows[index + 1]?.depth > row.depth ? rows[index + 1] : null;
    } else if (event.key === "ArrowLeft") {
      if (row.hasChildren && row.expanded) this.emit({ "event/type": "rig/editor-toggle-expanded", jointId: row.id });
      else target = rows.findLast?.((entry, candidate) => candidate < index && entry.depth < row.depth) ?? null;
    } else if (event.key === "Enter" || event.key === " ") {
      this.emit({ "event/type": "rig/editor-select", jointIds: [row.id], mode: event.shiftKey ? "toggle" : "replace" });
    } else return;
    event.preventDefault();
    if (target) {
      this.emit({ "event/type": "rig/editor-focus", jointId: target.id });
      queueMicrotask(() => this.tree.querySelector('[tabindex="0"]')?.focus());
    }
  }

  renderInspector() {
    const document = this.root.ownerDocument ?? globalThis.document;
    const active = this.state.document.joints.find((joint) => joint.id === this.state.editor.active) ?? null;
    this.properties.replaceChildren();
    if (!active) {
      this.inspectorTitle.textContent = "Rig";
      const summary = element(document, "section", "hodos-rigging-section");
      const preflight = this.state.session?.active?.preflight;
      summary.append(
        element(document, "h3", "", "Skeleton"),
        element(document, "p", "", `${this.state.document.joints.length} joint(s)`),
        element(document, "p", "", `Revision ${this.state.document.revision}`),
        element(document, "p", "", preflight ? `Source ${preflight.summary.status}` : "No local source open"),
      );
      this.properties.append(summary);
      return;
    }
    this.inspectorTitle.textContent = active.id;
    const identity = element(document, "section", "hodos-rigging-section");
    identity.append(element(document, "h3", "", "Joint"));
    const name = input(document, "text", "Joint id", active.id);
    name.addEventListener("change", () => {
      const nextId = name.value.trim();
      if (nextId && nextId !== active.id) this.commitAction({ type: "rename", jointId: active.id, nextId });
    });
    const role = input(document, "text", "Joint role", active.role || "joint");
    role.addEventListener("change", () => this.emit({
      "event/type": "rig/intent",
      intent: {
        type: "rig/joint-update",
        jointId: active.id,
        patch: { role: role.value || "joint" },
        expectedRevision: this.state.document.revision,
      },
    }));
    const parent = document.createElement("select");
    parent.setAttribute("aria-label", "Joint parent");
    const rootOption = document.createElement("option");
    rootOption.value = "";
    rootOption.textContent = "Rig root";
    parent.append(rootOption);
    const subtree = new Set(rigJointSubtree(this.state.document, active.id));
    for (const candidate of this.state.document.joints) {
      if (subtree.has(candidate.id)) continue;
      const option = document.createElement("option");
      option.value = candidate.id;
      option.textContent = candidate.id;
      option.selected = candidate.id === active.parent;
      parent.append(option);
    }
    parent.value = active.parent ?? "";
    parent.addEventListener("change", () => this.commitAction({
      type: "reparent",
      jointId: active.id,
      parentId: parent.value || null,
    }));
    identity.append(name, role, parent);

    const transform = element(document, "section", "hodos-rigging-section");
    transform.append(element(document, "h3", "", this.state.editor.space === "world" ? "World position" : "Local rest position"));
    const world = rigRestWorldTransforms(this.state.document).find((entry) => entry.id === active.id)?.translation;
    const values = this.state.editor.space === "world" ? world : active.rest.translation;
    const row = element(document, "div", "hodos-rigging-vector");
    const fields = ["X", "Y", "Z"].map((axis, index) => {
      const field = input(document, "number", `${this.state.editor.space} position ${axis}`, values[index]);
      field.step = String(this.state.editor.snap.translate);
      field.dataset.rigPositionAxis = axis.toLowerCase();
      return field;
    });
    const numericWorldPosition = () => {
      const position = fields.map((field) => Number(field.value));
      if (!position.every(Number.isFinite)) throw new TypeError("Joint position must contain finite numbers");
      return this.state.editor.space === "world"
        ? position
        : rigLocalPointToWorld(this.state.document, active.parent, position);
    };
    const preview = () => {
      try { this.previewMovePosition(numericWorldPosition(), "numeric"); }
      catch (error) { this.setStatus(error.message || String(error), "error"); }
    };
    const apply = button(document, "Apply", () => {
      try {
        this.previewMovePosition(numericWorldPosition(), "numeric");
        this.commitMoveTransaction();
      } catch (error) {
        this.setStatus(error.message || String(error), "error");
      }
    });
    for (const field of fields) {
      field.addEventListener("input", preview);
      field.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          preview();
          this.commitMoveTransaction();
        } else if (event.key === "Escape") {
          event.preventDefault();
          this.cancelMoveTransaction({ render: true });
        }
      });
    }
    row.append(...fields, apply);
    transform.append(row);

    const actions = element(document, "section", "hodos-rigging-section");
    actions.append(
      element(document, "h3", "", "Structure"),
      button(document, "Duplicate selection", () => this.commitAction({ type: "duplicate" })),
      button(document, "Mirror selection across X", () => this.commitAction({ type: "mirror", axis: "x" })),
      button(document, "Delete selected subtree", () => this.commitAction({ type: "delete", jointId: active.id, cascade: true }), "hodos-rigging-danger"),
    );
    this.properties.append(identity, transform, actions);
  }

  renderStatus() {
    if (this.status.dataset.locked === "true") return;
    const outcome = this.state.lastOutcome;
    const validation = flattenRigHierarchy(this.state.document, this.state.editor).validation;
    const source = this.state.session?.active?.source;
    this.status.textContent = outcome?.status === "rejected"
      ? outcome.error?.message ?? "Rig operation rejected"
      : `${source?.fileName ?? "No GLB"} · revision ${this.state.document.revision} · ${validation.errors.length} error(s), ${validation.warnings.length} warning(s)`;
    this.status.dataset.tone = outcome?.status === "rejected" || validation.errors.length ? "error" : validation.warnings.length ? "warning" : "ready";
  }

  setStatus(message, tone = "info") {
    this.status.textContent = String(message ?? "");
    if (tone === "error" || tone === "warning") this.announce(message);
    this.status.dataset.tone = tone;
    this.status.dataset.locked = "true";
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => {
      delete this.status.dataset.locked;
      this.renderStatus();
    }, 3500);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.statusTimer);
    clearTimeout(this.moveCommitTimer);
    this.moveKeys.clear();
    this.moveTransaction = null;
    this.abort.abort();
    this.renderer?.destroy?.();
    this.autosave?.destroy();
    if (this.ownsAssetHost) this.assetHost.destroy();
    this.root.replaceChildren();
  }
}

export function createRiggingWorkspaceHost(options = {}) {
  return ({ root, model, dispatch, services }) => new RiggingWorkspace(root, {
    ...options,
    initialState: valueState(model),
    dispatch,
    assetHost: options.assetHost ?? services?.rigging?.assetHost,
    createRenderer: options.createRenderer ?? services?.rigging?.createRenderer,
    workfileStorage: options.workfileStorage ?? services?.rigging?.workfileStorage,
  });
}

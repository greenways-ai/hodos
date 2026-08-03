const SURFACE_ID = /^[A-Za-z0-9_.\/-]+$/;
const PRESENTATIONS = new Set(["focus-overlay", "overlay", "panel", "modal"]);

function surfaceId(value) {
  const id = String(value || "");
  if (!SURFACE_ID.test(id)) throw new Error("Surface id is invalid");
  return id;
}

export class SurfaceRegistry {
  constructor(entries = {}) {
    this.factories = new Map();
    const source = entries instanceof Map ? entries.entries() : Object.entries(entries);
    for (const [id, factory] of source) this.register(id, factory);
  }

  register(id, factory) {
    const key = surfaceId(id);
    if (typeof factory !== "function") throw new Error(`Surface ${key} requires a factory function`);
    if (this.factories.has(key)) throw new Error(`Surface ${key} is already registered`);
    this.factories.set(key, factory);
    return () => this.factories.delete(key);
  }

  has(id) {
    return this.factories.has(String(id));
  }

  create(id, context) {
    const key = surfaceId(id);
    const factory = this.factories.get(key);
    if (!factory) throw new Error(`Surface ${key} is not installed in this Hodos host`);
    return factory(context) ?? {};
  }

  ids() {
    return [...this.factories.keys()];
  }
}

export class SurfaceHost {
  constructor(root, { registry = new SurfaceRegistry() } = {}) {
    if (!root) throw new Error("SurfaceHost requires a root element");
    this.root = root;
    this.registry = registry;
    this.controller = null;
    this.descriptor = null;
    this.dispatch = null;
  }

  open(descriptor, { dispatch } = {}) {
    const id = surfaceId(descriptor?.id);
    const presentation = PRESENTATIONS.has(descriptor?.presentation)
      ? descriptor.presentation
      : "focus-overlay";
    this.close();
    this.descriptor = { ...descriptor, id, presentation };
    this.dispatch = dispatch;

    const document = this.root.ownerDocument ?? globalThis.document;
    if (!document) throw new Error("SurfaceHost requires a DOM document");
    const frame = document.createElement("section");
    frame.className = `hodos-surface-frame hodos-surface-frame--${presentation}`;
    frame.setAttribute("role", presentation === "modal" ? "dialog" : "region");
    frame.setAttribute("aria-label", this.descriptor.title || id);

    const header = document.createElement("header");
    header.className = "hodos-surface-header";
    const identity = document.createElement("div");
    identity.className = "hodos-surface-identity";
    const eyebrow = document.createElement("span");
    eyebrow.textContent = "HODOS SURFACE";
    const title = document.createElement("strong");
    title.textContent = this.descriptor.title || id;
    identity.append(eyebrow, title);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "hodos-surface-close";
    close.textContent = "Return to world";
    close.addEventListener("click", () => {
      if (this.dispatch) this.dispatch({ "event/type": "surface/close" });
      else this.close();
    });
    header.append(identity, close);

    const content = document.createElement("div");
    content.className = "hodos-surface-content";
    frame.append(header, content);
    this.root.replaceChildren(frame);
    this.root.hidden = false;
    this.root.dataset.presentation = presentation;

    this.controller = this.registry.create(id, {
      root: content,
      descriptor: this.descriptor,
      dispatch: (event) => this.dispatch?.(event),
      requestClose: () => close.click(),
    });
    return this.controller;
  }

  update(state) {
    this.controller?.update?.(state);
  }

  handleEffect(effect) {
    return this.controller?.handleEffect?.(effect);
  }

  close() {
    this.controller?.destroy?.();
    this.controller = null;
    this.descriptor = null;
    this.dispatch = null;
    this.root.replaceChildren();
    this.root.hidden = true;
    delete this.root.dataset.presentation;
  }

  destroy() {
    this.close();
  }
}

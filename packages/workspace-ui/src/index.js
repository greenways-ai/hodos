import {
  HodosComponentHost,
  HodosComponentRegistry,
  normalizeComponentDescriptor,
} from "@greenways/hodos-web";

const nonEmptyString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
};

const field = (value, names) => {
  for (const name of names) if (Object.hasOwn(value, name)) return value[name];
  return undefined;
};

export const HODOS_WORKSPACE_AREA_CONTRACT = "hodos.workspace-area/1";

export function normalizeWorkspaceArea(value, label = "Hodos Workspace area") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const id = nonEmptyString(field(value, ["area/id", "id"]), `${label} id`);
  const type = nonEmptyString(field(value, ["area/type", "type"]), `${label} type`);
  const title = field(value, ["area/title", "title"]);
  const component = normalizeComponentDescriptor(field(value, ["area/component", "component"]), `${label} component`);
  return Object.freeze({
    id,
    type,
    title: title == null ? id : nonEmptyString(title, `${label} title`),
    component,
  });
}

export class WorkspaceAreaHost {
  #area = null;
  #destroyed = false;

  constructor({ root, registry, dispatch, services } = {}) {
    if (!(registry instanceof HodosComponentRegistry)) {
      throw new TypeError("Workspace area host requires a HodosComponentRegistry");
    }
    this.root = root;
    this.componentHost = new HodosComponentHost({
      root,
      registry,
      services,
      dispatch: (event, meta) => {
        const payload = typeof event === "string" ? { "event/type": event } : { ...event };
        if (this.#area && !Object.hasOwn(payload, "area/id")) payload["area/id"] = this.#area.id;
        return dispatch?.(payload, { ...meta, area: this.#area });
      },
    });
  }

  open(value, context = {}) {
    this.#assertActive();
    const area = normalizeWorkspaceArea(value);
    this.#area = area;
    if (this.root?.dataset) {
      this.root.dataset.areaId = area.id;
      this.root.dataset.areaType = area.type;
    }
    this.componentHost.mount(area.component, { ...context, area });
    return this;
  }

  update(value, context = {}) {
    this.#assertActive();
    const area = normalizeWorkspaceArea(value);
    if (!this.#area || area.id !== this.#area.id) return this.open(area, context);
    this.#area = area;
    this.componentHost.update(area.component, { ...context, area });
    return this;
  }

  current() {
    return this.#area;
  }

  close() {
    this.#assertActive();
    this.componentHost.clear();
    this.#area = null;
    if (this.root?.dataset) {
      delete this.root.dataset.areaId;
      delete this.root.dataset.areaType;
    }
  }

  destroy() {
    if (this.#destroyed) return;
    this.componentHost.destroy();
    this.#area = null;
    this.#destroyed = true;
  }

  #assertActive() {
    if (this.#destroyed) throw new Error("Workspace area host is destroyed");
  }
}

export const createWorkspaceAreaHost = (options) => new WorkspaceAreaHost(options);

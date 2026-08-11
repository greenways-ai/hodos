import {
  HodosComponentHost,
  HodosComponentRegistry,
  normalizeComponentDescriptor,
} from "@greenways/hodos-web";

const field = (value, names) => {
  for (const name of names) if (Object.hasOwn(value, name)) return value[name];
  return undefined;
};

const objectValue = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
};

const tokenValue = (value, label) => {
  if (typeof value === "string" && value.trim()) return value.trim().replace(/^:/, "");
  if (value?.name && typeof value.name === "string" && value.name.trim()) {
    return value.name.trim().replace(/^:/, "");
  }
  throw new TypeError(`${label} must be a non-empty string or keyword-like token`);
};

const optionalToken = (value, label) => value == null ? null : tokenValue(value, label);

const stringValue = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
};

const optionalString = (value, label) => value == null ? null : stringValue(value, label);

const booleanValue = (value, fallback, label) => {
  if (value == null) return fallback;
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
  return value;
};

const integerValue = (value, fallback, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) => {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return number;
};

const ratioValue = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number >= 1) {
    throw new TypeError(`${label} must be a finite number between 0 and 1`);
  }
  return number;
};

const clampRatio = (value) => Math.max(0.08, Math.min(0.92, Number(value) || 0.5));

const classAdd = (node, ...names) => node?.classList?.add?.(...names.filter(Boolean));
const classRemove = (node, ...names) => node?.classList?.remove?.(...names.filter(Boolean));

const setDataset = (node, key, value) => {
  if (!node?.dataset) return;
  if (value == null || value === "") delete node.dataset[key];
  else node.dataset[key] = String(value);
};

const setStyle = (node, key, value) => {
  if (!node?.style) return;
  node.style[key] = value;
};

const areaPresentationValue = (value, title, label) => {
  const input = value == null ? {} : objectValue(value, label);
  return Object.freeze({
    label: optionalString(field(input, ["presentation/label", "label"]), `${label} label`) ?? title,
    icon: optionalToken(field(input, ["presentation/icon", "icon"]), `${label} icon`),
    role: optionalToken(field(input, ["presentation/role", "role"]), `${label} role`),
    surfaceId: optionalToken(field(input, ["presentation/surface", "surfaceId"]), `${label} surface id`),
    mode: optionalToken(field(input, ["presentation/mode", "mode"]), `${label} mode`),
    order: integerValue(field(input, ["presentation/order", "order"]), 0, `${label} order`, {
      minimum: -1000,
      maximum: 1000,
    }),
    compact: booleanValue(field(input, ["presentation/compact", "compact"]), true, `${label} compact`),
    autoFocus: booleanValue(
      field(input, ["presentation/auto-focus", "autoFocus"]),
      false,
      `${label} auto focus`,
    ),
  });
};

export function normalizeWorkspaceShellArea(value, label = "Hodos Workspace shell area") {
  const input = objectValue(value, label);
  const id = tokenValue(field(input, ["area/id", "id"]), `${label} id`);
  const type = tokenValue(field(input, ["area/type", "type"]), `${label} type`);
  const title = optionalString(field(input, ["area/title", "title"]), `${label} title`) ?? id;
  const rawComponent = field(input, ["area/component", "component"]);
  return Object.freeze({
    id,
    type,
    title,
    component: rawComponent == null
      ? null
      : normalizeComponentDescriptor(rawComponent, `${label} component`),
    presentation: areaPresentationValue(
      field(input, ["area/presentation", "presentation"]),
      title,
      `${label} presentation`,
    ),
  });
}

export function normalizeWorkspaceLayout(value, {
  areaIds = new Set(),
  label = "Hodos Workspace layout",
  path = "root",
} = {}) {
  const input = objectValue(value, label);
  const type = tokenValue(field(input, ["layout/type", "type"]), `${label} type`);
  const id = optionalToken(field(input, ["layout/id", "id"]), `${label} id`) ?? `layout/${path}`;

  if (type === "empty") return Object.freeze({ id, type });

  if (type === "area") {
    const areaId = tokenValue(field(input, ["layout/area", "areaId", "area"]), `${label} area`);
    if (!areaIds.has(areaId)) throw new Error(`${label} references missing area: ${areaId}`);
    return Object.freeze({ id, type, areaId });
  }

  if (type !== "split") throw new Error(`${label} has unsupported type: ${type}`);
  const direction = tokenValue(
    field(input, ["layout/direction", "direction"]),
    `${label} direction`,
  );
  if (!new Set(["horizontal", "vertical"]).has(direction)) {
    throw new Error(`${label} has unsupported direction: ${direction}`);
  }
  const ratio = ratioValue(field(input, ["layout/ratio", "ratio"]), `${label} ratio`);
  const first = normalizeWorkspaceLayout(field(input, ["layout/first", "first"]), {
    areaIds,
    label: `${label} first`,
    path: `${path}/first`,
  });
  const second = normalizeWorkspaceLayout(field(input, ["layout/second", "second"]), {
    areaIds,
    label: `${label} second`,
    path: `${path}/second`,
  });
  return Object.freeze({ id, type, direction, ratio, first, second });
}

export function workspaceLayoutAreaIds(layout, output = []) {
  if (!layout || typeof layout !== "object") return output;
  if (layout.type === "area") output.push(layout.areaId);
  if (layout.type === "split") {
    workspaceLayoutAreaIds(layout.first, output);
    workspaceLayoutAreaIds(layout.second, output);
  }
  return output;
}

const responsiveSurfaceValue = (value, index, areaById) => {
  const label = `Hodos Workspace responsive surface ${index}`;
  const input = objectValue(value, label);
  const id = tokenValue(field(input, ["surface/id", "id"]), `${label} id`);
  const areaId = tokenValue(field(input, ["surface/area", "areaId", "area"]), `${label} area`);
  const area = areaById.get(areaId);
  if (!area) throw new Error(`${label} references missing area: ${areaId}`);
  return Object.freeze({
    id,
    areaId,
    label: optionalString(field(input, ["surface/label", "label"]), `${label} label`)
      ?? area.presentation.label,
    icon: optionalToken(field(input, ["surface/icon", "icon"]), `${label} icon`)
      ?? area.presentation.icon,
    mode: optionalToken(field(input, ["surface/mode", "mode"]), `${label} mode`)
      ?? area.presentation.mode,
    order: integerValue(field(input, ["surface/order", "order"]), index, `${label} order`, {
      minimum: -1000,
      maximum: 1000,
    }),
    autoFocus: booleanValue(
      field(input, ["surface/auto-focus", "autoFocus"]),
      area.presentation.autoFocus,
      `${label} auto focus`,
    ),
  });
};

const derivedResponsiveSurfaces = (areas, layoutIds) => areas
  .filter((area) => area.presentation.compact)
  .map((area, index) => {
    const layoutIndex = layoutIds.indexOf(area.id);
    const order = area.presentation.order !== 0
      ? area.presentation.order
      : layoutIndex >= 0 ? layoutIndex : index;
    return Object.freeze({
      id: area.presentation.surfaceId ?? area.id,
      areaId: area.id,
      label: area.presentation.label,
      icon: area.presentation.icon,
      mode: area.presentation.mode,
      order,
      autoFocus: area.presentation.autoFocus,
    });
  })
  .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));

const normalizeResponsive = (customizations, areas, layoutIds) => {
  const areaById = new Map(areas.map((area) => [area.id, area]));
  const raw = field(customizations, ["responsive/surfaces", "surfaces"]);
  if (raw != null && !Array.isArray(raw)) {
    throw new TypeError("Hodos Workspace responsive surfaces must be an array");
  }
  const surfaces = raw != null
    ? raw.map((surface, index) => responsiveSurfaceValue(surface, index, areaById))
      .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label))
    : derivedResponsiveSurfaces(areas, layoutIds);
  const surfaceIds = new Set();
  for (const surface of surfaces) {
    if (surfaceIds.has(surface.id)) throw new Error(`Duplicate Hodos Workspace surface id: ${surface.id}`);
    surfaceIds.add(surface.id);
  }
  const defaultSurfaceId = optionalToken(
    field(customizations, ["responsive/default-surface", "defaultSurfaceId"]),
    "Hodos Workspace default responsive surface",
  ) ?? surfaces[0]?.id ?? null;
  if (defaultSurfaceId && !surfaceIds.has(defaultSurfaceId)) {
    throw new Error(`Hodos Workspace default responsive surface is missing: ${defaultSurfaceId}`);
  }
  return Object.freeze({
    breakpoint: integerValue(
      field(customizations, ["responsive/breakpoint", "breakpoint"]),
      1000,
      "Hodos Workspace responsive breakpoint",
      { minimum: 320, maximum: 2400 },
    ),
    defaultSurfaceId,
    surfaces: Object.freeze(surfaces),
  });
};

const normalizeSelection = (value, areaIds, surfaceIds, fallbackAreaId, fallbackSurfaceId) => {
  const input = value == null ? {} : objectValue(value, "Hodos Workspace selection");
  const areaId = optionalToken(field(input, ["area/id", "areaId"]), "Hodos Workspace selected area")
    ?? fallbackAreaId
    ?? null;
  if (areaId && !areaIds.has(areaId)) throw new Error(`Hodos Workspace selected area is missing: ${areaId}`);
  const surfaceId = optionalToken(
    field(input, ["surface/id", "surfaceId"]),
    "Hodos Workspace selected surface",
  ) ?? fallbackSurfaceId ?? null;
  if (surfaceId && !surfaceIds.has(surfaceId)) {
    throw new Error(`Hodos Workspace selected surface is missing: ${surfaceId}`);
  }
  return Object.freeze({ areaId, surfaceId });
};

export function normalizeWorkspaceDescriptor(value, label = "Hodos Workspace") {
  const input = objectValue(value, label);
  const id = tokenValue(field(input, ["workspace/id", "id"]), `${label} id`);
  const rawAreas = field(input, ["workspace/areas", "areas"]) ?? [];
  if (!Array.isArray(rawAreas)) throw new TypeError(`${label} areas must be an array`);
  const areas = rawAreas.map((area, index) => normalizeWorkspaceShellArea(area, `${label} area ${index}`));
  const areaIds = new Set();
  for (const area of areas) {
    if (areaIds.has(area.id)) throw new Error(`Duplicate Hodos Workspace area id: ${area.id}`);
    areaIds.add(area.id);
  }
  const layout = normalizeWorkspaceLayout(field(input, ["workspace/layout", "layout"]), { areaIds });
  const layoutIds = workspaceLayoutAreaIds(layout, []);
  if (new Set(layoutIds).size !== layoutIds.length) {
    throw new Error("Hodos Workspace layout must not reference an area more than once");
  }
  const rawCustomizations = field(input, ["workspace/customizations", "customizations"]);
  const customizations = rawCustomizations == null
    ? {}
    : objectValue(rawCustomizations, `${label} customizations`);
  const responsive = normalizeResponsive(customizations, areas, layoutIds);
  const surfaceIds = new Set(responsive.surfaces.map((surface) => surface.id));
  const fallbackAreaId = layoutIds[0] ?? areas[0]?.id ?? null;
  const selection = normalizeSelection(
    field(input, ["workspace/selection", "selection"]),
    areaIds,
    surfaceIds,
    fallbackAreaId,
    null,
  );
  return Object.freeze({
    id,
    revision: integerValue(
      field(input, ["workspace/revision", "revision"]),
      0,
      `${label} revision`,
    ),
    layout,
    areas: Object.freeze(areas),
    areaById: new Map(areas.map((area) => [area.id, area])),
    layoutAreaIds: Object.freeze(layoutIds),
    selection,
    responsive,
    customizations: Object.freeze({ ...customizations }),
  });
}

const createElement = (document, tag, className = "") => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
};

const append = (parent, ...children) => {
  if (typeof parent.append === "function") parent.append(...children);
  else for (const child of children) parent.appendChild(child);
};

const replaceChildren = (parent, ...children) => {
  if (typeof parent.replaceChildren === "function") parent.replaceChildren(...children);
  else {
    while (parent.firstChild) parent.removeChild(parent.firstChild);
    append(parent, ...children);
  }
};

const safeCall = (candidate, ...args) => {
  if (typeof candidate !== "function") return undefined;
  try {
    return candidate(...args);
  } catch (error) {
    return Promise.reject(error);
  }
};

export const HODOS_WORKSPACE_SHELL_CONTRACT = "hodos.workspace-shell/0-alpha";
export const HODOS_WORKSPACE_MODES = Object.freeze(["auto", "desktop", "compact"]);

export class WorkspaceShellHost {
  constructor({
    root,
    registry,
    dispatch = async () => undefined,
    services = {},
    document = root?.ownerDocument ?? globalThis.document,
    matchMedia = globalThis.matchMedia?.bind(globalThis),
    resolveAreaRoot = null,
    createAreaRoot = null,
    mode = "auto",
  } = {}) {
    if (!root) throw new Error("Workspace shell host requires a root");
    if (!(registry instanceof HodosComponentRegistry)) {
      throw new TypeError("Workspace shell host requires a HodosComponentRegistry");
    }
    if (typeof dispatch !== "function") throw new TypeError("Workspace shell dispatch must be a function");
    if (!document || typeof document.createElement !== "function") {
      throw new TypeError("Workspace shell host requires a DOM-like document");
    }
    if (resolveAreaRoot != null && typeof resolveAreaRoot !== "function") {
      throw new TypeError("Workspace shell resolveAreaRoot must be a function");
    }
    if (createAreaRoot != null && typeof createAreaRoot !== "function") {
      throw new TypeError("Workspace shell createAreaRoot must be a function");
    }
    this.root = root;
    this.registry = registry;
    this.dispatch = dispatch;
    this.services = services && typeof services === "object" ? services : {};
    this.document = document;
    this.matchMedia = matchMedia;
    this.resolveAreaRoot = resolveAreaRoot;
    this.createAreaRoot = createAreaRoot;
    this.mode = this.#normalizeMode(mode);
    this.viewportWidth = null;
    this.workspace = null;
    this.context = {};
    this.records = new Map();
    this.ratioOverrides = new Map();
    this.loadedRatioPreferences = new Set();
    this.surfaceId = null;
    this.preferenceLoadedFor = null;
    this.media = null;
    this.mediaQuery = null;
    this.mediaListener = () => this.#render();
    this.destroyed = false;
    this.lastSelectionAreaId = null;
  }

  mount(value, context = {}) {
    this.#assertActive();
    const next = normalizeWorkspaceDescriptor(value);
    this.#adoptSelection(next);
    this.workspace = next;
    this.context = context;
    this.#syncAreas();
    this.#bindMedia();
    this.#loadSurfacePreference();
    this.#render();
    return this;
  }

  update(value, context = {}) {
    return this.mount(value, context);
  }

  setMode(mode) {
    this.#assertActive();
    this.mode = this.#normalizeMode(mode);
    this.#render();
    return this;
  }

  setViewportWidth(width) {
    this.#assertActive();
    if (width == null) this.viewportWidth = null;
    else {
      const number = Number(width);
      if (!Number.isFinite(number) || number <= 0) {
        throw new TypeError("Workspace shell viewport width must be a positive number");
      }
      this.viewportWidth = number;
    }
    this.#render();
    return this;
  }

  setSplitRatio(layoutId, ratio, { persist = true } = {}) {
    this.#assertActive();
    layoutId = tokenValue(layoutId, "Workspace split layout id");
    ratio = clampRatio(ratio);
    this.ratioOverrides.set(layoutId, ratio);
    if (persist) this.#persistRatio(layoutId, ratio);
    this.#render();
    return ratio;
  }

  selectSurface(surfaceId, { dispatch = true, focus = false } = {}) {
    this.#assertActive();
    if (!this.workspace) throw new Error("Workspace shell has no mounted Workspace");
    surfaceId = tokenValue(surfaceId, "Workspace responsive surface id");
    const surface = this.workspace.responsive.surfaces.find((entry) => entry.id === surfaceId);
    if (!surface) throw new Error(`Workspace responsive surface is missing: ${surfaceId}`);
    this.surfaceId = surface.id;
    this.#persistSurface(surface.id);
    this.#render();
    if (dispatch) this.#dispatchSelection(surface);
    if (focus || surface.autoFocus) this.#focusSurface(surface);
    return surface;
  }

  current() {
    return this.workspace;
  }

  currentMode() {
    return this.#effectiveMode();
  }

  currentSurface() {
    return this.#activeSurface();
  }

  destroy() {
    if (this.destroyed) return;
    this.#unbindMedia();
    replaceChildren(this.root);
    const records = [...this.records.values()].sort((left, right) => left.order - right.order);
    for (const record of records) {
      record.componentHost?.destroy();
      if (record.adopted && record.originalParent) {
        if (record.originalNext?.parentNode === record.originalParent && record.originalParent.insertBefore) {
          record.originalParent.insertBefore(record.root, record.originalNext);
        } else append(record.originalParent, record.root);
      } else record.root.remove?.();
    }
    this.records.clear();
    this.workspace = null;
    classRemove(this.root, "hodos-workspace-shell", "hodos-workspace-shell--desktop", "hodos-workspace-shell--compact");
    for (const key of ["workspaceId", "workspaceMode", "workspaceAreaId", "workspaceSurfaceId"]) {
      if (this.root.dataset) delete this.root.dataset[key];
    }
    this.destroyed = true;
  }

  #normalizeMode(mode) {
    mode = tokenValue(mode, "Workspace shell mode");
    if (!HODOS_WORKSPACE_MODES.includes(mode)) throw new Error(`Unsupported Workspace shell mode: ${mode}`);
    return mode;
  }

  #assertActive() {
    if (this.destroyed) throw new Error("Workspace shell host is destroyed");
  }

  #workspaceService() {
    return this.services.workspaceShell && typeof this.services.workspaceShell === "object"
      ? this.services.workspaceShell
      : {};
  }

  #adoptSelection(next) {
    const workspaceChanged = this.workspace?.id !== next.id;
    if (workspaceChanged) {
      this.surfaceId = next.selection.surfaceId ?? null;
      this.preferenceLoadedFor = null;
      this.ratioOverrides.clear();
      this.loadedRatioPreferences.clear();
    } else if (next.selection.surfaceId) this.surfaceId = next.selection.surfaceId;
    else if (this.lastSelectionAreaId && this.lastSelectionAreaId !== next.selection.areaId) {
      this.surfaceId = next.responsive.surfaces.find((surface) =>
        surface.areaId === next.selection.areaId)?.id ?? next.responsive.defaultSurfaceId;
    }
    if (this.surfaceId && !next.responsive.surfaces.some((surface) => surface.id === this.surfaceId)) {
      this.surfaceId = null;
    }
    this.lastSelectionAreaId = next.selection.areaId;
  }

  #loadSurfacePreference() {
    if (!this.workspace || this.preferenceLoadedFor === this.workspace.id || this.surfaceId) return;
    const workspaceId = this.workspace.id;
    this.preferenceLoadedFor = workspaceId;
    let preferred;
    try {
      preferred = this.#workspaceService().readSurface?.({
        workspaceId,
        surfaces: this.workspace.responsive.surfaces,
      });
    } catch (error) {
      this.#reportError(error);
      return;
    }
    const apply = (surfaceId) => {
      if (this.workspace?.id !== workspaceId) return;
      if (typeof surfaceId === "string"
        && this.workspace.responsive.surfaces.some((entry) => entry.id === surfaceId)) {
        this.surfaceId = surfaceId;
        this.#render();
      }
    };
    if (preferred?.then) Promise.resolve(preferred).then(apply).catch((error) => this.#reportError(error));
    else if (preferred != null) apply(preferred);
  }

  #persistSurface(surfaceId) {
    const promise = safeCall(this.#workspaceService().writeSurface, {
      workspaceId: this.workspace?.id,
      surfaceId,
    });
    Promise.resolve(promise).catch((error) => this.#reportError(error));
  }

  #persistRatio(layoutId, ratio) {
    const promise = safeCall(this.#workspaceService().writeSplitRatio, {
      workspaceId: this.workspace?.id,
      layoutId,
      ratio,
    });
    Promise.resolve(promise).catch((error) => this.#reportError(error));
  }

  #ratioFor(layout) {
    if (this.ratioOverrides.has(layout.id)) return this.ratioOverrides.get(layout.id);
    if (!this.loadedRatioPreferences.has(layout.id)) {
      this.loadedRatioPreferences.add(layout.id);
      const workspaceId = this.workspace?.id;
      let preferred;
      try {
        preferred = this.#workspaceService().readSplitRatio?.({
          workspaceId,
          layoutId: layout.id,
          ratio: layout.ratio,
        });
      } catch (error) {
        this.#reportError(error);
        return layout.ratio;
      }
      const apply = (value) => {
        if (this.workspace?.id !== workspaceId || !Number.isFinite(Number(value))) return;
        this.ratioOverrides.set(layout.id, clampRatio(value));
        this.#render();
      };
      if (preferred?.then) Promise.resolve(preferred).then(apply).catch((error) => this.#reportError(error));
      else if (Number.isFinite(Number(preferred))) {
        const ratio = clampRatio(preferred);
        this.ratioOverrides.set(layout.id, ratio);
        return ratio;
      }
    }
    return layout.ratio;
  }

  #syncAreas() {
    const nextIds = new Set(this.workspace.areas.map((area) => area.id));
    for (const [id, record] of this.records) {
      if (!nextIds.has(id)) {
        record.componentHost?.destroy();
        if (record.adopted && record.originalParent) append(record.originalParent, record.root);
        else record.root.remove?.();
        this.records.delete(id);
      }
    }

    const claimedRoots = new Set();
    for (let index = 0; index < this.workspace.areas.length; index += 1) {
      const area = this.workspace.areas[index];
      let record = this.records.get(area.id);
      if (!record) {
        let areaRoot = this.resolveAreaRoot?.(area, this.workspace, this.context) ?? null;
        const adopted = Boolean(areaRoot);
        if (!areaRoot) {
          areaRoot = this.createAreaRoot?.(area, this.workspace, this.context)
            ?? createElement(this.document, "section", "hodos-workspace-area");
        }
        if (!areaRoot || typeof areaRoot !== "object") {
          throw new TypeError(`Workspace shell area root is invalid: ${area.id}`);
        }
        if (claimedRoots.has(areaRoot) || [...this.records.values()].some((entry) => entry.root === areaRoot)) {
          throw new Error(`Workspace shell area roots must be unique: ${area.id}`);
        }
        claimedRoots.add(areaRoot);
        record = {
          id: area.id,
          root: areaRoot,
          adopted,
          originalParent: adopted ? areaRoot.parentNode ?? null : null,
          originalNext: adopted ? areaRoot.nextSibling ?? null : null,
          order: index,
          componentHost: null,
        };
        this.records.set(area.id, record);
      }
      record.order = index;
      record.area = area;
      classAdd(record.root, "hodos-workspace-area");
      setDataset(record.root, "workspaceAreaId", area.id);
      setDataset(record.root, "workspaceAreaType", area.type);
      setDataset(record.root, "workspaceAreaRole", area.presentation.role);
      record.root.setAttribute?.("aria-label", area.presentation.label || area.title);
      if (area.component) {
        if (!record.componentHost) {
          record.componentHost = new HodosComponentHost({
            root: record.root,
            registry: this.registry,
            services: this.services,
            dispatch: (event, meta) => {
              const currentArea = record.area;
              const payload = typeof event === "string" ? { "event/type": event } : { ...event };
              if (!Object.hasOwn(payload, "area/id")) payload["area/id"] = currentArea.id;
              if (!Object.hasOwn(payload, "workspace/id")) payload["workspace/id"] = this.workspace.id;
              return this.dispatch(payload, { ...meta, workspace: this.workspace, area: currentArea });
            },
          });
          record.componentHost.mount(area.component, { ...this.context, workspace: this.workspace, area });
        } else record.componentHost.update(area.component, { ...this.context, workspace: this.workspace, area });
      } else if (record.componentHost) {
        record.componentHost.destroy();
        record.componentHost = null;
      }
    }
  }

  #bindMedia() {
    if (!this.workspace || this.mode !== "auto" || typeof this.matchMedia !== "function") {
      this.#unbindMedia();
      return;
    }
    const query = `(max-width: ${this.workspace.responsive.breakpoint}px)`;
    if (this.media && this.mediaQuery === query) return;
    this.#unbindMedia();
    this.mediaQuery = query;
    this.media = this.matchMedia(query);
    if (typeof this.media?.addEventListener === "function") {
      this.media.addEventListener("change", this.mediaListener);
    } else this.media?.addListener?.(this.mediaListener);
  }

  #unbindMedia() {
    if (typeof this.media?.removeEventListener === "function") {
      this.media.removeEventListener("change", this.mediaListener);
    } else this.media?.removeListener?.(this.mediaListener);
    this.media = null;
    this.mediaQuery = null;
  }

  #effectiveMode() {
    if (this.mode === "desktop" || this.mode === "compact") return this.mode;
    if (this.viewportWidth != null && this.workspace) {
      return this.viewportWidth <= this.workspace.responsive.breakpoint ? "compact" : "desktop";
    }
    return this.media?.matches ? "compact" : "desktop";
  }

  #activeSurface() {
    if (!this.workspace) return null;
    const surfaces = this.workspace.responsive.surfaces;
    const selected = surfaces.find((surface) => surface.id === this.surfaceId);
    if (selected) return selected;
    const areaSurface = surfaces.find((surface) => surface.areaId === this.workspace.selection.areaId);
    return areaSurface
      ?? surfaces.find((surface) => surface.id === this.workspace.responsive.defaultSurfaceId)
      ?? surfaces[0]
      ?? null;
  }

  #render() {
    if (!this.workspace || this.destroyed) return;
    replaceChildren(this.root);
    classAdd(this.root, "hodos-workspace-shell");
    const mode = this.#effectiveMode();
    classRemove(this.root, "hodos-workspace-shell--desktop", "hodos-workspace-shell--compact");
    classAdd(this.root, `hodos-workspace-shell--${mode}`);
    setDataset(this.root, "workspaceId", this.workspace.id);
    setDataset(this.root, "workspaceMode", mode);

    if (mode === "compact") this.#renderCompact();
    else this.#renderDesktop();

    const promise = safeCall(this.#workspaceService().afterRender, {
      root: this.root,
      workspace: this.workspace,
      mode,
      surface: this.#activeSurface(),
    });
    Promise.resolve(promise).catch((error) => this.#reportError(error));
  }

  #renderDesktop() {
    const layoutRoot = createElement(this.document, "div", "hodos-workspace-layout");
    const node = this.#buildLayout(this.workspace.layout);
    append(layoutRoot, node);
    append(this.root, layoutRoot);
    setDataset(this.root, "workspaceAreaId", this.workspace.selection.areaId);
    setDataset(this.root, "workspaceSurfaceId", null);
  }

  #buildLayout(layout) {
    if (layout.type === "empty") {
      const empty = createElement(this.document, "div", "hodos-workspace-empty");
      empty.setAttribute?.("aria-hidden", "true");
      return empty;
    }
    if (layout.type === "area") {
      const record = this.records.get(layout.areaId);
      if (!record) throw new Error(`Workspace shell cannot resolve area root: ${layout.areaId}`);
      setStyle(record.root, "minWidth", "0");
      setStyle(record.root, "minHeight", "0");
      record.root.hidden = false;
      return record.root;
    }

    const split = createElement(
      this.document,
      "div",
      `hodos-workspace-split hodos-workspace-split--${layout.direction}`,
    );
    setDataset(split, "layoutId", layout.id);
    setDataset(split, "layoutDirection", layout.direction);
    const first = createElement(this.document, "div", "hodos-workspace-pane hodos-workspace-pane--first");
    const second = createElement(this.document, "div", "hodos-workspace-pane hodos-workspace-pane--second");
    append(first, this.#buildLayout(layout.first));
    append(second, this.#buildLayout(layout.second));
    const divider = this.#createDivider(split, layout);
    append(split, first, divider, second);
    this.#applySplitGrid(split, layout.direction, this.#ratioFor(layout));
    return split;
  }

  #applySplitGrid(split, direction, ratio) {
    ratio = clampRatio(ratio);
    setStyle(split, "display", "grid");
    setStyle(split, "minWidth", "0");
    setStyle(split, "minHeight", "0");
    if (direction === "horizontal") {
      setStyle(split, "gridTemplateColumns", `${ratio}fr 8px ${1 - ratio}fr`);
      setStyle(split, "gridTemplateRows", "minmax(0, 1fr)");
    } else {
      setStyle(split, "gridTemplateColumns", "minmax(0, 1fr)");
      setStyle(split, "gridTemplateRows", `${ratio}fr 8px ${1 - ratio}fr`);
    }
    setDataset(split, "layoutRatio", ratio.toFixed(4));
  }

  #createDivider(split, layout) {
    const divider = createElement(
      this.document,
      "div",
      `hodos-workspace-divider hodos-workspace-divider--${layout.direction}`,
    );
    divider.tabIndex = 0;
    divider.setAttribute?.("role", "separator");
    divider.setAttribute?.(
      "aria-orientation",
      layout.direction === "horizontal" ? "vertical" : "horizontal",
    );
    divider.setAttribute?.("aria-label", "Resize Workspace areas");
    const updateAria = (ratio) => {
      divider.setAttribute?.("aria-valuemin", "8");
      divider.setAttribute?.("aria-valuemax", "92");
      divider.setAttribute?.("aria-valuenow", String(Math.round(ratio * 100)));
    };
    updateAria(this.#ratioFor(layout));

    const update = (ratio, persist = false) => {
      ratio = clampRatio(ratio);
      this.ratioOverrides.set(layout.id, ratio);
      this.#applySplitGrid(split, layout.direction, ratio);
      updateAria(ratio);
      if (persist) this.#persistRatio(layout.id, ratio);
    };

    divider.addEventListener?.("keydown", (event) => {
      const allowed = layout.direction === "horizontal"
        ? new Set(["ArrowLeft", "ArrowRight", "Home"])
        : new Set(["ArrowUp", "ArrowDown", "Home"]);
      if (!allowed.has(event.key)) return;
      event.preventDefault?.();
      if (event.key === "Home") {
        update(layout.ratio, true);
        return;
      }
      const increase = event.key === "ArrowRight" || event.key === "ArrowDown";
      update(this.#ratioFor(layout) + (increase ? 0.02 : -0.02), true);
    });

    divider.addEventListener?.("pointerdown", (event) => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault?.();
      const start = layout.direction === "horizontal" ? event.clientX : event.clientY;
      const rect = split.getBoundingClientRect?.() ?? { width: 1, height: 1 };
      const size = Math.max(1, layout.direction === "horizontal" ? rect.width : rect.height);
      const initial = this.#ratioFor(layout);
      divider.setPointerCapture?.(event.pointerId);
      const move = (next) => {
        const current = layout.direction === "horizontal" ? next.clientX : next.clientY;
        update(initial + (current - start) / size, false);
      };
      const finish = (next) => {
        divider.releasePointerCapture?.(next.pointerId);
        divider.removeEventListener?.("pointermove", move);
        divider.removeEventListener?.("pointerup", finish);
        divider.removeEventListener?.("pointercancel", finish);
        this.#persistRatio(layout.id, this.#ratioFor(layout));
      };
      divider.addEventListener?.("pointermove", move);
      divider.addEventListener?.("pointerup", finish);
      divider.addEventListener?.("pointercancel", finish);
    });
    return divider;
  }

  #renderCompact() {
    const surface = this.#activeSurface();
    const viewport = createElement(this.document, "div", "hodos-workspace-compact-viewport");
    if (surface) {
      this.surfaceId = surface.id;
      const record = this.records.get(surface.areaId);
      if (!record) throw new Error(`Workspace shell cannot resolve compact area: ${surface.areaId}`);
      setDataset(record.root, "workspaceSurfaceId", surface.id);
      setDataset(record.root, "workspaceSurfaceMode", surface.mode);
      record.root.hidden = false;
      append(viewport, record.root);
      setDataset(this.root, "workspaceAreaId", surface.areaId);
      setDataset(this.root, "workspaceSurfaceId", surface.id);
    } else {
      append(viewport, createElement(this.document, "div", "hodos-workspace-empty"));
      setDataset(this.root, "workspaceAreaId", null);
      setDataset(this.root, "workspaceSurfaceId", null);
    }

    const dock = createElement(this.document, "nav", "hodos-workspace-dock");
    dock.setAttribute?.("aria-label", "Workspace surfaces");
    for (const entry of this.workspace.responsive.surfaces) {
      const button = createElement(this.document, "button", "hodos-workspace-dock-item");
      button.type = "button";
      button.textContent = entry.label;
      button.setAttribute?.("aria-label", `Open ${entry.label}`);
      button.setAttribute?.("aria-pressed", String(entry.id === surface?.id));
      setDataset(button, "workspaceSurfaceId", entry.id);
      setDataset(button, "workspaceAreaId", entry.areaId);
      setDataset(button, "workspaceIcon", entry.icon);
      if (entry.id === surface?.id) classAdd(button, "active");
      button.addEventListener?.("click", () => this.selectSurface(entry.id, {
        dispatch: true,
        focus: entry.autoFocus,
      }));
      append(dock, button);
    }
    append(this.root, viewport, dock);
    if (surface) this.#activateSurface(surface);
  }

  #activateSurface(surface) {
    const record = this.records.get(surface.areaId);
    const promise = safeCall(this.#workspaceService().activateSurface, {
      root: this.root,
      areaRoot: record?.root ?? null,
      workspace: this.workspace,
      area: this.workspace.areaById.get(surface.areaId),
      surface,
      mode: "compact",
    });
    Promise.resolve(promise).catch((error) => this.#reportError(error));
  }

  #focusSurface(surface) {
    const record = this.records.get(surface.areaId);
    const candidate = safeCall(this.#workspaceService().focusSurface, {
      root: this.root,
      areaRoot: record?.root ?? null,
      workspace: this.workspace,
      area: this.workspace.areaById.get(surface.areaId),
      surface,
    });
    if (candidate?.focus) candidate.focus({ preventScroll: true });
    Promise.resolve(candidate).catch((error) => this.#reportError(error));
  }

  #dispatchSelection(surface) {
    const event = {
      "event/type": "workspace/area-select",
      "workspace/id": this.workspace.id,
      "area/id": surface.areaId,
      "surface/id": surface.id,
    };
    Promise.resolve(this.dispatch(event, {
      workspace: this.workspace,
      area: this.workspace.areaById.get(surface.areaId),
      surface,
    })).catch((error) => this.#reportError(error));
  }

  #reportError(error) {
    const reporter = this.#workspaceService().reportError;
    if (typeof reporter === "function") reporter(error);
    else if (globalThis.console?.error) console.error("[hodos workspace shell]", error);
  }
}

export const createWorkspaceShellHost = (options) => new WorkspaceShellHost(options);

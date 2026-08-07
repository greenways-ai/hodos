const nonEmptyString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
};

const plainObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
};

const field = (value, names) => {
  for (const name of names) {
    if (Object.hasOwn(value, name)) return value[name];
  }
  return undefined;
};

const eventType = (event) => {
  if (typeof event === "string") return event;
  if (!event || typeof event !== "object") return null;
  return event["event/type"] ?? event.type ?? null;
};

export const HODOS_COMPONENT_CONTRACT = "hodos.component/1";

export function normalizeComponentDescriptor(value, label = "Hodos component descriptor") {
  const input = plainObject(value, label);
  const id = nonEmptyString(field(input, ["component/id", "id"]), `${label} id`);
  const contract = nonEmptyString(
    field(input, ["component/contract", "contract"]) ?? HODOS_COMPONENT_CONTRACT,
    `${label} contract`,
  );
  if (contract !== HODOS_COMPONENT_CONTRACT) {
    throw new Error(`${label} contract must be ${HODOS_COMPONENT_CONTRACT}`);
  }
  const rawEvents = field(input, ["component/events", "events"]) ?? [];
  if (!(Array.isArray(rawEvents) || rawEvents instanceof Set)) {
    throw new TypeError(`${label} events must be an array or set`);
  }
  const events = [...new Set([...rawEvents].map((entry) => nonEmptyString(entry, `${label} event`)))];
  return Object.freeze({
    id,
    contract,
    model: field(input, ["component/model", "model"]) ?? null,
    events: Object.freeze(events),
  });
}

export class HodosComponentRegistry {
  #factories = new Map();

  register(id, factory) {
    id = nonEmptyString(id, "Hodos component id");
    if (typeof factory !== "function") throw new TypeError(`Hodos component ${id} factory must be a function`);
    if (this.#factories.has(id)) throw new Error(`Hodos component is already registered: ${id}`);
    this.#factories.set(id, factory);
    return () => {
      if (this.#factories.get(id) === factory) this.#factories.delete(id);
    };
  }

  has(id) {
    return this.#factories.has(id);
  }

  list() {
    return [...this.#factories.keys()].sort();
  }

  require(id) {
    const factory = this.#factories.get(id);
    if (!factory) throw new Error(`Hodos component is not installed: ${id}`);
    return factory;
  }
}

export class HodosComponentHost {
  #controller = null;
  #descriptor = null;
  #context = null;
  #destroyed = false;

  constructor({ root, registry, dispatch = async () => undefined, services = {} } = {}) {
    if (!root) throw new Error("Hodos component host requires a root");
    if (!(registry instanceof HodosComponentRegistry)) {
      throw new TypeError("Hodos component host requires a HodosComponentRegistry");
    }
    if (typeof dispatch !== "function") throw new TypeError("Hodos component dispatch must be a function");
    this.root = root;
    this.registry = registry;
    this.dispatchEvent = dispatch;
    this.services = Object.freeze({ ...services });
  }

  mount(value, context = {}) {
    this.#assertActive();
    const descriptor = normalizeComponentDescriptor(value);
    this.#release();
    this.#context = context;
    const dispatch = async (event) => {
      const current = this.#descriptor ?? descriptor;
      const allowed = new Set(current.events);
      const type = eventType(event);
      if (!type) throw new TypeError(`Hodos component ${current.id} event requires event/type`);
      if (allowed.size && !allowed.has(type)) {
        throw new Error(`Hodos component ${current.id} cannot dispatch undeclared event: ${type}`);
      }
      const payload = typeof event === "string" ? { "event/type": event } : { ...event };
      if (!Object.hasOwn(payload, "component/id")) payload["component/id"] = current.id;
      return this.dispatchEvent(payload, { descriptor: current, context: this.#context });
    };
    const factory = this.registry.require(descriptor.id);
    const controller = factory({
      root: this.root,
      descriptor,
      model: descriptor.model,
      dispatch,
      services: this.services,
      context,
    }) ?? {};
    if (controller.update !== undefined && typeof controller.update !== "function") {
      throw new TypeError(`Hodos component ${descriptor.id} update must be a function`);
    }
    if (controller.destroy !== undefined && typeof controller.destroy !== "function") {
      throw new TypeError(`Hodos component ${descriptor.id} destroy must be a function`);
    }
    this.#descriptor = descriptor;
    this.#controller = controller;
    return this;
  }

  update(value, context = {}) {
    this.#assertActive();
    const descriptor = normalizeComponentDescriptor(value);
    if (!this.#descriptor || descriptor.id !== this.#descriptor.id || !this.#controller?.update) {
      return this.mount(descriptor, context);
    }
    this.#descriptor = descriptor;
    this.#context = context;
    this.#controller.update(descriptor.model, descriptor, context);
    return this;
  }

  current() {
    return this.#descriptor;
  }

  clear() {
    this.#assertActive();
    this.#release();
  }

  destroy() {
    if (this.#destroyed) return;
    this.#release();
    this.#destroyed = true;
  }

  #release() {
    this.#controller?.destroy?.();
    this.#controller = null;
    this.#descriptor = null;
    this.#context = null;
  }

  #assertActive() {
    if (this.#destroyed) throw new Error("Hodos component host is destroyed");
  }
}

export const createHodosComponentRegistry = () => new HodosComponentRegistry();
export const createHodosComponentHost = (options) => new HodosComponentHost(options);

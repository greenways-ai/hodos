import {
  seedRigWeightsByComponents,
  seedRigWeightsByDistance,
} from "@greenways/hodos-world-model/rigging";

export const RIG_WEIGHT_TASK_PROVIDER_ID = "playcanvas/rigging-weight-task";
export const RIG_WEIGHT_TASK_PROVIDER_VERSION = "0-alpha.1";
export const RIG_WEIGHT_STRATEGIES = Object.freeze(["nearest-segment", "rigid-component"]);

function plainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function positiveInteger(value, fallback, label) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) throw new TypeError(`${label} must be a positive safe integer`);
  return candidate;
}

function taskInput(value = {}) {
  if (!plainObject(value)) throw new TypeError("Rig weight task must be an object");
  if (!RIG_WEIGHT_STRATEGIES.includes(value.strategy)) {
    throw new TypeError(`Unsupported rig weight strategy: ${value.strategy}`);
  }
  if (!(value.positions instanceof Float32Array)) throw new TypeError("Rig weight task positions must be Float32Array");
  if (value.strategy === "rigid-component" && !(value.componentIds instanceof Uint32Array)) {
    throw new TypeError("Rigid component tasks require Uint32Array componentIds");
  }
  return value;
}

export function executeRiggingWeightTask(taskValue = {}) {
  const task = taskInput(taskValue);
  if (task.strategy === "nearest-segment") {
    return seedRigWeightsByDistance({
      document: task.document,
      positions: task.positions,
      maxInfluences: task.maxInfluences,
      falloff: task.falloff,
      epsilon: task.epsilon,
      maximumVertices: task.maximumVertices,
      maximumDistanceEvaluations: task.maximumDistanceEvaluations,
    });
  }
  return seedRigWeightsByComponents({
    document: task.document,
    positions: task.positions,
    componentIds: task.componentIds,
    componentCount: task.componentCount,
    maxInfluences: task.maxInfluences,
    maximumVertices: task.maximumVertices,
    maximumComponents: task.maximumComponents,
    maximumDistanceEvaluations: task.maximumDistanceEvaluations,
  });
}

function copyTaskForWorker(task) {
  const positions = task.positions.slice();
  const componentIds = task.componentIds?.slice?.() ?? null;
  return {
    task: {
      ...task,
      positions,
      ...(componentIds ? { componentIds } : {}),
    },
    transfer: [positions.buffer, ...(componentIds ? [componentIds.buffer] : [])],
  };
}

function workerError(value) {
  const error = new Error(value?.message || "Rig weight worker failed");
  error.name = value?.name || "RigWeightWorkerError";
  if (typeof value?.code === "string") error.code = value.code;
  return error;
}

export class RiggingWeightTaskRunner {
  constructor({ workerFactory = null, timeout = 120_000 } = {}) {
    this.workerFactory = typeof workerFactory === "function" ? workerFactory : null;
    this.timeout = positiveInteger(timeout, 120_000, "timeout");
    this.destroyed = false;
  }

  async run(taskValue = {}) {
    if (this.destroyed) throw new Error("Rig weight task runner was destroyed");
    const task = taskInput(taskValue);
    if (!this.workerFactory) return executeRiggingWeightTask(task);
    const worker = this.workerFactory();
    if (!worker || typeof worker.postMessage !== "function") throw new TypeError("workerFactory must return a Worker-like object");
    const id = `rig-weight:${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    const copied = copyTaskForWorker(task);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.removeEventListener?.("message", onMessage);
        worker.removeEventListener?.("error", onError);
        worker.terminate?.();
        callback(value);
      };
      const onMessage = (event) => {
        const message = event?.data;
        if (message?.id !== id) return;
        if (!message.ok) finish(reject, workerError(message.error));
        else finish(resolve, message.result);
      };
      const onError = (event) => finish(reject, event?.error ?? new Error(event?.message ?? "Rig weight worker failed"));
      const timer = setTimeout(() => finish(reject, new Error(`Rig weight worker exceeded ${this.timeout}ms`)), this.timeout);
      worker.addEventListener?.("message", onMessage);
      worker.addEventListener?.("error", onError);
      worker.postMessage({ id, task: copied.task }, copied.transfer);
    });
  }

  destroy() {
    this.destroyed = true;
  }
}

export function createModuleRiggingWeightWorkerFactory(
  url = new URL("./rigging-weight-worker.js", import.meta.url),
  WorkerClass = globalThis.Worker,
) {
  if (typeof WorkerClass !== "function") return null;
  return () => new WorkerClass(url, { type: "module", name: "hodos-rigging-weights" });
}

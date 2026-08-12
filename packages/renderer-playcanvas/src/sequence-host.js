const DEFAULT_MAX_ACTIONS = 1024;
const DEFAULT_MAX_EVENTS = 4096;
const DEFAULT_MOVE_SPEED = 1.5;

export const PLAYCANVAS_SEQUENCE_PROVIDER_ID = "playcanvas";
export const PLAYCANVAS_SEQUENCE_PROVIDER_VERSION = "0.1.0";

export const PLAYCANVAS_SEQUENCE_OPERATIONS = Object.freeze([
  "character/place",
  "character/move-to",
  "character/turn-to",
  "character/play-clip",
  "character/blend-clip",
  "character/look-at",
  "character/gesture",
  "character/say",
  "camera/cut-to",
  "camera/blend-to",
  "audio/play",
  "world/emit",
]);

const DEFAULT_MARKERS = Object.freeze({
  "character/move-to": "arrived",
  "character/turn-to": "turned",
  "character/play-clip": "clip-complete",
  "character/blend-clip": "clip-complete",
  "character/look-at": "look-complete",
  "character/gesture": "gesture-complete",
  "character/say": "line-finished",
  "camera/blend-to": "camera-complete",
  "audio/play": "audio-finished",
});

export const PLAYCANVAS_SEQUENCE_EXTERNAL_COMPLETION_OPERATIONS = Object.freeze([
  "character/place",
  "camera/cut-to",
  "world/emit",
]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clonePortable(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Portable numbers must be finite");
    return value;
  }
  if (["undefined", "function", "symbol", "bigint"].includes(typeof value)) {
    throw new TypeError(`Portable values cannot contain ${typeof value}`);
  }
  if (typeof value !== "object") throw new TypeError(`Unsupported portable value: ${typeof value}`);
  if (seen.has(value)) throw new TypeError("Portable values cannot contain reference cycles");
  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw new TypeError("Portable values may contain only plain objects and arrays");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const output = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new TypeError("Portable arrays cannot contain holes");
        output.push(clonePortable(value[index], seen));
      }
      return output;
    }
    if (Object.getOwnPropertySymbols(value).length) {
      throw new TypeError("Portable objects cannot contain symbol keys");
    }
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clonePortable(entry, seen)]));
  } finally {
    seen.delete(value);
  }
}


export function createPlayCanvasSequenceOperationProfile(baseOperations) {
  const profile = clonePortable(baseOperations);
  if (!isPlainObject(profile)) {
    throw new TypeError("PlayCanvas sequence operation profile requires an operation object");
  }
  for (const operation of PLAYCANVAS_SEQUENCE_EXTERNAL_COMPLETION_OPERATIONS) {
    const descriptor = profile[operation];
    if (!isPlainObject(descriptor)) {
      throw new PlayCanvasSequenceHostError(
        "sequence/operation-profile",
        `PlayCanvas sequence operation profile is missing ${operation}`,
        { operation },
      );
    }
    profile[operation] = Object.freeze({
      ...descriptor,
      hostEffect: true,
      completion: Object.freeze({ mode: "external", marker: null }),
    });
  }
  return Object.freeze(profile);
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
}

function positiveSafeInteger(value, fallback, label) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return candidate;
}

function finite(value, fallback, label) {
  const candidate = value ?? fallback;
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return candidate;
}

function vector3(value, fallback, label) {
  const candidate = value ?? fallback;
  if (!Array.isArray(candidate) || candidate.length !== 3) {
    throw new TypeError(`${label} must contain three finite numbers`);
  }
  return candidate.map((entry, index) => finite(entry, undefined, `${label}[${index}]`));
}

function point(value) {
  if (Array.isArray(value)) return vector3(value, [0, 0, 0], "point");
  if (value && [value.x, value.y, value.z].every(Number.isFinite)) return [value.x, value.y, value.z];
  throw new TypeError("PlayCanvas position must expose finite x, y and z values");
}

function distance(left, right) {
  return Math.hypot(right[0] - left[0], right[1] - left[1], right[2] - left[2]);
}

function lerp(left, right, amount) {
  return left.map((entry, index) => entry + (right[index] - entry) * amount);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function boundedDetails(value, maximum = 32) {
  if (!isPlainObject(value)) return null;
  const entries = Object.entries(value).slice(0, maximum);
  try {
    return clonePortable(Object.fromEntries(entries));
  } catch {
    return null;
  }
}

export class PlayCanvasSequenceHostError extends Error {
  constructor(code, message, { effectId = null, operation = null, details = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "PlayCanvasSequenceHostError";
    this.code = requiredString(code, "Sequence host error code");
    this.effectId = effectId;
    this.operation = operation;
    this.details = boundedDetails(details);
  }
}

function normalizeEffect(value) {
  const effect = clonePortable(value);
  if (!isPlainObject(effect)) throw new TypeError("Sequence host effect must be an object");
  if (effect.type !== "sequence/action") {
    throw new PlayCanvasSequenceHostError("sequence/effect-type", `Unsupported sequence effect type: ${String(effect.type)}`);
  }
  const id = requiredString(effect.id, "Sequence effect id");
  const sequenceId = requiredString(effect.sequenceId, "Sequence effect sequenceId");
  const cueId = requiredString(effect.cueId, "Sequence effect cueId");
  const operation = requiredString(effect.operation ?? effect.action?.op, "Sequence effect operation");
  if (!isPlainObject(effect.action)) throw new TypeError("Sequence effect action must be an object");
  if (effect.action.op !== operation) {
    throw new PlayCanvasSequenceHostError(
      "sequence/effect-operation",
      `Sequence effect operation ${operation} does not match action ${String(effect.action.op)}`,
      { effectId: id, operation },
    );
  }
  return {
    ...effect,
    id,
    sequenceId,
    cueId,
    operation,
    target: effect.target === null || effect.target === undefined ? null : clonePortable(effect.target),
    action: clonePortable(effect.action),
    at: Math.max(0, finite(effect.at, 0, "Sequence effect time")),
    preview: effect.preview === true,
    capabilities: Array.isArray(effect.capabilities)
      ? [...new Set(effect.capabilities.map((entry, index) => requiredString(entry, `Sequence capability ${index}`)))].sort()
      : [],
  };
}

function entityPosition(entity) {
  if (typeof entity?.getPosition === "function") return point(entity.getPosition());
  if (entity?.position !== undefined) return point(entity.position);
  throw new PlayCanvasSequenceHostError("sequence/entity-position", "PlayCanvas entity does not expose getPosition() or position");
}

function setEntityPosition(entity, value) {
  const [x, y, z] = vector3(value, [0, 0, 0], "entity position");
  if (typeof entity?.setPosition === "function") entity.setPosition(x, y, z);
  else if (entity) entity.position = { x, y, z };
  else throw new PlayCanvasSequenceHostError("sequence/entity-missing", "Sequence action requires a PlayCanvas entity");
}

function setEntityRotation(entity, value) {
  const [x, y, z] = vector3(value, [0, 0, 0], "entity rotation");
  if (typeof entity?.setEulerAngles === "function") entity.setEulerAngles(x, y, z);
  else if (entity) entity.rotation = { x, y, z };
  else throw new PlayCanvasSequenceHostError("sequence/entity-missing", "Sequence action requires a PlayCanvas entity");
}

function setEntityScale(entity, value) {
  const [x, y, z] = vector3(value, [1, 1, 1], "entity scale");
  if (typeof entity?.setLocalScale === "function") entity.setLocalScale(x, y, z);
  else if (entity) entity.scale = { x, y, z };
  else throw new PlayCanvasSequenceHostError("sequence/entity-missing", "Sequence action requires a PlayCanvas entity");
}

function lookAt(entity, target) {
  const [x, y, z] = vector3(target, [0, 0, 0], "look target");
  if (typeof entity?.lookAt === "function") entity.lookAt(x, y, z);
  else throw new PlayCanvasSequenceHostError("sequence/look-at", "PlayCanvas entity does not expose lookAt()");
}

function defaultResolveEntity(app, reference) {
  const id = typeof reference === "string"
    ? reference
    : reference?.entityId ?? reference?.id ?? null;
  if (!id) return null;
  const root = app?.root;
  return root?.findByGuid?.(id)
    ?? root?.findByName?.(id)
    ?? null;
}

function operationError(error, effect) {
  if (error instanceof PlayCanvasSequenceHostError) return error;
  return new PlayCanvasSequenceHostError(
    "sequence/action-failed",
    error instanceof Error ? error.message : String(error),
    { effectId: effect.id, operation: effect.operation, cause: error instanceof Error ? error : null },
  );
}

function isPromise(value) {
  return value && typeof value.then === "function";
}

function normalizeHandlerResult(value) {
  if (value === undefined || value === null) return {};
  if (isPromise(value)) return { promise: value };
  if (!isPlainObject(value)) throw new TypeError("Sequence operation handler must return an object, Promise, nil, or undefined");
  return value;
}

function freezeResult(record, duplicate = false, accepted = !duplicate) {
  return Object.freeze({
    accepted,
    duplicate,
    effectId: record.effect.id,
    operation: record.effect.operation,
    status: record.status,
  });
}

function timedAction({ startAt, duration, update, marker }) {
  const safeDuration = Math.max(0, finite(duration, 0, "Sequence action duration"));
  if (safeDuration === 0) {
    update(1);
    return { complete: true, marker };
  }
  return {
    tick(time) {
      const progress = clamp01((time - startAt) / safeDuration);
      update(progress);
      return progress >= 1 ? { complete: true, marker } : null;
    },
  };
}

function resolveActionPoint(host, effect, key = "target") {
  const action = effect.action;
  if (Array.isArray(action.position)) return vector3(action.position, [0, 0, 0], `${effect.operation} position`);
  if (typeof action.mark === "string") {
    const mark = host.resolveMark(action.mark, effect);
    if (mark?.position) return point(mark.position);
    if (Array.isArray(mark) || (mark && [mark.x, mark.y, mark.z].every(Number.isFinite))) return point(mark);
    throw new PlayCanvasSequenceHostError(
      "sequence/mark-missing",
      `Unable to resolve sequence mark: ${action.mark}`,
      { effectId: effect.id, operation: effect.operation },
    );
  }
  const targetReference = action[key];
  if (targetReference !== undefined && targetReference !== null) {
    const target = host.resolveTarget(targetReference, effect);
    if (target?.position) return point(target.position);
    if (Array.isArray(target) || (target && [target.x, target.y, target.z].every(Number.isFinite))) return point(target);
    if (target) return entityPosition(target);
  }
  throw new PlayCanvasSequenceHostError(
    "sequence/target-missing",
    `${effect.operation} requires a position, mark, or resolvable target`,
    { effectId: effect.id, operation: effect.operation },
  );
}

function animationFallback(host, effect, { blend = 0, marker = "clip-complete" } = {}) {
  const entity = host.entityFor(effect);
  const clip = requiredString(effect.action.clip ?? effect.action.gesture, `${effect.operation} clip`);
  const transition = Math.max(0, finite(effect.action.blend ?? effect.action.blendIn, blend, `${effect.operation} blend`));
  if (typeof entity?.anim?.baseLayer?.transition === "function") {
    entity.anim.baseLayer.transition(clip, transition);
  } else if (typeof entity?.animation?.play === "function") {
    entity.animation.play(clip, transition);
  } else {
    throw new PlayCanvasSequenceHostError(
      "sequence/animation-capability",
      `Actor ${effect.target?.id ?? effect.target?.entityId ?? "<unknown>"} has no PlayCanvas animation component`,
      { effectId: effect.id, operation: effect.operation },
    );
  }
  const duration = host.resolveClipDuration(effect) ?? effect.action.duration;
  if (!Number.isFinite(duration) || duration < 0) {
    throw new PlayCanvasSequenceHostError(
      "sequence/animation-duration",
      `${effect.operation} requires clip duration metadata or an explicit duration`,
      { effectId: effect.id, operation: effect.operation, details: { clip } },
    );
  }
  return timedAction({ startAt: effect.at, duration, update() {}, marker });
}

export function createPlayCanvasSequenceHandlers(host) {
  return Object.freeze({
    "character/place": (effect) => {
      const entity = host.entityFor(effect);
      const mark = typeof effect.action.mark === "string" ? host.resolveMark(effect.action.mark, effect) : null;
      if (effect.action.position || mark?.position) setEntityPosition(entity, effect.action.position ?? mark.position);
      if (effect.action.rotation || effect.action.facing || mark?.rotation || mark?.facing) {
        setEntityRotation(entity, effect.action.rotation ?? effect.action.facing ?? mark.rotation ?? mark.facing);
      }
      if (effect.action.scale) setEntityScale(entity, effect.action.scale);
      return { complete: true };
    },

    "character/move-to": (effect, context) => {
      if (typeof host.navigation?.moveTo === "function") {
        return host.navigation.moveTo({ effect, entity: host.entityFor(effect), context });
      }
      const entity = host.entityFor(effect);
      const from = entityPosition(entity);
      const to = resolveActionPoint(host, effect);
      const speed = Math.max(0.001, finite(effect.action.speed, DEFAULT_MOVE_SPEED, "character/move-to speed"));
      const duration = effect.action.duration ?? distance(from, to) / speed;
      return timedAction({
        startAt: effect.at,
        duration,
        update(progress) { setEntityPosition(entity, lerp(from, to, progress)); },
        marker: "arrived",
      });
    },

    "character/turn-to": (effect, context) => {
      if (typeof host.character?.turnTo === "function") {
        return host.character.turnTo({ effect, entity: host.entityFor(effect), context });
      }
      lookAt(host.entityFor(effect), resolveActionPoint(host, effect));
      return { complete: true, marker: "turned" };
    },

    "character/play-clip": (effect, context) => (
      typeof host.animation?.playClip === "function"
        ? host.animation.playClip({ effect, entity: host.entityFor(effect), context })
        : animationFallback(host, effect)
    ),

    "character/blend-clip": (effect, context) => (
      typeof host.animation?.blendClip === "function"
        ? host.animation.blendClip({ effect, entity: host.entityFor(effect), context })
        : animationFallback(host, effect, { blend: 0.2 })
    ),

    "character/look-at": (effect, context) => {
      if (typeof host.character?.lookAt === "function") {
        return host.character.lookAt({ effect, entity: host.entityFor(effect), context });
      }
      lookAt(host.entityFor(effect), resolveActionPoint(host, effect));
      return { complete: true, marker: "look-complete" };
    },

    "character/gesture": (effect, context) => (
      typeof host.animation?.gesture === "function"
        ? host.animation.gesture({ effect, entity: host.entityFor(effect), context })
        : animationFallback(host, effect, { marker: "gesture-complete" })
    ),

    "character/say": (effect, context) => {
      if (typeof host.dialogue?.say !== "function") {
        throw new PlayCanvasSequenceHostError(
          "sequence/dialogue-capability",
          "character/say requires an injected PlayCanvas dialogue driver",
          { effectId: effect.id, operation: effect.operation },
        );
      }
      return host.dialogue.say({ effect, entity: host.entityFor(effect), context });
    },

    "camera/cut-to": (effect, context) => {
      if (typeof host.camera?.cutTo === "function") return host.camera.cutTo({ effect, context });
      const target = host.resolveCamera(effect.action.camera, effect);
      if (!target) {
        throw new PlayCanvasSequenceHostError("sequence/camera-missing", `Unable to resolve camera: ${String(effect.action.camera)}`, {
          effectId: effect.id,
          operation: effect.operation,
        });
      }
      if (host.activeCamera && host.activeCamera !== target) host.activeCamera.enabled = false;
      target.enabled = true;
      host.activeCamera = target;
      return { complete: true };
    },

    "camera/blend-to": (effect, context) => {
      if (typeof host.camera?.blendTo === "function") return host.camera.blendTo({ effect, context });
      const target = host.resolveCamera(effect.action.camera, effect);
      const source = host.activeCamera;
      if (!target) {
        throw new PlayCanvasSequenceHostError("sequence/camera-missing", `Unable to resolve camera: ${String(effect.action.camera)}`, {
          effectId: effect.id,
          operation: effect.operation,
        });
      }
      if (!source || source === target) {
        target.enabled = true;
        host.activeCamera = target;
        return { complete: true, marker: "camera-complete" };
      }
      const from = entityPosition(source);
      const to = entityPosition(target);
      target.enabled = false;
      return {
        ...timedAction({
          startAt: effect.at,
          duration: Math.max(0, finite(effect.action.duration, 0.3, "camera/blend-to duration")),
          update(progress) { setEntityPosition(source, lerp(from, to, progress)); },
          marker: "camera-complete",
        }),
        finish() {
          source.enabled = false;
          target.enabled = true;
          host.activeCamera = target;
        },
        cancel() {
          setEntityPosition(source, from);
          source.enabled = true;
          target.enabled = false;
          host.activeCamera = source;
        },
      };
    },

    "audio/play": (effect, context) => {
      if (typeof host.audio?.play !== "function") {
        throw new PlayCanvasSequenceHostError(
          "sequence/audio-capability",
          "audio/play requires an injected PlayCanvas audio driver",
          { effectId: effect.id, operation: effect.operation },
        );
      }
      return host.audio.play({ effect, context });
    },

    "world/emit": (effect, context) => {
      const event = requiredString(effect.action.event ?? effect.action.name, "world/emit event");
      const payload = clonePortable(effect.action.value ?? effect.action.payload ?? null);
      if (typeof host.world?.emit === "function") host.world.emit(event, payload, { effect, context });
      else if (typeof host.app?.fire === "function") host.app.fire(event, payload);
      else {
        throw new PlayCanvasSequenceHostError(
          "sequence/world-event-capability",
          "world/emit requires app.fire() or an injected world event driver",
          { effectId: effect.id, operation: effect.operation },
        );
      }
      return { complete: true };
    },
  });
}

export class PlayCanvasSequenceHost {
  constructor({
    app = null,
    emit = () => {},
    now = () => 0,
    resolveEntity = null,
    resolveMark = () => null,
    resolveTarget = null,
    resolveCamera = null,
    resolveClipDuration = () => null,
    navigation = null,
    character = null,
    animation = null,
    dialogue = null,
    camera = null,
    audio = null,
    world = null,
    handlers = {},
    activeCamera = null,
    maximumActions = DEFAULT_MAX_ACTIONS,
    maximumEvents = DEFAULT_MAX_EVENTS,
  } = {}) {
    if (typeof emit !== "function") throw new TypeError("PlayCanvas sequence host emit must be a function");
    if (typeof now !== "function") throw new TypeError("PlayCanvas sequence host now must be a function");
    this.app = app;
    this.emit = emit;
    this.now = now;
    this.resolveEntity = typeof resolveEntity === "function"
      ? resolveEntity
      : (reference) => defaultResolveEntity(app, reference);
    this.resolveMark = typeof resolveMark === "function" ? resolveMark : () => null;
    this.resolveTarget = typeof resolveTarget === "function"
      ? resolveTarget
      : (reference) => this.resolveEntity(reference);
    this.resolveCamera = typeof resolveCamera === "function"
      ? resolveCamera
      : (reference) => this.resolveEntity(reference);
    this.resolveClipDuration = typeof resolveClipDuration === "function" ? resolveClipDuration : () => null;
    this.navigation = navigation;
    this.character = character;
    this.animation = animation;
    this.dialogue = dialogue;
    this.camera = camera;
    this.audio = audio;
    this.world = world;
    this.activeCamera = activeCamera;
    this.maximumActions = positiveSafeInteger(maximumActions, DEFAULT_MAX_ACTIONS, "maximumActions");
    this.maximumEvents = positiveSafeInteger(maximumEvents, DEFAULT_MAX_EVENTS, "maximumEvents");
    this.records = new Map();
    this.eventIds = new Set();
    this.destroyed = false;
    const defaults = createPlayCanvasSequenceHandlers(this);
    this.handlers = Object.freeze({ ...defaults, ...handlers });
  }

  entityFor(effect) {
    const entity = this.resolveEntity(effect.target, effect);
    if (!entity) {
      throw new PlayCanvasSequenceHostError(
        "sequence/entity-missing",
        `Unable to resolve actor entity for cue ${effect.cueId}`,
        { effectId: effect.id, operation: effect.operation, details: { target: effect.target } },
      );
    }
    return entity;
  }

  handle(effectValue) {
    this.assertActive();
    const effect = normalizeEffect(effectValue);
    const existing = this.records.get(effect.id);
    if (existing) return freezeResult(existing, true);
    if (this.records.size >= this.maximumActions) {
      const error = new PlayCanvasSequenceHostError(
        "sequence/action-capacity",
        `PlayCanvas sequence host reached its bounded action limit of ${this.maximumActions}`,
        { effectId: effect.id, operation: effect.operation },
      );
      const record = this.failedRecord(effect, error, { retain: false });
      return freezeResult(record, false, false);
    }
    const handler = this.handlers[effect.operation];
    if (typeof handler !== "function" || !PLAYCANVAS_SEQUENCE_OPERATIONS.includes(effect.operation)) {
      const error = new PlayCanvasSequenceHostError(
        "sequence/operation-unsupported",
        `Unsupported PlayCanvas sequence operation: ${effect.operation}`,
        { effectId: effect.id, operation: effect.operation },
      );
      const record = this.failedRecord(effect, error);
      return freezeResult(record, false, false);
    }
    const record = {
      effect,
      status: "starting",
      controller: new AbortController(),
      tick: null,
      cancel: null,
      finish: null,
      dispose: null,
      promise: null,
      error: null,
    };
    this.records.set(effect.id, record);
    const context = Object.freeze({
      signal: record.controller.signal,
      now: this.now,
      marker: (name, value = null, at = this.now()) => this.emitMarker(record, name, value, at),
      fail: (error) => this.failRecord(record, operationError(error, effect)),
    });
    try {
      const result = normalizeHandlerResult(handler(effect, context));
      this.attachResult(record, result);
    } catch (error) {
      this.failRecord(record, operationError(error, effect));
    }
    return freezeResult(record);
  }

  tick(logicalTime) {
    this.assertActive();
    const time = Math.max(0, finite(logicalTime, this.now(), "Sequence host logical time"));
    const completed = [];
    for (const record of this.records.values()) {
      if (record.status !== "active" || typeof record.tick !== "function") continue;
      try {
        const result = record.tick(time);
        if (result) {
          this.attachResult(record, normalizeHandlerResult(result));
          if (record.status === "completed") completed.push(record.effect.id);
        }
      } catch (error) {
        this.failRecord(record, operationError(error, record.effect));
      }
    }
    return Object.freeze({ time, completed: Object.freeze(completed) });
  }

  cancel(effectId, reason = "cancelled") {
    this.assertActive();
    const record = this.records.get(effectId);
    if (!record || ["completed", "failed", "cancelled"].includes(record.status)) return false;
    record.status = "cancelled";
    record.controller.abort(reason);
    try { record.cancel?.(reason); } catch {}
    try { this.disposeRecord(record); } catch {}
    record.tick = null;
    return true;
  }

  snapshot() {
    return Object.freeze({
      provider: Object.freeze({ id: PLAYCANVAS_SEQUENCE_PROVIDER_ID, version: PLAYCANVAS_SEQUENCE_PROVIDER_VERSION }),
      destroyed: this.destroyed,
      actions: this.records.size,
      active: [...this.records.values()].filter(({ status }) => status === "active").length,
      completed: [...this.records.values()].filter(({ status }) => status === "completed").length,
      failed: [...this.records.values()].filter(({ status }) => status === "failed").length,
      cancelled: [...this.records.values()].filter(({ status }) => status === "cancelled").length,
      events: this.eventIds.size,
      maximumActions: this.maximumActions,
      maximumEvents: this.maximumEvents,
    });
  }

  destroy() {
    if (this.destroyed) return;
    for (const record of this.records.values()) {
      if (!["completed", "failed", "cancelled"].includes(record.status)) {
        record.status = "cancelled";
        record.controller.abort("host-destroyed");
        try { record.cancel?.("host-destroyed"); } catch {}
      }
      try { this.disposeRecord(record); } catch {}
      record.tick = null;
    }
    this.destroyed = true;
  }

  attachResult(record, result) {
    if (["failed", "cancelled", "completed"].includes(record.status)) return;
    if (typeof result.tick === "function") record.tick = result.tick;
    if (typeof result.cancel === "function") record.cancel = result.cancel;
    if (typeof result.finish === "function") record.finish = result.finish;
    if (typeof result.dispose === "function") record.dispose = result.dispose;
    if (result.promise !== undefined) {
      if (!isPromise(result.promise)) throw new TypeError("Sequence handler promise must be Promise-like");
      record.status = "active";
      record.promise = Promise.resolve(result.promise).then(
        (value) => {
          if (this.destroyed || record.controller.signal.aborted) return;
          this.attachResult(record, normalizeHandlerResult(value ?? { complete: true }));
        },
        (error) => {
          if (this.destroyed || record.controller.signal.aborted) return;
          this.failRecord(record, operationError(error, record.effect));
        },
      );
      return;
    }
    const complete = result.complete === true;
    if (complete) {
      try {
        record.finish?.(result);
        this.disposeRecord(record);
        const marker = result.marker ?? DEFAULT_MARKERS[record.effect.operation] ?? null;
        if (marker) this.emitMarker(record, marker, result.value ?? null, result.at ?? this.now());
        else this.emitCompletion(record, result.value ?? null, result.at ?? this.now());
      } catch (error) {
        this.failRecord(record, operationError(error, record.effect));
        return;
      }
      record.status = "completed";
      record.tick = null;
      return;
    }
    record.status = "active";
  }


  disposeRecord(record) {
    const dispose = record.dispose;
    record.dispose = null;
    if (typeof dispose === "function") dispose();
  }


  emitCompletion(record, value = null, at = this.now()) {
    return this.emitEvent({
      id: `${record.effect.id}/completed`,
      type: "sequence/cue-complete",
      sequenceId: record.effect.sequenceId,
      cueId: record.effect.cueId,
      at: Math.max(record.effect.at, finite(at, record.effect.at, "Sequence completion time")),
      result: clonePortable(value),
      provider: { id: PLAYCANVAS_SEQUENCE_PROVIDER_ID, version: PLAYCANVAS_SEQUENCE_PROVIDER_VERSION },
    });
  }

  emitMarker(record, markerValue, value = null, at = this.now()) {
    const marker = requiredString(markerValue, "Sequence marker");
    const event = {
      id: `${record.effect.id}/marker/${marker}`,
      type: "sequence/marker",
      sequenceId: record.effect.sequenceId,
      cueId: record.effect.cueId,
      marker,
      at: Math.max(record.effect.at, finite(at, record.effect.at, "Sequence marker time")),
      value: clonePortable(value),
      provider: { id: PLAYCANVAS_SEQUENCE_PROVIDER_ID, version: PLAYCANVAS_SEQUENCE_PROVIDER_VERSION },
    };
    return this.emitEvent(event);
  }

  emitEvent(eventValue) {
    const event = clonePortable(eventValue);
    const id = requiredString(event.id, "Sequence event id");
    if (this.eventIds.has(id)) return false;
    if (this.eventIds.size >= this.maximumEvents) {
      throw new PlayCanvasSequenceHostError(
        "sequence/event-capacity",
        `PlayCanvas sequence host reached its bounded event limit of ${this.maximumEvents}`,
      );
    }
    this.eventIds.add(id);
    this.emit(Object.freeze(event));
    return true;
  }

  failedRecord(effect, error, { retain = true } = {}) {
    const record = {
      effect,
      status: "failed",
      controller: new AbortController(),
      tick: null,
      cancel: null,
      finish: null,
      dispose: null,
      promise: null,
      error,
    };
    if (retain) this.records.set(effect.id, record);
    this.emitFailure(record, error);
    return record;
  }

  failRecord(record, error) {
    if (["failed", "cancelled", "completed"].includes(record.status)) return false;
    record.status = "failed";
    record.error = error;
    record.controller.abort(error.message);
    try { record.cancel?.(error.message); } catch {}
    try { this.disposeRecord(record); } catch {}
    record.tick = null;
    this.emitFailure(record, error);
    return true;
  }

  emitFailure(record, error) {
    const details = error.details ? clonePortable(error.details) : null;
    try {
      return this.emitEvent({
        id: `${record.effect.id}/failed`,
        type: "sequence/cue-failed",
        sequenceId: record.effect.sequenceId,
        cueId: record.effect.cueId,
        at: Math.max(record.effect.at, finite(this.now(), record.effect.at, "Sequence failure time")),
        error: error.message,
        code: error.code,
        ...(details ? { details } : {}),
        provider: { id: PLAYCANVAS_SEQUENCE_PROVIDER_ID, version: PLAYCANVAS_SEQUENCE_PROVIDER_VERSION },
      });
    } catch (failure) {
      if (failure instanceof PlayCanvasSequenceHostError && failure.code === "sequence/event-capacity") {
        return false;
      }
      throw failure;
    }
  }

  assertActive() {
    if (this.destroyed) {
      throw new PlayCanvasSequenceHostError("sequence/host-destroyed", "PlayCanvas sequence host was destroyed");
    }
  }
}

export function createPlayCanvasSequenceHost(options) {
  return new PlayCanvasSequenceHost(options);
}

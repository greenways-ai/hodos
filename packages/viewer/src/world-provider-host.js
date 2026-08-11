export const WORLD_PROVIDER_HOST_FORMAT = "hodos.world-provider-host/1";
export const WORLD_PROVIDER_REGISTRY_FORMAT = "hodos.world-provider-registry/1";
export const WORLD_PROVIDER_LAUNCH_FORMAT = "hodos.world-provider-launch/1";

const PROVIDER_PATTERN = /^[a-z][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const ACTIVITY_PATTERN = /^[a-z][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const PACKAGE_PATTERN = /^(?:hara|npm):[a-z0-9@._/-]+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const STATE_PATTERN = /^[a-z][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
};

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function exact(value, label, fields) {
  const input = object(value, label);
  const unknown = Object.keys(input).filter((key) => !fields.has(key)).sort();
  if (unknown.length) throw new TypeError(`${label} contains unknown field ${unknown[0]}`);
  return input;
}

function patterned(value, label, pattern) {
  const output = String(value ?? "").trim();
  if (!pattern.test(output)) throw new TypeError(`${label} is invalid`);
  return output;
}

function uniqueStates(value, label) {
  if (!Array.isArray(value) || !value.length || value.length > 64) {
    throw new TypeError(`${label} must contain one to 64 states`);
  }
  const output = value.map((entry, index) => patterned(entry, `${label}[${index}]`, STATE_PATTERN));
  if (new Set(output).size !== output.length) throw new Error(`${label} must contain unique states`);
  return Object.freeze(output);
}

export function normalizeWorldProviderLaunch(value) {
  const input = exact(value, "World-provider launch", new Set([
    "format", "providerId", "activityId", "package", "state",
  ]));
  if (input.format !== WORLD_PROVIDER_LAUNCH_FORMAT) {
    throw new Error(`Unsupported world-provider launch format: ${input.format}`);
  }
  return deepFreeze({
    format: WORLD_PROVIDER_LAUNCH_FORMAT,
    providerId: patterned(input.providerId, "World-provider launch provider", PROVIDER_PATTERN),
    activityId: patterned(input.activityId, "World-provider launch activity", ACTIVITY_PATTERN),
    package: patterned(input.package, "World-provider launch package", PACKAGE_PATTERN),
    state: patterned(input.state, "World-provider launch state", STATE_PATTERN),
  });
}

function normalizeActivity(value, activityId) {
  const input = exact(value, `World-provider activity ${activityId}`, new Set([
    "package", "defaultState", "states",
  ]));
  const states = uniqueStates(input.states, `World-provider activity ${activityId} states`);
  const defaultState = patterned(
    input.defaultState ?? states[0],
    `World-provider activity ${activityId} default state`,
    STATE_PATTERN,
  );
  if (!states.includes(defaultState)) {
    throw new Error(`World-provider activity ${activityId} default state is not installed`);
  }
  return deepFreeze({
    activityId,
    package: patterned(input.package, `World-provider activity ${activityId} package`, PACKAGE_PATTERN),
    defaultState,
    states,
  });
}

export function normalizeWorldProviderRegistration(value) {
  const input = exact(value, "World-provider registration", new Set([
    "providerId", "activities", "factory", "metadata",
  ]));
  const providerId = patterned(input.providerId, "World-provider registration id", PROVIDER_PATTERN);
  if (typeof input.factory !== "function") throw new TypeError(`World provider ${providerId} factory must be a function`);
  const activitiesValue = object(input.activities, `World provider ${providerId} activities`);
  const entries = Object.entries(activitiesValue);
  if (!entries.length || entries.length > 64) {
    throw new TypeError(`World provider ${providerId} must install one to 64 activities`);
  }
  const activities = Object.fromEntries(entries.map(([key, activity]) => {
    const activityId = patterned(key, `World provider ${providerId} activity id`, ACTIVITY_PATTERN);
    return [activityId, normalizeActivity(activity, activityId)];
  }));
  const metadata = input.metadata == null
    ? Object.freeze({})
    : deepFreeze({...exact(input.metadata, `World provider ${providerId} metadata`, new Set([
      "label", "version", "source",
    ]))});
  return Object.freeze({providerId, activities: deepFreeze(activities), factory: input.factory, metadata});
}

export function createWorldProviderRegistry(initial = []) {
  if (!Array.isArray(initial)) throw new TypeError("World-provider registry initial entries must be an array");
  const providers = new Map();

  const register = (value) => {
    const registration = normalizeWorldProviderRegistration(value);
    if (providers.has(registration.providerId)) {
      throw new Error(`World provider is already installed: ${registration.providerId}`);
    }
    providers.set(registration.providerId, registration);
    return () => {
      if (providers.get(registration.providerId) === registration) providers.delete(registration.providerId);
    };
  };
  for (const entry of initial) register(entry);

  return Object.freeze({
    format: WORLD_PROVIDER_REGISTRY_FORMAT,
    register,
    resolve(providerId) {
      const id = patterned(providerId, "World-provider lookup id", PROVIDER_PATTERN);
      return providers.get(id) ?? null;
    },
    list() {
      return Object.freeze([...providers.values()].map((registration) => deepFreeze({
        providerId: registration.providerId,
        activities: Object.values(registration.activities).map((activity) => ({
          activityId: activity.activityId,
          package: activity.package,
          defaultState: activity.defaultState,
          states: [...activity.states],
        })),
        metadata: registration.metadata,
      })));
    },
    snapshot() {
      return deepFreeze({
        format: WORLD_PROVIDER_REGISTRY_FORMAT,
        providers: [...providers.keys()].sort(),
        providerCount: providers.size,
        activityCount: [...providers.values()]
          .reduce((sum, registration) => sum + Object.keys(registration.activities).length, 0),
      });
    },
  });
}

function validateInstalledLaunch(registry, launch) {
  const registration = registry.resolve(launch.providerId);
  if (!registration) throw new Error(`World provider is not installed: ${launch.providerId}`);
  const activity = registration.activities[launch.activityId];
  if (!activity) {
    throw new Error(`World provider ${launch.providerId} does not install activity ${launch.activityId}`);
  }
  if (activity.package !== launch.package) {
    throw new Error(`World provider ${launch.providerId} package mismatch for ${launch.activityId}`);
  }
  if (!activity.states.includes(launch.state)) {
    throw new Error(`World provider ${launch.providerId} does not install state ${launch.state}`);
  }
  return {registration, activity};
}

export function createWorldProviderHost({root, registry = createWorldProviderRegistry()} = {}) {
  if (!root || typeof root.replaceChildren !== "function") {
    throw new TypeError("World-provider host requires a root with replaceChildren");
  }
  if (!registry || typeof registry.resolve !== "function") {
    throw new TypeError("World-provider host requires an installed provider registry");
  }

  let controller = null;
  let activeLaunch = null;
  let status = "idle";
  let allocations = 0;
  let disposals = 0;
  let destroyed = false;
  let operation = Promise.resolve();

  const snapshot = () => deepFreeze({
    format: WORLD_PROVIDER_HOST_FORMAT,
    status,
    activeLaunch,
    allocations,
    disposals,
    provider: controller?.snapshot?.() ?? null,
    registry: registry.snapshot?.() ?? null,
  });

  const disposeCurrent = async (reason) => {
    if (!controller) {
      root.replaceChildren();
      activeLaunch = null;
      return;
    }
    const current = controller;
    controller = null;
    activeLaunch = null;
    await current.destroy?.(reason);
    root.replaceChildren();
    disposals += 1;
  };

  const enqueue = (task) => {
    operation = operation.then(task, task);
    return operation;
  };

  return Object.freeze({
    format: WORLD_PROVIDER_HOST_FORMAT,
    registry,
    snapshot,
    open(value, context = {}) {
      return enqueue(async () => {
        if (destroyed) throw new Error("World-provider host has been destroyed");
        const launch = normalizeWorldProviderLaunch(value);
        const {registration, activity} = validateInstalledLaunch(registry, launch);
        status = "opening";
        await disposeCurrent("provider-switch");
        const allocated = await registration.factory(Object.freeze({
          root,
          launch,
          activity,
          metadata: registration.metadata,
          context: deepFreeze({...object(context, "World-provider launch context")}),
        }));
        if (!allocated || typeof allocated !== "object" || Array.isArray(allocated)) {
          root.replaceChildren();
          status = "failed";
          throw new Error(`World provider ${launch.providerId} returned an invalid controller`);
        }
        if (allocated.destroy != null && typeof allocated.destroy !== "function") {
          root.replaceChildren();
          status = "failed";
          throw new Error(`World provider ${launch.providerId} returned an invalid destroy boundary`);
        }
        controller = allocated;
        activeLaunch = launch;
        allocations += 1;
        status = "ready";
        return snapshot();
      });
    },
    close(reason = "closed") {
      return enqueue(async () => {
        if (destroyed) return snapshot();
        status = String(reason);
        await disposeCurrent(reason);
        status = "idle";
        return snapshot();
      });
    },
    destroy() {
      return enqueue(async () => {
        if (destroyed) return snapshot();
        destroyed = true;
        status = "disposing";
        await disposeCurrent("host-destroy");
        status = "disposed";
        return snapshot();
      });
    },
  });
}

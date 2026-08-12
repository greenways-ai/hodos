export const WORLD_PROVIDER_FORMAT = "hodos.world-provider/1";
export const WORLD_PROVIDER_LAUNCH_FORMAT = "hodos.world-provider-launch/1";

export const WORLD_PROVIDER_LIMITS = Object.freeze({
  identifierLength: 192,
  packageLength: 320,
  states: 64,
});

const PROVIDER_IDENTITY_PATTERN = /^[a-z][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const PACKAGE_PATTERN = /^(?:hara|npm):[a-z0-9@._\/-]+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PROVIDER_FIELDS = new Set([
  "provider/id",
  "provider/activity",
  "provider/package",
  "provider/default-state",
  "provider/states",
]);
const NORMALIZED_FIELDS = new Set([
  "format",
  "id",
  "activity",
  "package",
  "defaultState",
  "states",
]);

function exactObject(value, label, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Set) {
    throw new Error(`${label} must be a map`);
  }
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort();
  if (unknown.length) throw new Error(`${label} contains unknown field ${unknown[0]}`);
  return value;
}

function boundedString(value, label, maximum) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const output = value.trim();
  if (!output || output.length > maximum) throw new Error(`${label} is invalid`);
  return output;
}

function providerIdentity(value, label) {
  const source = typeof value === "string"
    ? value
    : value && typeof value === "object" && typeof value.sym === "string"
      ? value.sym
      : value;
  const output = boundedString(source, label, WORLD_PROVIDER_LIMITS.identifierLength);
  if (!PROVIDER_IDENTITY_PATTERN.test(output)) throw new Error(`${label} is invalid`);
  return output;
}

function packageCoordinate(value, label) {
  const output = boundedString(value, label, WORLD_PROVIDER_LIMITS.packageLength);
  if (!PACKAGE_PATTERN.test(output)) {
    throw new Error(`${label} must be an exact hara: or npm: package coordinate`);
  }
  return output;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

export function normalizeWorldProvider(value, label = ":world/provider") {
  const input = exactObject(value, label, PROVIDER_FIELDS);
  const sourceStates = input["provider/states"];
  if (!Array.isArray(sourceStates)) throw new Error(`${label} :provider/states must be a vector`);
  if (!sourceStates.length || sourceStates.length > WORLD_PROVIDER_LIMITS.states) {
    throw new Error(`${label} :provider/states must contain one to ${WORLD_PROVIDER_LIMITS.states} states`);
  }
  const states = sourceStates.map((state, index) => providerIdentity(
    state,
    `${label} :provider/states[${index}]`,
  ));
  if (new Set(states).size !== states.length) {
    throw new Error(`${label} :provider/states must contain unique identities`);
  }
  const defaultState = providerIdentity(input["provider/default-state"], `${label} :provider/default-state`);
  if (!states.includes(defaultState)) {
    throw new Error(`${label} :provider/default-state must occur in :provider/states`);
  }
  return deepFreeze({
    format: WORLD_PROVIDER_FORMAT,
    id: providerIdentity(input["provider/id"], `${label} :provider/id`),
    activity: providerIdentity(input["provider/activity"], `${label} :provider/activity`),
    package: packageCoordinate(input["provider/package"], `${label} :provider/package`),
    defaultState,
    states,
  });
}

function normalizeProviderInput(value) {
  if (value?.format !== WORLD_PROVIDER_FORMAT) return normalizeWorldProvider(value);
  const input = exactObject(value, "World provider", NORMALIZED_FIELDS);
  return normalizeWorldProvider({
    "provider/id": input.id,
    "provider/activity": input.activity,
    "provider/package": input.package,
    "provider/default-state": input.defaultState,
    "provider/states": input.states,
  }, "World provider");
}

export function createWorldProviderLaunchIntent(value, {state} = {}) {
  const provider = normalizeProviderInput(value);
  const selectedState = state === undefined
    ? provider.defaultState
    : providerIdentity(state, "World provider launch state");
  if (!provider.states.includes(selectedState)) {
    throw new Error(`World provider does not declare state ${selectedState}`);
  }
  return deepFreeze({
    format: WORLD_PROVIDER_LAUNCH_FORMAT,
    providerId: provider.id,
    activityId: provider.activity,
    package: provider.package,
    state: selectedState,
  });
}

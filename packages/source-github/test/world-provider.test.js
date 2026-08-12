import assert from "node:assert/strict";
import test from "node:test";
import {
  WORLD_PROVIDER_FORMAT,
  WORLD_PROVIDER_LAUNCH_FORMAT,
  createWorldProviderLaunchIntent,
  normalizeWorldProvider,
} from "../src/world-provider.js";
import {
  WORLD_PROVIDER_LAUNCH_FORMAT as VIEWER_LAUNCH_FORMAT,
  normalizeWorldProviderLaunch,
} from "../../viewer/src/world-provider-host.js";

const peacockBallroom = Object.freeze({
  "provider/id": "alumbra/world",
  "provider/activity": "alumbra-hara/peacock-ballroom",
  "provider/package": "hara:greenways/alumbra-peacock-ballroom@0.1.0",
  "provider/default-state": "ballroom/day",
  "provider/states": [
    "ballroom/day",
    "ballroom/gallery-overlook",
    "ballroom/mosaic-floor",
  ],
});

test("normalizes a closed released provider-backed world descriptor", () => {
  const provider = normalizeWorldProvider(peacockBallroom);
  assert.equal(WORLD_PROVIDER_FORMAT, "hodos.world-provider/1");
  assert.deepEqual(provider, {
    format: WORLD_PROVIDER_FORMAT,
    id: "alumbra/world",
    activity: "alumbra-hara/peacock-ballroom",
    package: "hara:greenways/alumbra-peacock-ballroom@0.1.0",
    defaultState: "ballroom/day",
    states: [
      "ballroom/day",
      "ballroom/gallery-overlook",
      "ballroom/mosaic-floor",
    ],
  });
  assert.ok(Object.isFrozen(provider));
  assert.ok(Object.isFrozen(provider.states));
});

test("source launch intents enter the released viewer host unchanged", () => {
  assert.equal(WORLD_PROVIDER_LAUNCH_FORMAT, "hodos.world-provider-launch/1");
  assert.equal(WORLD_PROVIDER_LAUNCH_FORMAT, VIEWER_LAUNCH_FORMAT);
  const provider = normalizeWorldProvider(peacockBallroom);
  const launch = createWorldProviderLaunchIntent(provider);
  assert.deepEqual(launch, {
    format: VIEWER_LAUNCH_FORMAT,
    providerId: "alumbra/world",
    activityId: "alumbra-hara/peacock-ballroom",
    package: "hara:greenways/alumbra-peacock-ballroom@0.1.0",
    state: "ballroom/day",
  });
  assert.deepEqual(normalizeWorldProviderLaunch(launch), launch);

  const selected = createWorldProviderLaunchIntent(provider, {state: "ballroom/mosaic-floor"});
  assert.equal(selected.state, "ballroom/mosaic-floor");
  assert.deepEqual(normalizeWorldProviderLaunch(selected), selected);
  assert.throws(
    () => createWorldProviderLaunchIntent(provider, {state: "ballroom/evening"}),
    /does not declare state/,
  );
});

test("rejects open, duplicate, inconsistent and host-invalid descriptors", () => {
  assert.throws(
    () => normalizeWorldProvider({...peacockBallroom, callback: "launch"}),
    /unknown field callback/,
  );
  assert.throws(
    () => normalizeWorldProvider({
      ...peacockBallroom,
      "provider/states": ["ballroom/day", "ballroom/day"],
    }),
    /unique identities/,
  );
  assert.throws(
    () => normalizeWorldProvider({
      ...peacockBallroom,
      "provider/default-state": "ballroom/evening",
    }),
    /must occur/,
  );
  assert.throws(
    () => normalizeWorldProvider({
      ...peacockBallroom,
      "provider/package": "https://example.test/world.js",
    }),
    /exact hara: or npm:/,
  );
  assert.throws(
    () => normalizeWorldProvider({...peacockBallroom, "provider/id": "Alumbra/world"}),
    /provider\/id is invalid/,
  );
  assert.throws(
    () => normalizeWorldProvider({...peacockBallroom, "provider/states": ["Ballroom/day"]}),
    /provider\/states\[0\] is invalid/,
  );
  assert.throws(
    () => normalizeWorldProvider({
      ...peacockBallroom,
      "provider/package": "hara:Greenways/alumbra@1.0.0",
    }),
    /exact hara: or npm:/,
  );
});

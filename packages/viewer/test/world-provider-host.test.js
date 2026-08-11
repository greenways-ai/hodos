import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorldProviderHost,
  createWorldProviderRegistry,
  normalizeWorldProviderLaunch,
} from "../src/world-provider-host.js";

const launch = Object.freeze({
  format: "hodos.world-provider-launch/1",
  providerId: "alumbra/world",
  activityId: "alumbra-hara/peacock-ballroom",
  package: "hara:greenways/alumbra-peacock-ballroom@0.1.0",
  state: "ballroom/day",
});

class FakeRoot {
  constructor() { this.children = []; }
  replaceChildren(...children) { this.children = children; }
}

function provider(factory) {
  return {
    providerId: "alumbra/world",
    activities: {
      "alumbra-hara/peacock-ballroom": {
        package: "hara:greenways/alumbra-peacock-ballroom@0.1.0",
        defaultState: "ballroom/day",
        states: [
          "ballroom/day",
          "ballroom/gallery-overlook",
          "ballroom/mosaic-floor",
        ],
      },
    },
    factory,
    metadata: {label: "Alumbra", version: "0.1.0", source: "greenways-ai/alumbra"},
  };
}

test("normalizes a closed provider launch without host paths or callbacks", () => {
  assert.deepEqual(normalizeWorldProviderLaunch(launch), launch);
  assert.throws(
    () => normalizeWorldProviderLaunch({...launch, url: "https://example.test"}),
    /unknown field url/,
  );
  assert.throws(
    () => normalizeWorldProviderLaunch({...launch, state: "../../escape"}),
    /state is invalid/,
  );
});

test("rejects unknown provider, activity, package and state before allocation", async () => {
  let allocations = 0;
  const registry = createWorldProviderRegistry([provider(() => {
    allocations += 1;
    return {};
  })]);
  const host = createWorldProviderHost({root: new FakeRoot(), registry});

  for (const candidate of [
    {...launch, providerId: "missing/world"},
    {...launch, activityId: "alumbra-hara/missing"},
    {...launch, package: "hara:greenways/alumbra-peacock-ballroom@9.9.9"},
    {...launch, state: "ballroom/missing"},
  ]) {
    await assert.rejects(host.open(candidate), /not installed|does not install|package mismatch/);
  }
  assert.equal(allocations, 0);
  assert.equal(host.snapshot().status, "idle");
});

test("allocates only the installed factory and disposes it before the next state", async () => {
  const root = new FakeRoot();
  const events = [];
  const registry = createWorldProviderRegistry([provider(({root: target, launch: value}) => {
    events.push(`open:${value.state}`);
    const node = {state: value.state};
    target.replaceChildren(node);
    return {
      snapshot: () => ({state: value.state}),
      destroy: async (reason) => events.push(`destroy:${value.state}:${reason}`),
    };
  })]);
  const host = createWorldProviderHost({root, registry});

  const first = await host.open(launch, {repository: "greenways-ai/alumbra"});
  assert.equal(first.status, "ready");
  assert.equal(first.allocations, 1);
  assert.equal(root.children[0].state, "ballroom/day");

  const second = await host.open({...launch, state: "ballroom/gallery-overlook"});
  assert.equal(second.allocations, 2);
  assert.equal(second.disposals, 1);
  assert.equal(root.children[0].state, "ballroom/gallery-overlook");
  assert.deepEqual(events, [
    "open:ballroom/day",
    "destroy:ballroom/day:provider-switch",
    "open:ballroom/gallery-overlook",
  ]);

  const disposed = await host.destroy();
  assert.equal(disposed.status, "disposed");
  assert.equal(disposed.disposals, 2);
  assert.deepEqual(root.children, []);
});

test("keeps registry evidence bounded and rejects duplicate providers", () => {
  const registry = createWorldProviderRegistry();
  registry.register(provider(() => ({})));
  assert.throws(() => registry.register(provider(() => ({}))), /already installed/);
  assert.deepEqual(registry.snapshot(), {
    format: "hodos.world-provider-registry/1",
    providers: ["alumbra/world"],
    providerCount: 1,
    activityCount: 1,
  });
  assert.doesNotMatch(JSON.stringify(registry.snapshot()), /factory|iframe|url|callback/);
});

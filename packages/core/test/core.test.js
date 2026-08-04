import assert from "node:assert/strict";
import test from "node:test";
import { createHodosHost, defineAddon, satisfiesAddonVersion } from "../src/index.js";

const addon = (id, { requires = {}, capabilities = [], activate } = {}) => defineAddon({
  manifest: { id, version: "1.0.0", requires, capabilities },
  activate,
});

test("host activates dependencies before add-ons and scopes contributions", async () => {
  const order = [];
  const host = createHodosHost({ capabilities: ["workspace.write"] });
  host.register(
    addon("core", { activate: (context) => { order.push("core"); context.contribute("service", "events", { append: true }); } }),
    addon("authoring", {
      requires: { core: "^1.0.0" },
      capabilities: ["workspace.write"],
      activate: (context) => { order.push("authoring"); assert.deepEqual(context.getContribution("service", "events"), { append: true }); },
    }),
  );
  await host.activate("authoring");
  assert.deepEqual(order, ["core", "authoring"]);
  assert.deepEqual(host.active(), ["core", "authoring"]);
  assert.equal(host.listContributions("service")[0].owner, "core");
  await assert.rejects(host.deactivate("core"), /active dependents: authoring/);
  await host.deactivate("core", { cascade: true });
  assert.deepEqual(host.active(), []);
  assert.equal(host.getContribution("service", "events"), undefined);
});

test("host rejects missing capabilities and dependency cycles", async () => {
  const missing = createHodosHost().register(addon("publisher", { capabilities: ["publication.write"] }));
  await assert.rejects(missing.activate("publisher"), /publication\.write/);

  const cyclic = createHodosHost().register(
    addon("a", { requires: { b: "*" } }),
    addon("b", { requires: { a: "*" } }),
  );
  await assert.rejects(cyclic.activate("a"), /a -> b -> a/);
});

test("add-on contexts expose only declared host capabilities", async () => {
  const host = createHodosHost({ capabilities: ["workspace.read", "workspace.write"] });
  host.register(addon("reader", {
    capabilities: ["workspace.read"],
    activate(context) {
      assert.equal(context.capabilities.has("workspace.read"), true);
      assert.equal(context.capabilities.has("workspace.write"), false);
      assert.deepEqual(context.capabilities.values(), ["workspace.read"]);
      assert.throws(
        () => context.capabilities.require("workspace.write"),
        /did not declare host capability/,
      );
    },
  }));
  await host.activate("reader");
});

test("dependency ranges use semantic-version compatibility", async () => {
  assert.equal(satisfiesAddonVersion("1.4.0", "^1.2.0"), true);
  assert.equal(satisfiesAddonVersion("2.0.0", "^1.2.0"), false);
  assert.equal(satisfiesAddonVersion("0.2.3", "^0.2.0"), true);
  assert.equal(satisfiesAddonVersion("0.3.0", "^0.2.0"), false);
  const host = createHodosHost().register(
    addon("core"),
    addon("future", { requires: { core: "^2.0.0" } }),
  );
  await assert.rejects(host.activate("future"), /requires core \^2\.0\.0; registered 1\.0\.0/);
});

test("curated distributions can share the same add-on instance", () => {
  const core = addon("core");
  const host = createHodosHost().register([core], [core]);
  assert.deepEqual(host.registered().map(({ id }) => id), ["core"]);
  assert.throws(
    () => host.register(addon("core")),
    /already registered: core/,
  );
});

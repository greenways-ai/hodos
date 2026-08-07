import assert from "node:assert/strict";
import test from "node:test";
import {
  HODOS_DEV_PROBLEMS_AREA_TYPE,
  HODOS_DEV_PROBLEMS_COMPONENT_ID,
  createProblemsArea,
} from "../src/index.js";

test("Problems area projects text and located diagnostics with derived counts", () => {
  const area = createProblemsArea({
    status: "ready",
    problems: [
      {
        id: "problem/runtime-1",
        severity: "warning",
        message: "Canonical runtime fallback active",
        source: "runtime",
        requestId: "request-4",
      },
      {
        id: "problem/source-1",
        severity: "error",
        message: "Unable to resolve symbol card",
        code: "resolver/unbound-symbol",
        source: "compiler",
        path: "src/main.hal",
        namespace: "app.core",
        range: {
          start: { line: 3, column: 4, offset: 38 },
          end: { line: 3, column: 8, offset: 42 },
        },
        tags: ["compile", "source", "compile"],
        metadata: { recoverable: true },
      },
    ],
    selectedId: "problem/source-1",
    filter: { severity: "error", query: "symbol" },
    metadata: { generation: 7 },
  });
  const component = area["area/component"];
  const model = component["component/model"];

  assert.equal(area["area/type"], HODOS_DEV_PROBLEMS_AREA_TYPE);
  assert.equal(component["component/id"], HODOS_DEV_PROBLEMS_COMPONENT_ID);
  assert.equal(component["component/contract"], "workspace.component/1");
  assert.deepEqual(model.counts, {
    total: 2,
    error: 1,
    warning: 1,
    info: 0,
    hint: 0,
  });
  assert.equal(model.selection.id, "problem/source-1");
  assert.deepEqual(model.problems[1].range.start, { line: 3, column: 4, offset: 38 });
  assert.deepEqual(model.problems[1].tags, ["compile", "source"]);
  assert.equal(JSON.parse(JSON.stringify(area))["area/id"], "problems/main");
});

test("Problems area validates severity, ranges, filters and selection identity", () => {
  assert.throws(() => createProblemsArea({ status: "busy" }), /Unsupported.*status/);
  assert.throws(() => createProblemsArea({
    problems: [{ id: "problem/1", severity: "fatal", message: "bad" }],
  }), /unsupported severity/);
  assert.throws(() => createProblemsArea({
    problems: [{ id: "problem/1", message: "" }],
  }), /message must be a non-empty string/);
  assert.throws(() => createProblemsArea({
    problems: [{
      id: "problem/1",
      message: "bad range",
      range: { start: { line: 2, column: 4 }, end: { line: 1, column: 9 } },
    }],
  }), /end must not precede start/);
  assert.throws(() => createProblemsArea({ filter: { severity: "fatal" } }), /filter severity/);
  assert.throws(() => createProblemsArea({ filter: { query: 2 } }), /query must be a string/);
  assert.throws(() => createProblemsArea({
    problems: [{ id: "problem/1", message: "known" }],
    selectedId: "problem/missing",
  }), /selected id is not present/);
});

test("serializable metadata preserves special keys without changing prototypes", () => {
  const metadata = JSON.parse('{"__proto__":{"polluted":true},"constructor":"safe"}');
  const area = createProblemsArea({ metadata });
  const projected = area["area/component"]["component/model"].metadata;
  assert.equal(Object.getPrototypeOf(projected), Object.prototype);
  assert.equal(Object.hasOwn(projected, "__proto__"), true);
  assert.deepEqual(projected["__proto__"], { polluted: true });
  assert.equal(projected.constructor, "safe");
  assert.equal({}.polluted, undefined);
});

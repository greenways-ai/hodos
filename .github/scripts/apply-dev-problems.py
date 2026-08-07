#!/usr/bin/env python3
from pathlib import Path
from textwrap import dedent

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(dedent(content).lstrip("\n"), encoding="utf-8")


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return source.replace(old, new, 1)


def update_dev_model() -> None:
    path = "packages/dev/src/index.js"
    source = read(path)

    source = replace_once(
        source,
        '''    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = serializableValue(entry, `${label}.${key}`, ancestors);
    }
    return Object.freeze(output);''',
        '''    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      Object.defineProperty(output, key, {
        value: serializableValue(entry, `${label}.${key}`, ancestors),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(output);''',
        "serializable object hardening",
    )

    helper_anchor = '''const replEntryValue = (entry, index) => {'''
    helpers = r'''
const PROBLEM_SEVERITIES = new Set(["error", "warning", "info", "hint"]);
const PROBLEM_STATUSES = new Set(["idle", "collecting", "ready", "error"]);

const problemPositionValue = (value = {}, label = "Hodos Dev Problems position") => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const line = Number(value.line ?? 0);
  const column = Number(value.column ?? 0);
  const offset = value.offset == null ? null : Number(value.offset);
  if (!Number.isSafeInteger(line) || line < 0 || !Number.isSafeInteger(column) || column < 0) {
    throw new TypeError(`${label} line and column must be non-negative integers`);
  }
  if (offset != null && (!Number.isSafeInteger(offset) || offset < 0)) {
    throw new TypeError(`${label} offset must be a non-negative integer`);
  }
  return Object.freeze({ line, column, offset });
};

const problemRangeValue = (value, label = "Hodos Dev Problems range") => {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const start = problemPositionValue(value.start ?? {}, `${label} start`);
  const end = problemPositionValue(value.end ?? value.start ?? {}, `${label} end`);
  const endBeforeStart = end.line < start.line
    || (end.line === start.line && end.column < start.column)
    || (start.offset != null && end.offset != null && end.offset < start.offset);
  if (endBeforeStart) throw new TypeError(`${label} end must not precede start`);
  return Object.freeze({ start, end });
};

const problemTagsValue = (value = [], label = "Hodos Dev Problems tags") => {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return Object.freeze([
    ...new Set(value.map((entry, index) => nonEmptyString(entry, `${label} ${index}`))),
  ]);
};

const problemEntryValue = (entry, index) => {
  const label = `Hodos Dev Problems entry ${index}`;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError(`${label} must be an object`);
  }
  const severity = nonEmptyString(entry.severity ?? "error", `${label} severity`);
  if (!PROBLEM_SEVERITIES.has(severity)) {
    throw new Error(`${label} has unsupported severity: ${severity}`);
  }
  const metadata = entry.metadata ?? {};
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError(`${label} metadata must be an object`);
  }
  return Object.freeze({
    id: nonEmptyString(entry.id, `${label} id`),
    severity,
    message: nonEmptyString(entry.message, `${label} message`),
    code: optionalString(entry.code, `${label} code`),
    source: optionalString(entry.source, `${label} source`),
    path: optionalString(entry.path, `${label} path`),
    namespace: optionalString(entry.namespace, `${label} namespace`),
    requestId: optionalString(entry.requestId, `${label} request id`),
    range: problemRangeValue(entry.range, `${label} range`),
    tags: problemTagsValue(entry.tags, `${label} tags`),
    metadata: serializableValue(metadata, `${label} metadata`),
  });
};

const problemFilterValue = (value = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hodos Dev Problems filter must be an object");
  }
  const severity = nonEmptyString(value.severity ?? "all", "Hodos Dev Problems filter severity");
  if (severity !== "all" && !PROBLEM_SEVERITIES.has(severity)) {
    throw new Error(`Unsupported Hodos Dev Problems filter severity: ${severity}`);
  }
  if (typeof (value.query ?? "") !== "string") {
    throw new TypeError("Hodos Dev Problems filter query must be a string");
  }
  return Object.freeze({ severity, query: value.query ?? "" });
};

const problemCountsValue = (problems) => {
  const counts = { total: problems.length, error: 0, warning: 0, info: 0, hint: 0 };
  for (const problem of problems) counts[problem.severity] += 1;
  return Object.freeze(counts);
};

'''
    source = replace_once(source, helper_anchor, helpers + helper_anchor, "Problems model helpers")

    constants_anchor = '''export function createPreviewArea({'''
    constants = r'''
export const HODOS_DEV_PROBLEMS_AREA_TYPE = "hodos.dev/problems";
export const HODOS_DEV_PROBLEMS_COMPONENT_ID = "hodos.dev/problems";
export const HODOS_DEV_PROBLEMS_EVENTS = Object.freeze([
  "problems/select",
  "problems/open-source",
  "problems/filter",
  "problems/clear",
  "problems/copy",
  "problems/close",
]);

'''
    source = replace_once(source, constants_anchor, constants + constants_anchor, "Problems constants")

    problems_factory = r'''

export function createProblemsArea({
  id = "problems/main",
  title = "Problems",
  status = "idle",
  problems = [],
  selectedId = null,
  filter = {},
  canClear = problems.length > 0,
  metadata = {},
  events = HODOS_DEV_PROBLEMS_EVENTS,
} = {}) {
  id = nonEmptyString(id, "Hodos Dev Problems area id");
  title = nonEmptyString(title, "Hodos Dev Problems title");
  status = nonEmptyString(status, "Hodos Dev Problems status");
  if (!PROBLEM_STATUSES.has(status)) {
    throw new Error(`Unsupported Hodos Dev Problems status: ${status}`);
  }
  if (!Array.isArray(problems)) throw new TypeError("Hodos Dev Problems problems must be an array");
  if (typeof canClear !== "boolean") throw new TypeError("Hodos Dev Problems canClear must be boolean");
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("Hodos Dev Problems metadata must be an object");
  }

  const projected = Object.freeze(problems.map(problemEntryValue));
  const selected = optionalString(selectedId, "Hodos Dev Problems selected id");
  if (selected && !projected.some((problem) => problem.id === selected)) {
    throw new Error(`Hodos Dev Problems selected id is not present: ${selected}`);
  }

  const model = Object.freeze({
    status,
    problems: projected,
    selection: Object.freeze({ id: selected }),
    filter: problemFilterValue(filter),
    counts: problemCountsValue(projected),
    canClear,
    metadata: serializableValue(metadata, "Hodos Dev Problems metadata"),
  });

  return Object.freeze({
    "area/id": id,
    "area/type": HODOS_DEV_PROBLEMS_AREA_TYPE,
    "area/title": title,
    "area/component": Object.freeze({
      "component/id": HODOS_DEV_PROBLEMS_COMPONENT_ID,
      "component/contract": WORKSPACE_COMPONENT_CONTRACT,
      "component/model": model,
      "component/events": Object.freeze([...events]),
    }),
  });
}
'''
    source = source.rstrip() + problems_factory
    write(path, source + "\n")


def update_dev_ui() -> None:
    path = "packages/dev-ui/src/index.js"
    source = read(path)
    source = replace_once(
        source,
        '''  HODOS_DEV_EDITOR_COMPONENT_ID,
  HODOS_DEV_PREVIEW_COMPONENT_ID,''',
        '''  HODOS_DEV_EDITOR_COMPONENT_ID,
  HODOS_DEV_PREVIEW_COMPONENT_ID,
  HODOS_DEV_PROBLEMS_COMPONENT_ID,''',
        "Problems component import",
    )
    source = replace_once(
        source,
        '''export const createReplComponentFactory = (options = {}) =>
  statefulComponentFactory("REPL", "createReplHost", "repl", options);

export const createValueInspectorComponentFactory''',
        '''export const createReplComponentFactory = (options = {}) =>
  statefulComponentFactory("REPL", "createReplHost", "repl", options);

export const createProblemsComponentFactory = (options = {}) =>
  statefulComponentFactory("Problems", "createProblemsHost", "problems", options);

export const createValueInspectorComponentFactory''',
        "Problems component factory",
    )
    source = replace_once(
        source,
        '''export function registerHodosReplUi(registry, options = {}) {
  return register(
    registry,
    HODOS_DEV_REPL_COMPONENT_ID,
    createReplComponentFactory(options),
    "registerHodosReplUi",
  );
}

export function registerHodosValueInspectorUi''',
        '''export function registerHodosReplUi(registry, options = {}) {
  return register(
    registry,
    HODOS_DEV_REPL_COMPONENT_ID,
    createReplComponentFactory(options),
    "registerHodosReplUi",
  );
}

export function registerHodosProblemsUi(registry, options = {}) {
  return register(
    registry,
    HODOS_DEV_PROBLEMS_COMPONENT_ID,
    createProblemsComponentFactory(options),
    "registerHodosProblemsUi",
  );
}

export function registerHodosValueInspectorUi''',
        "Problems registration",
    )
    source = replace_once(
        source,
        '''    disposers.push(registerHodosEditorUi(registry, options));
    disposers.push(registerHodosReplUi(registry, options));
    disposers.push(registerHodosValueInspectorUi(registry, options));''',
        '''    disposers.push(registerHodosEditorUi(registry, options));
    disposers.push(registerHodosReplUi(registry, options));
    disposers.push(registerHodosProblemsUi(registry, options));
    disposers.push(registerHodosValueInspectorUi(registry, options));''',
        "Problems combined registration",
    )
    write(path, source)


def write_hal() -> None:
    write("packages/dev/src/gw/hodos/dev/problems.hal", r'''
    (ns gw.hodos.dev.problems)

    (def component-id "hodos.dev/problems")
    (def component-contract "workspace.component/1")
    (def events
      #{"problems/select"
        "problems/open-source"
        "problems/filter"
        "problems/clear"
        "problems/copy"
        "problems/close"})

    (defn model
      ([problems]
       (model problems {}))
      ([problems options]
       {:status (get options :status "idle")
        :problems problems
        :selection {:id (get options :selectedId nil)}
        :filter (get options :filter {:severity "all" :query ""})
        :counts (get options :counts {})
        :canClear (get options :canClear false)
        :metadata (get options :metadata {})}))

    (defn area
      ([id model]
       (area id "Problems" model))
      ([id title model]
       {:area/id id
        :area/type :hodos.dev/problems
        :area/title title
        :area/component
        {:component/id component-id
         :component/contract component-contract
         :component/model model
         :component/events events}}))
    ''')


def write_tests() -> None:
    write("packages/dev/test/problems.test.js", r'''
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
    ''')

    write("packages/dev-ui/test/problems-component.test.js", r'''
    import assert from "node:assert/strict";
    import test from "node:test";
    import { createProblemsArea } from "@greenways/hodos-dev";
    import { createHodosComponentRegistry } from "@greenways/hodos-web";
    import { createWorkspaceAreaHost } from "@greenways/hodos-workspace-ui";
    import { registerHodosProblemsUi } from "../src/index.js";

    test("Hodos Dev Problems adapts an injected host and routes semantic events", async () => {
      const calls = [];
      let send;
      const registry = createHodosComponentRegistry();
      const unregister = registerHodosProblemsUi(registry, {
        createProblemsHost({ container, dispatch }) {
          calls.push(["create", container]);
          send = dispatch;
          return {
            update(model) {
              calls.push(["update", model.status, model.counts.total, model.selection.id]);
            },
            dispose() {
              calls.push(["dispose"]);
            },
          };
        },
      });
      const root = { dataset: {} };
      const events = [];
      const host = createWorkspaceAreaHost({
        root,
        registry,
        dispatch: (event) => events.push(event),
      });

      host.open(createProblemsArea({ status: "collecting" }));
      await send({ "event/type": "problems/filter", severity: "warning", query: "runtime" });
      host.update(createProblemsArea({
        status: "ready",
        problems: [{ id: "problem/1", severity: "warning", message: "Runtime fallback" }],
        selectedId: "problem/1",
      }));
      host.destroy();
      unregister();

      assert.deepEqual(calls, [
        ["create", root],
        ["update", "collecting", 0, null],
        ["update", "ready", 1, "problem/1"],
        ["dispose"],
      ]);
      assert.deepEqual(events, [{
        "event/type": "problems/filter",
        severity: "warning",
        query: "runtime",
        "component/id": "hodos.dev/problems",
        "area/id": "problems/main",
      }]);
      assert.equal(registry.has("hodos.dev/problems"), false);
    });

    test("Hodos Dev Problems host must implement update", () => {
      const registry = createHodosComponentRegistry();
      registerHodosProblemsUi(registry, { createProblemsHost() { return {}; } });
      const host = createWorkspaceAreaHost({ root: { dataset: {} }, registry });
      assert.throws(() => host.open(createProblemsArea()), /must implement update/);
    });
    ''')


def update_readmes() -> None:
    write("packages/dev/README.md", r'''
    # @greenways/hodos-dev

    HAL-first developer Workspace models for Hodos.

    The package currently defines serializable Preview, Editor, REPL, Problems
    and Value Inspector areas without introducing a second Workspace model:

    ```js
    import {
      createEditorArea,
      createPreviewArea,
      createProblemsArea,
      createReplArea,
      createValueInspectorArea,
    } from "@greenways/hodos-dev";

    const editor = createEditorArea({
      documentId: "document/main",
      path: "src/main.hal",
      source: "(ns app.core)",
      namespace: "app.core",
    });

    const preview = createPreviewArea({
      output: { type: "render", tree: ["main", "Ready"] },
      theme: "dark",
    });

    const repl = createReplArea({
      sessionId: "session/project",
      namespace: "app.core",
      status: "ready",
      entries: [{ kind: "result", text: "3", valueId: "value-1" }],
    });

    const problems = createProblemsArea({
      status: "ready",
      problems: [{
        id: "problem/runtime-1",
        severity: "warning",
        message: "Canonical runtime fallback active",
        source: "runtime",
      }],
    });

    const value = createValueInspectorArea({
      valueId: "value-1",
      status: "ready",
      display: "{:answer 42}",
      value: { answer: 42 },
      namespace: "app.core",
    });
    ```

    HAL owns document, session, diagnostic and retained-value identity, source
    versions, selections, REPL history and entries, problem filters and counts,
    inspector paths, completion models, commands and semantic events. Visible
    developer mechanics are supplied by `@greenways/hodos-dev-ui` through
    injected, trusted hosts.

    Problems models accept text-only runtime diagnostics and optional source,
    path, namespace, request, code, range, tag and metadata projections. Runtime
    diagnostic production and source-opening policy remain injected Hara and host
    responsibilities.

    Value Inspector models carry only serializable projected data. Runtime value
    retention, evaluation and inspection requests remain injected Hara service
    responsibilities.
    ''')

    write("packages/dev-ui/README.md", r'''
    # @greenways/hodos-dev-ui

    Visible Hodos developer components driven by HAL-shaped Workspace models.

    The package currently registers Preview, Editor, REPL, Problems and Value
    Inspector components:

    - Preview adapts an injected Hara sandbox/iframe service;
    - Editor adapts an injected trusted editor host;
    - REPL adapts an injected session-console host;
    - Problems adapts an injected diagnostic-list host;
    - Value Inspector adapts an injected structured-value host;
    - every component routes only declared semantic events back to HAL.

    ```js
    import { registerHodosDevUi } from "@greenways/hodos-dev-ui";

    const unregister = registerHodosDevUi(registry, {
      createPreviewHost: (options) => haraPreviewService.create(options),
      createEditorHost: ({ container, dispatch }) => createEditorHost(container, dispatch),
      createReplHost: ({ container, dispatch }) => createReplHost(container, dispatch),
      createProblemsHost: ({ container, dispatch }) => createProblemsHost(container, dispatch),
      createValueInspectorHost: ({ container, dispatch }) =>
        createValueInspectorHost(container, dispatch),
    });
    ```

    Hodos owns visible Workspace components and semantic-event boundaries. Hara
    browser services continue to own runtime transport, diagnostic production,
    retained values, low-level editor transforms, preview isolation, storage and
    privileged resource policy.
    ''')


def clean_staging_files() -> None:
    for relative in (
        ".github/scripts/apply-dev-problems.py",
        ".github/workflows/apply-dev-problems.yml",
    ):
        target = ROOT / relative
        if target.exists():
            target.unlink()


def main() -> None:
    update_dev_model()
    update_dev_ui()
    write_hal()
    write_tests()
    update_readmes()
    clean_staging_files()


if __name__ == "__main__":
    main()

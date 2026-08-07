# @greenways/hodos-web

Trusted component registration and lifecycle contracts for projecting Hara Workspace values through Hodos.

The package is independent of the DOM, Hara VM, Playground, PlayCanvas and Greenways OS. Hosts inject roots, services and semantic event dispatchers.

```js
import {
  createHodosComponentHost,
  createHodosComponentRegistry,
} from "@greenways/hodos-web";

const registry = createHodosComponentRegistry();
registry.register("example/component", ({ model }) => ({
  update(nextModel) {},
  destroy() {},
}));

const host = createHodosComponentHost({ root, registry, dispatch });
host.mount({
  "component/id": "example/component",
  "component/model": { ready: true },
  "component/events": ["example/change"],
});
```

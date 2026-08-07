# @greenways/hodos-dev-ui

Visible Hodos developer components driven by HAL-shaped models.

The initial Preview component adapts an injected Hara preview service. Hodos owns the visible Workspace component; Hara remains responsible for sandboxing and browser-resource policy.

```js
import { registerHodosDevUi } from "@greenways/hodos-dev-ui";

registerHodosDevUi(registry, {
  createPreviewHost: (options) => haraPreviewService.create(options),
});
```

# @greenways/hodos-dev

HAL-first developer Workspace models for Hodos.

The initial package defines a serializable Preview area. Editor, explorer, REPL, diagnostics and Catalog areas will follow without introducing a second Workspace model.

```js
import { createPreviewArea } from "@greenways/hodos-dev";

const area = createPreviewArea({
  output: { type: "render", tree: ["main", "Ready"] },
  theme: "dark",
});
```

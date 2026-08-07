# @greenways/hodos-workspace-ui

Visible area-hosting primitives for Hara Workspaces.

This first slice mounts one trusted Hodos component into one Workspace area and preserves area identity on semantic events. Recursive layouts, menus, sidebars and responsive shell behavior will build on this boundary.

```js
import { createWorkspaceAreaHost } from "@greenways/hodos-workspace-ui";

const area = createWorkspaceAreaHost({ root, registry, dispatch });
area.open(workspaceAreaDescriptor);
area.update(nextWorkspaceAreaDescriptor);
area.destroy();
```

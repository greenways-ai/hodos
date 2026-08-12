# Client-side skeleton authoring

This document defines the first visual authoring slice of the Hodos Rigging
Harness. It builds on the portable rig kernel and local GLB preflight without
changing their authority boundary.

## Data flow

```text
local File / Blob
  → LocalRiggingAssetHost
  → rig-asset:<session>:<sequence>
  → RiggingAuthoringRenderer
      ├─ local GLB render entity
      ├─ local joint and bone helpers
      └─ local pointer preview
  → one semantic intent on commit
  → hodos.rig-authoring/0-alpha
      ├─ hodos.rig/0-alpha
      ├─ hodos.rig-editor/0-alpha
      └─ bounded undo / redo snapshots
```

The opaque asset handle is sufficient to display the local model. The renderer
may inspect copied bytes through the trusted host API, but the bytes, decoded
container, PlayCanvas entities and GPU resources are not serialised into Hodos
state.

## Portable authoring state

`hodos.rig-editor/0-alpha` owns only UI semantics:

```clojure
{:schema "hodos.rig-editor/0-alpha"
 :mode "edit"
 :tool "translate"
 :space "world"
 :selection ["left-wing-tip"]
 :active "left-wing-tip"
 :focused "left-wing-tip"
 :expanded ["root" "left-wing-base"]
 :snap {:enabled true
        :mode "surface"
        :translate 0.01
        :depth 0
        :surfaceOffset 0}}
```

`hodos.rig-authoring/0-alpha` combines the canonical rig, editor state,
recoverable local session, most recent outcome/evidence, and bounded history.
History snapshots contain only the rig document and editor semantics. Source
bytes are not copied into each undo entry.

## Commit boundary

Pointer movement is intentionally not a Hodos operation:

```text
pointerdown
  → capture joint and drag plane
pointermove
  → update host-local helper entities
pointerup
  → emit one revision-checked rig/joint-update intent
pointercancel
  → discard preview and restore canonical projection
```

This prevents high-frequency pointer samples from flooding history, sync or
agent evidence while preserving exact undo/redo at user-visible boundaries.

## Hierarchy operations

The first workbench supports arbitrary acyclic skeletons rather than a humanoid
template:

```text
rig/joint-create
rig/joint-update
rig/joint-rename
rig/joint-reparent
rig/joint-delete
rig/joint-duplicate
rig/joint-mirror
```

Duplicate and mirror operate on explicit selected sets. Parent relationships are
rewritten only when both parent and child are inside that set. Duplicate applies
a displacement only to selected roots so copied descendants keep their local
rest transforms. Mirror uses an explicit ID map and reports naming collisions
before the intent is committed.

## Placement modes

- `surface`: use an injected trusted mesh picker when available; otherwise use
  the preflight world bounds as a conservative fallback.
- `depth`: intersect a camera-facing plane through the active joint.
- `grid`: intersect the source floor plane.
- `none`: preserve the unsnapped computed point.

The first reference provider does not claim triangle-accurate surface snapping
unless a mesh picker is installed. A later provider can add an acceleration
structure behind the same host-local boundary.

## Accessibility

The hierarchy uses a keyboard-operable tree with:

- `aria-level`, `aria-expanded` and `aria-selected`;
- roving `tabindex` focus;
- Arrow Up/Down traversal;
- Arrow Right expansion or first-child movement;
- Arrow Left collapse or parent movement; and
- Enter/Space selection.

Global shortcuts are ignored while an input, textarea, select or editable field
has focus. Joint controls use screen-space picking with a touch-sized radius;
visible geometry remains a separate GPU projection.

## Deliberate limits

This slice does not implement skin weights, IK, animation clips, mesh repair or
GLB export. Those remain in #66, #67 and #68. It establishes the editing and
history boundary those later slices will reuse.

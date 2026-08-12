# Portable rig workfiles

Hodos rig workfiles preserve the editable skeleton independently of both the
source GLB bytes and the later compiled rigged GLB.

```text
local GLB bytes
  → opaque asset handle
  → hodos.rig-authoring/0-alpha
  → hodos.rig-workfile/0-alpha
```

The workfile contains:

- source content identity and optional display metadata;
- the normalized `hodos.rig/0-alpha` document;
- optional `hodos.rig-editor/0-alpha` selection, focus, expansion and tool state;
- the bounded history limit; and
- caller-supplied portable metadata.

It deliberately omits:

- GLB bytes, decoded glTF JSON, accessors and topology;
- PlayCanvas entities and GPU resources;
- local opaque handles and preflight records;
- pointer or brush previews;
- undo and redo snapshots; and
- the last renderer outcome or evidence record.

## Deterministic representations

`createRigWorkfile` returns a plain value that is compatible with Hodos/Hara
portable data conventions. `serializeRigWorkfileJson` sorts map keys
recursively and produces deterministic UTF-8 JSON. `serializeRigWorkfileEdn`
produces deterministic EDN-compatible text using string map keys, vectors and
portable scalar values.

Both representations are bounded before they are returned. JSON is also
bounded before parsing, so an oversized file is rejected before materializing a
large object graph.

## Source reconciliation

Restoration requires an active local source. The default `reject` policy accepts
only an exact content-identity match.

The explicit `rebind` policy may apply the saved skeleton to another active
source. Rebinding:

- changes `document.assetId` to the active source identity;
- advances the rig revision;
- preserves the joint hierarchy, rest transforms and constraints; and
- clears accepted weight and inverse-bind artifact identities because those
  artifacts belong to the previous mesh.

A rejected, malformed or mismatched workfile returns a structured result and
leaves canonical authoring state unchanged.

## Browser autosave

`RigWorkfileAutosave` depends only on an injected asynchronous provider:

```js
{
  get(key),
  set(key, text),
  delete(key)
}
```

The UI package includes Web Storage and in-memory adapters. Autosaves are keyed
by source content identity, coalesce repeated edits, and store the same bounded
JSON workfile used by manual download. After a browser reload, the user reopens
the local GLB; the workspace then restores only the autosave whose content
identity matches that source.

Autosave is local convenience, not cloud sync, asset persistence or compiled
GLB export.

# Local rig binding and immutable weight artifacts

Hodos separates editable rig authority from frame-hot skin data:

```text
hodos.rig/0-alpha
  stable joint identities and rest transforms
          |
          v
opaque local GLB handle
  bindable world-space geometry
  source vertex identity
  triangle adjacency
  connected components
          |
          v
worker-capable deterministic strategy
  nearest-segment smooth binding
  rigid-component binding
          |
          v
immutable host artifacts
  weights:sha256:...
  bind:sha256:...
          |
          v
rig/skin-attach
  portable artifact identities only
```

## Binding geometry

The PlayCanvas provider extracts only locally readable triangle geometry from
the accepted GLB. Each host vertex records its node, mesh, primitive, and source
vertex identity. CSR adjacency and connected-component IDs are retained for
later smoothing, flood operations, and diagnostics.

Sparse, external, Draco, Meshopt, non-triangle, malformed, non-finite, and
out-of-bound geometry fails explicitly. Vertex, triangle, adjacency, primitive,
node, and retained-byte limits are applied before accepting the geometry.

## Deterministic strategies

Nearest-segment binding uses the existing renderer-neutral Hodos algorithm.
Rigid-component binding computes one centroid for every disconnected component
and assigns the complete component to the nearest authored joint segment.
Neither strategy assumes humanoid anatomy.

The task protocol is Worker-capable. Browser providers may inject a module
Worker factory, while tests and restricted hosts run the identical operation
inline.

## Content identity

A weight identity includes:

- provider and task versions;
- source content identity;
- rig ID and revision;
- stable joint ordering;
- vertex and influence counts;
- strategy parameters;
- inverse-bind artifact identity; and
- canonical little-endian joint and weight bytes.

Inverse-bind identity includes source identity, rig identity/revision, joint
ordering, and canonical matrix bytes. Identical accepted inputs therefore
produce identical IDs even in separate browser sessions.

## Ownership and disposal

Portable Hodos state sees artifact IDs and bounded evidence only. Geometry,
adjacency, weight arrays, component assignments, inverse matrices, and Worker
transfer buffers remain private to the local asset host. Release and destroy
zero every retained typed array before dropping its record.

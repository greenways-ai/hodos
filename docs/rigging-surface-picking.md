# Triangle-accurate local rigging surface picking

Hodos surface placement is a renderer-host capability. The portable rig and
editor documents contain only the selected placement mode and the resulting
joint transform. They never contain source vertices, triangles, acceleration
nodes, accessor views, or raycast caches.

```text
local GLB handle
  → validated local accessors
  → active-scene mesh instances
  → transformed world-space triangles
  → bounded BVH behind the handle
  → transient ray hit
  → one revision-checked rig intent
```

## Construction boundary

`LocalRiggingAssetHost.prepareSurface(handle)` builds the index lazily. It
supports indexed and non-indexed `TRIANGLES`, `TRIANGLE_STRIP`, and
`TRIANGLE_FAN` primitives. Node transforms are composed before indexing, so a
mesh instantiated by multiple transformed nodes contributes a distinct surface
instance.

Construction fails closed for external buffers, sparse accessors, compressed
geometry without a decoder, malformed transforms, out-of-range indices, and
explicit node, primitive, triangle, and memory limits. Extraction and BVH
construction yield at bounded intervals so a supported large model does not
monopolize the browser task queue.

The first provider uses a median-split axis-aligned bounding-volume hierarchy.
This is intentionally private to the PlayCanvas host and may be replaced without
changing portable Hodos values.

## Raycast boundary

`LocalRiggingAssetHost.raycastSurface(handle, ray)` performs synchronous BVH
traversal for pointer-time placement. It returns only a transient bounded value:

```js
{
  point: [x, y, z],
  normal: [nx, ny, nz],
  distance: 1.25,
  backFacing: false,
  nodeIndex: 4,
  meshIndex: 2,
  primitiveIndex: 0,
  triangleIndex: 17
}
```

The caller may select front, back, or double-sided behavior and apply a finite
offset along the returned camera-facing normal. BVH node and triangle tests have
independent limits. Exceeding either limit returns a structured capability
failure rather than a partial or misleading hit.

## Fallback and lifecycle

`RiggingAuthoringRenderer` asks the opaque asset host for a triangle hit when the
editor uses `surface` placement. A missing, unsupported, or bounded-out index
falls back to the existing source-bounds placement, then to depth placement.
This preserves editing even when a particular primitive needs a decoder or mesh
repair.

Releasing an asset or destroying its host zeros the private triangle, metadata,
centroid, bounds, ordering, and BVH buffers before removing the record. Portable
session, rig, history, and evidence values remain unchanged.

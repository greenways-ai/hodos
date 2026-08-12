# Bounded rig weight editing

Hodos repairs accepted skin weights through immutable host-owned artifacts. The
portable rig document records only the active weight and inverse-bind artifact
identities.

```text
accepted weights
  → opaque vertex selection
  → host-local edit preview
  → validation and adjacency diagnostics
  → immutable content-addressed weight artifact
  → rig/skin-attach
```

## Opaque selections

The local PlayCanvas provider supports bounded selections from:

- a world-space sphere;
- one or more connected geometry components;
- an explicit trusted vertex set; and
- the union of existing selection handles.

Selection handles are session-scoped. Vertex arrays remain private to the local
asset record and are zeroed when released.

## Editing operations

The renderer-neutral edit kernel supports:

```text
add       increase one joint and normalize
subtract  decrease one joint and normalize
replace   set an exact target share and redistribute the remainder
rigid     assign the selection entirely to one joint
smooth    blend with CSR-adjacent vertices under a visit budget
flood     rigidly assign all vertices in the selected components
prune     remove influences below a threshold and normalize
normalize re-rank, cap and normalize existing influences
```

Subtract and prune may intentionally leave a warned unweighted region. Every
other operation rejects non-finite, negative, out-of-range, duplicate or
non-normalized output before it can become accepted.

## Preview and commit

A preview has an opaque handle and private typed arrays. It does not change the
base artifact or Hodos history. Commit hashes the source identity, rig revision,
ordered joints, base artifact, canonical selection content, edit parameters and
canonical result bytes. Identical inputs therefore produce the same derived
`weights:sha256:*` identity even when different opaque selection handles contain
the same vertices.

The returned attachment is applied through the existing `rig/skin-attach`
intent. Undo and redo therefore restore exact immutable artifact identities,
not replayed brush mutations.

## Diagnostics

Each edit combines the existing structural checks with CSR adjacency evidence:

- unweighted and non-normalized vertices;
- non-finite or negative values;
- out-of-range and duplicate joint influences;
- discarded influence mass;
- adjacency edge count;
- abrupt-gradient edge count;
- mean and maximum adjacency gradient; and
- a bounded opaque selection containing representative warned vertices.

Raw vertex lists, adjacency buffers, previews and weight arrays never enter the
portable evidence document.

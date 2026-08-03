# Hara world drafts

A Hodos world is resolved from an immutable repository commit. Local making
must not mutate that release implicitly, so Hodos keeps authored changes in a
separate Hara-carried **world draft**.

The first draft component is spatial audio. The same contract can later carry
other entities and components without changing the ownership boundary:

- Hara owns logical draft state, revisions, commands, history, and effects.
- PlayCanvas projects positions and direct-manipulation controls.
- Web Audio projects audible source graphs.
- OPFS stores local draft snapshots.
- Git, Hestia, or another publication service may later accept an exported
  draft explicitly.

## Identity and isolation

A local draft belongs to one exact world identity:

```json
{
  "repository": {
    "owner": "greenways-worlds",
    "repo": "music-room",
    "url": "https://github.com/greenways-worlds/music-room"
  },
  "commit": "0123456789012345678901234567890123456789",
  "project": {
    "id": "greenways-worlds/music-room",
    "version": "1.0.0"
  }
}
```

The browser storage key includes repository, commit, and project ID. Opening a
new commit therefore cannot silently apply placements authored against an older
world geometry.

## Draft document

The portable draft snapshot is serializable data:

```json
{
  "format": "hodos-world-draft",
  "version": "0.1.0",
  "revision": 12,
  "audioSources": [
    {
      "id": "world-audio-01",
      "kind": "studio/track",
      "track": "track-guitar",
      "clip": null,
      "label": "Guitar",
      "position": [1.5, 0.2, -2.8],
      "playing": true,
      "loop": true,
      "gainDb": -3,
      "refDistance": 1,
      "maxDistance": 40,
      "rolloffFactor": 1
    }
  ]
}
```

Runtime session state additionally carries:

```json
{
  "dirty": false,
  "history": {
    "undo": [],
    "redo": []
  }
}
```

History is session-local and excluded from the portable snapshot. The saved
revision and source values are durable; the temporary undo stack is not treated
as published world content.

## Commands

Every committed edit is a semantic Hara event:

```text
world/drop
world/audio-move
world/audio-gain
world/audio-range
world/audio-loop
world/audio-toggle
world/audio-remove
world/history-undo
world/history-redo
world/draft-restore
world/draft-saved
world/draft-export
```

Examples:

```clojure
{"event/type" "world/audio-move"
 "source" "world-audio-01"
 "position" [2.0 0.5 -3.25]}
```

```clojure
{"event/type" "world/audio-range"
 "source" "world-audio-01"
 "refDistance" 2
 "maxDistance" 80
 "rolloffFactor" 0.75}
```

A change stores the previous source vector in the draft undo stack, clears redo,
increments the draft revision, marks it dirty, and emits all required host
projections.

## Effects

Scene and sound are independent projections of the same draft:

```clojure
{"effect" "scene"
 "method" "sync-audio-sources"
 "args" [sources]}
```

```clojure
{"effect" "audio"
 "method" "sync-world-sources"
 "args" [sources studio-project]}
```

A committed draft change also asks the browser host to persist the exact
revision:

```clojure
{"effect" "storage"
 "method" "save-world-draft"
 "args" [world-identity draft-snapshot]}
```

When the asynchronous write completes, the host sends:

```clojure
{"event/type" "world/draft-saved"
 "revision" 12}
```

Hara clears `dirty` only when that revision is still current. A slower older
write therefore cannot mark a newer edit as saved. The browser store also
serializes physical writes so the highest completed revision remains on disk.

## Editor interaction

The viewer mounts a collapsible world-draft panel alongside the 3D scene. For
each source a maker can:

- pause or resume it;
- arm a one-click placement operation in the world;
- enter exact X, Y, and Z coordinates;
- nudge each axis in quarter-unit steps;
- edit source gain;
- edit maximum audible distance;
- enable or disable looping;
- remove the source;
- undo or redo committed world changes;
- export the portable draft.

`Place` temporarily captures the next primary click on the world canvas and
uses the renderer's current world-position resolver. Escape cancels the
operation. The preview and controls never become authoritative; the resulting
position is committed through `world/audio-move`.

## Spatial host updates

Position, gain, audible range, rolloff, and looping update an existing HRTF
panner graph directly. The browser only re-renders the selected Studio track or
clip when its underlying musical graph changes.

This prevents a small world transform edit from repeating an expensive offline
audio render while preserving Hara as the authority for the changed value.

## Persistence and export

Local records are stored under the shared Hodos Studio OPFS root:

```text
OPFS/
  hodos-studio/
    world-drafts/
      <repository@commit#project>.json
```

When OPFS is unavailable, the shared page-memory backend preserves drafts only
for the current page lifetime.

`Export` downloads a JSON envelope:

```json
{
  "format": "hodos-world-draft-export",
  "version": "0.1.0",
  "exportedAt": "2026-08-04T00:00:00.000Z",
  "identity": { "...": "..." },
  "draft": { "...": "..." }
}
```

The envelope is suitable for a later explicit import, repository patch, or
signed Hestia proposal. Export does not claim that the source repository has
changed.

## Current limits

- Draft import and publication are not implemented yet.
- Draft components are currently limited to spatial audio sources.
- Placement uses the scene floor or a camera-facing fallback plane rather than
  semantic Gaussian-splat collision.
- Collaboration, contributor attribution, and signed acceptance are future
  publication-layer concerns.

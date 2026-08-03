# Studio audio in the 3D world

Hodos lets a trusted 2D surface offer values that can be dropped into the 3D
world. Studio is the first consumer: a complete track or one clip can become a
spatial audio source carried by an editable Hara world draft.

## Generic world drag protocol

The viewer owns a small typed drag envelope:

```text
application/x-hodos-world-payload
```

A Studio track payload is serializable data only:

```json
{
  "type": "studio/track",
  "id": "world-audio-...",
  "track": "track-guitar",
  "label": "Guitar",
  "loop": true
}
```

A clip payload additionally carries its stable clip identity:

```json
{
  "type": "studio/clip",
  "id": "world-audio-...",
  "track": "track-guitar",
  "clip": "clip-intro",
  "label": "Guitar clip",
  "loop": true
}
```

Payloads are bounded, JSON-validated, and never contain `File`, `AudioBuffer`,
DOM, PlayCanvas, or filesystem objects. The generic viewer does not interpret
the Studio schema; it resolves a world position and forwards a semantic
`world/drop` event to Hara.

## Placement

While a drag is active the classical surface narrows to a side panel and lets
the underlying world canvas receive the drop. The current renderer intersects
the pointer ray with the resolved scene floor, falling back to a camera-facing
plane when a floor intersection is unavailable. This is deterministic and
useful for Gaussian-splat scenes that do not expose semantic mesh collision.
A later geometry adapter can replace the position resolver without changing the
Hara event.

```clojure
{"event/type" "world/drop"
 "payload" {...}
 "position" [1.5 0.2 -2.8]}
```

Hara validates that the referenced track or clip exists and then creates a
world-draft source record:

```clojure
{"id" "world-audio-..."
 "kind" "studio/track"
 "track" "track-guitar"
 "clip" nil
 "label" "Guitar"
 "position" [1.5 0.2 -2.8]
 "playing" true
 "loop" true
 "gainDb" 0
 "refDistance" 1
 "maxDistance" 30
 "rolloffFactor" 1}
```

The Hara draft, not PlayCanvas or Web Audio, is authoritative for source
identity, position, play state, acoustic parameters, and removal.

## Editing the world source

The viewer mounts a spatial draft inspector over the running world. A maker can:

- enter exact X, Y, and Z coordinates;
- nudge each axis in quarter-unit steps;
- arm a placement command and click a new point in the 3D world;
- change source gain;
- change maximum audible distance;
- enable or disable looping;
- pause, resume, or remove a source;
- undo and redo world changes.

Each committed operation returns to Hara as data. Examples:

```clojure
{"event/type" "world/audio-move"
 "source" "world-audio-..."
 "position" [2 0.5 -3]}
```

```clojure
{"event/type" "world/audio-range"
 "source" "world-audio-..."
 "refDistance" 2
 "maxDistance" 80
 "rolloffFactor" 0.75}
```

The editor is a projection of the draft; its input controls and temporary
placement gesture never become the world authority.

## Host effects

A placement or edit emits independent scene and sound projections:

```clojure
{"effect" "scene"
 "method" "sync-audio-sources"
 "args" [sources]}

{"effect" "audio"
 "method" "sync-world-sources"
 "args" [sources project]}
```

The scene host renders accessible markers anchored to the source positions. A
marker can pause/resume or remove its Hara source. The audio host resolves the
same source against the current Hara Studio project.

For a track source, clip start times are made relative to the first clip and
the complete selected track is rendered. For a clip source, only that source
range is rendered and it starts at zero. Both paths use the same clip graph as
normal playback and WAV export.

## Web Audio

The spatial host:

1. reads immutable audio bytes from OPFS;
2. decodes the required assets into host-only buffers;
3. renders the selected track or clip with `OfflineAudioContext`;
4. connects the result through source gain and an HRTF `PannerNode`;
5. updates the `AudioListener` whenever the Hodos camera moves;
6. loops or stops the source according to Hara state.

Position, gain, range, rolloff, and loop edits update the existing panner graph
in place when the selected musical graph has not changed. A Studio project edit
causes Hara to emit a fresh spatial sync effect, allowing movement, trimming,
splitting, muting, or track gain changes to rebuild the affected world sound
from the new canonical project only when necessary.

## Draft persistence

World placements are saved as a versioned Hara draft tied to repository,
immutable commit, and project ID. The browser persists that draft in OPFS and
restores it when the same world commit is opened later. A draft authored against
one commit is not automatically applied to another.

The save effect carries a specific revision. Hara only marks the draft clean
when the host acknowledges that same current revision, preventing stale
asynchronous writes from hiding a newer unsaved change.

The maker can also export a portable `.hodos-world.json` envelope. Import,
repository publication, and signed Hestia-room proposals are future explicit
workflows rather than implicit mutations of the source world.

See [`world-drafts.md`](world-drafts.md) for the complete state, history,
persistence, and export contract.

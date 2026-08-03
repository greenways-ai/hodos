# Studio audio in the 3D world

Hodos lets a trusted 2D surface offer values that can be dropped into the 3D
world. Studio is the first consumer: a complete track or one clip can become a
spatial audio source.

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
world-owned source record:

```clojure
{"id" "world-audio-..."
 "kind" "studio/track"
 "track" "track-guitar"
 "clip" nil
 "label" "Guitar"
 "position" [1.5 0.2 -2.8]
 "playing" true
 "loop" true
 "gainDb" 0}
```

The world session, not PlayCanvas or Web Audio, is authoritative for source
identity, position, play state, and removal.

## Host effects

A placement, toggle, or removal emits two projections:

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

A Studio project edit causes Hara to emit a fresh spatial sync effect when
world sources exist. Moving, trimming, splitting, muting, or changing gain can
therefore rebuild the affected world sound from the new canonical project.

## Current lifecycle

Spatial source records currently live for the Hodos page session. Studio media
and project state remain durable in OPFS, but world placement itself is not yet
published back into the repository world or a signed Hestia room. That later
persistence layer can store the same source records without changing their host
projection contract.

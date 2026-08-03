# Hodos Studio project model

Hodos Studio treats audio media, tracks, and clips as separate concepts. The
Hara session carries this graph; browser audio and rendering code project it
into `AudioNode` graphs and timeline controls.

## Assets

An asset describes one immutable audio payload:

```clojure
{"id" "sha256:..."
 "name" "guitar.wav"
 "mediaType" "audio/wav"
 "duration" 12.46
 "channels" 2
 "sampleRate" 48000
 "storage" {"type" "opfs"
            "key" "assets/sha256%3A....bin"}}
```

The same content identity may be referenced by many clips. Importing the same
bytes again does not duplicate the project asset record.

## Tracks

A track owns mixing controls and an ordered set of clip records:

```clojure
{"id" "track-guitar"
 "name" "Guitar"
 "gainDb" -3
 "pan" 0.15
 "mute" false
 "clips" [...]}
```

Gain and mute edits are Hara events. When the transport is playing, a committed
project edit emits a fresh `audio/apply-transport` effect so the Web Audio host
reschedules from the new canonical graph.

## Clips

A clip places a range of an asset on the project timeline:

```clojure
{"id" "clip-intro"
 "asset" "sha256:..."
 "startSeconds" 4.25
 "sourceStartSeconds" 0.5
 "duration" 7.75}
```

The current slice uses seconds and quarter-second snapping. The fields already
separate project placement from source offset, allowing later trim, split, loop,
and fade commands without modifying the underlying asset.

A clip drag is only a browser preview until pointer release. The committed edit
is sent to Hara:

```clojure
{"event/type" "studio/clip-move"
 "clip" "clip-intro"
 "startSeconds" 8.0}
```

Keyboard Left and Right invoke the same command in quarter-second increments.
The DOM never becomes the project authority.

## Playback and export

Both real-time playback and offline WAV export iterate the same track/clip
graph. For every unmuted clip, the host schedules:

```text
project start = clip.startSeconds
source offset = clip.sourceStartSeconds
duration       = clip.duration
gain           = track.gainDb
pan            = track.pan
```

`AudioContext.currentTime` remains the real-time clock. Hara carries transport
intent and authored placement, not sample-level timing or `AudioBuffer` values.

## Legacy project migration

The first prototype stored a single `asset` and `startSeconds` directly on each
track. `normalizeProject` converts those records into first-class clips before
restoration, persistence, playback, or portable export. The restored normalized
project is then sent back through `studio/restore`, keeping Hara authoritative.

## Next commands

The next editing layer can build on the existing clip identity and range model:

- `studio/clip-trim-start`
- `studio/clip-trim-end`
- `studio/clip-split`
- `studio/clip-duplicate`
- `studio/clip-delete`
- `studio/clip-move-track`
- `studio/track-pan`
- `studio/history-undo`
- `studio/history-redo`

A later musical timebase can add tempo maps and integer ticks while preserving
seconds as a derived host scheduling value.

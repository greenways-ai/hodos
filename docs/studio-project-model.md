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

The current slice uses seconds and quarter-second snapping. Project placement,
source offset, and duration are separate, so editing never rewrites the
underlying immutable audio asset.

A clip drag is only a browser preview until pointer release. The committed edit
is sent to Hara:

```clojure
{"event/type" "studio/clip-move"
 "clip" "clip-intro"
 "startSeconds" 8.0}
```

Keyboard Left and Right invoke the same command in quarter-second increments.
The DOM never becomes the project authority.

## Structural clip editing

The browser host calculates bounded, snapped transformations and sends complete
serializable clip records into Hara. Hara owns the structural mutation and
records it in command history.

### Trim

Dragging the left edge changes all three relevant values together:

```text
startSeconds       += delta
sourceStartSeconds += delta
duration           -= delta
```

Dragging the right edge changes duration only. Both edges retain a minimum
quarter-second range and cannot pass the beginning or end of the source asset.
The committed record is applied with:

```clojure
{"event/type" "studio/clip-replace"
 "clip" updated-clip}
```

### Split

A split preserves the original clip ID on the left and creates a new ID on the
right. The two ranges remain adjacent in project and source time:

```clojure
{"event/type" "studio/clip-split"
 "target" "clip-intro"
 "left" left-clip
 "right" right-clip}
```

Hara rejects a right-hand ID that already exists or a left-hand record that
does not preserve the target identity.

### Duplicate and delete

Duplicate inserts a new clip immediately after the target in the same track:

```clojure
{"event/type" "studio/clip-insert-after"
 "target" "clip-intro"
 "clip" duplicated-clip}
```

Delete removes only the clip instance, not its shared audio asset:

```clojure
{"event/type" "studio/clip-delete"
 "clip" "clip-intro"}
```

The surface exposes trim handles plus split, duplicate and delete controls.
Delete/Backspace and Command/Ctrl-D invoke the same semantic events as the
buttons.

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

## Command history

Every committed project change records the previous project in the Hara
session's undo stack and clears redo. Undo and redo exchange canonical project
snapshots between the two stacks and increment the session revision. If the
transport is playing, the resulting project is rescheduled through the same
`audio/apply-transport` effect as a direct edit.

```clojure
{"history"
 {"undo" [previous-project ...]
  "redo" [later-project ...]}}
```

The studio exposes toolbar controls plus Command/Ctrl-Z, Shift-Command/Ctrl-Z,
and Ctrl-Y. Text fields keep native browser undo; the shortcuts dispatch to
Hara only when focus is on the studio surface itself. Imports, movement, trim,
split, duplicate, delete, mixer changes, and future agent proposals therefore
share one reversible command stream.

## Legacy project migration

The first prototype stored a single `asset` and `startSeconds` directly on each
track. `normalizeProject` converts those records into first-class clips before
restoration, persistence, playback, or portable export. The restored normalized
project is then sent back through `studio/restore`, keeping Hara authoritative.

## Next commands

The next editing layer can build on the existing clip identity and range model:

- `studio/clip-move-track`
- `studio/clip-fade-in`
- `studio/clip-fade-out`
- `studio/track-pan`
- automation lanes and selection-aware commands

A later musical timebase can add tempo maps and integer ticks while preserving
seconds as a derived host scheduling value.

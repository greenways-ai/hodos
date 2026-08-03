# Studio storage and export

Hodos Studio separates logical project state from binary media and real-time
host objects.

## Ownership boundary

| Data | Owner |
| --- | --- |
| Project, assets, tracks, transport intent and revision | Hara session |
| Imported audio bytes and saved project snapshot | Origin Private File System |
| Decoded `AudioBuffer` values and live `AudioNode` graph | Web Audio host |
| Waveform pixels and controls | HTML and Canvas host |

Hara never receives `File`, `ArrayBuffer`, `AudioBuffer`, filesystem handles or
DOM objects. An asset in Hara contains serializable metadata and an opaque local
storage descriptor:

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

## Local project restoration

The studio uses the browser Origin Private File System when
`navigator.storage.getDirectory()` is available. Imported audio is written once
under a content-derived asset identity. The current Hara project is saved as a
JSON snapshot after committed studio revisions.

When the studio surface is opened again:

1. the host opens the local project snapshot;
2. audio bytes are read from OPFS and decoded into host-only buffers;
3. the host sends `studio/restore` with the serializable project to Hara;
4. Hara replaces the studio project in the active session and increments its
   revision;
5. the surface renders from the returned Hara state.

If OPFS is unavailable, the demo falls back to page memory. The interface marks
that fallback explicitly and project export remains available during the page
session.

## Mix export

`Export mix` constructs an `OfflineAudioContext` from the current Hara project,
renders all available unmuted tracks, encodes interleaved 16-bit PCM WAV, and
saves the resulting file through the browser.

The current vertical slice starts every track at `startSeconds`. Clip ranges,
fades, automation and a musical tick timebase will extend the same offline
render contract later.

## Portable project bundle

`Export project` produces a standards-compatible ZIP with stored entries:

```text
song.hodos-studio.zip
  manifest.json
  README.txt
  studio/
    project.json
  audio/
    <content-id>-<original-name>
```

`manifest.json` identifies format `hodos-studio-bundle` version `0.1.0`, points
to the project document, and maps every logical asset identity to its immutable
payload. Inside `studio/project.json`, local OPFS descriptors are replaced with
bundle-relative paths. The exported project is therefore portable and does not
leak browser filesystem handles.

## Security and lifecycle

- World repositories can request the trusted `hodos/studio` surface but cannot
  read OPFS directly.
- Only files explicitly selected or dropped by the user are imported.
- Local audio is not uploaded by this slice.
- Browser storage may still be cleared by the user or browser policy, so the
  project bundle is the explicit backup and portability mechanism.

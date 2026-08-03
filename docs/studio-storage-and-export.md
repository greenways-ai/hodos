# Studio storage, export, and import

Hodos Studio separates logical project state from binary media and real-time
host objects.

## Ownership boundary

| Data | Owner |
| --- | --- |
| Project, assets, tracks, clips, transport intent, history and revision | Hara session |
| Imported audio bytes, active-project pointer and saved project snapshot | Origin Private File System |
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
JSON snapshot after committed studio revisions, and an active-project pointer
identifies the most recently opened project.

When the studio surface is opened again:

1. the host opens the local project snapshot;
2. audio bytes are read from OPFS and decoded into host-only buffers;
3. the host sends `studio/restore` with the serializable project to Hara;
4. Hara replaces the studio project, resets project command history, and
   increments the active session revision;
5. the surface renders from the returned Hara state.

If OPFS is unavailable, the demo falls back to a shared page-memory store. The
interface marks that fallback explicitly and import/export remain available
during the page session.

## Mix export

`Export mix` constructs an `OfflineAudioContext` from the current Hara project,
schedules each unmuted clip at its project start and source offset, renders the
result, encodes interleaved 16-bit PCM WAV, and saves it through the browser.

Clip fades, automation and a musical tick/tempo timebase will extend the same
offline render contract later.

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
bundle-relative paths. The exported project is portable and does not leak
browser filesystem handles.

## Portable project import

`Open project` is the inverse operation. Before a bundle can replace the active
Hara project, the browser host checks:

- the ZIP end record, entry count, central-directory bounds and local-entry
  alignment;
- that every entry uses the non-streaming stored method and is not encrypted;
- UTF-8 names, duplicate names and path traversal segments;
- each payload CRC and declared byte size;
- bundle format/version and project-document location;
- one-to-one correspondence between project assets, manifest assets and audio
  payloads;
- SHA-256 content identity whenever an asset uses a `sha256:` ID and browser
  cryptography is available.

After verification, audio payloads are copied into the shared OPFS asset store,
the imported project is retargeted to the active local workspace identity,
audio is decoded for immediate waveform rendering, the project snapshot is
saved, and `studio/restore` installs it as canonical Hara state. The previous
local project is saved before replacement.

The reader deliberately accepts only the bundle subset Hodos emits. It does not
attempt to be a general-purpose ZIP extractor.

## Security and lifecycle

- World repositories can request the trusted `hodos/studio` surface but cannot
  read OPFS or parse user files directly.
- Only files explicitly selected or dropped by the user are imported.
- Bundle paths are never mapped onto the host filesystem; they are logical ZIP
  paths copied into application-owned storage.
- Local audio is not uploaded by this slice.
- Browser storage may still be cleared by the user or browser policy, so the
  project bundle remains the explicit backup and portability mechanism.

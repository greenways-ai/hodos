# World draft review and publication

Hodos world drafts move through an explicit proposal and publication workflow.
Imported files never replace live Hara state directly, and publication never
places browser keys, patch bodies, or filesystem objects inside the kernel.

## Import boundary

The accepted file format is the portable export produced by Hodos:

```json
{
  "format": "hodos-world-draft-export",
  "version": "0.1.0",
  "exportedAt": "2026-08-04T00:00:00.000Z",
  "identity": {
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
  },
  "draft": {
    "format": "hodos-world-draft",
    "version": "0.1.0",
    "revision": 12,
    "audioSources": []
  }
}
```

The browser rejects an import before it reaches Hara when:

- it exceeds 2 MiB;
- it is not valid JSON;
- its format or version is unsupported;
- it targets a different repository, immutable commit, or project;
- it contains duplicate source IDs;
- its draft or source positions are invalid;
- it contains no semantic changes.

Commit equality is intentional. A source positioned against one Gaussian-splat
revision must not be silently rebased onto different geometry. A future rebase
tool can be a separate, visible operation.

## Semantic proposal

The browser compares imported and current sources by stable source ID. It emits
one change per source:

```clojure
{"id" "source:room-guitar"
 "op" "replace"
 "source" "room-guitar"
 "before" {...}
 "after" {...}
 "fields"
 [{"field" "position"
   "before" [1 0.2 -2]
   "after" [3 1 -4]}
  {"field" "gainDb"
   "before" 0
   "after" -6}]}
```

The complete proposal contains:

- the immutable world identity;
- the current Hara draft revision used as its base;
- source-level add, remove, and replace operations;
- field-level before and after values;
- the initially selected change IDs;
- summary counts.

Hara stores the proposal and selection. The DOM only renders that state.
Selecting or deselecting a row sends `world/draft-review-toggle`.

## Acceptance and staleness

`world/draft-review-accept` applies every selected change as one world-draft
transaction. The previous source vector enters Hara undo history, the draft
revision increments once, and normal scene, Web Audio, and storage effects run.

If the live world draft changes after proposal creation, Hara marks the proposal
stale. Acceptance then fails until the proposal is rejected and imported again.
This prevents an apparently successful review from overwriting intervening
work.

## Repository patch

`world/publish-repository` emits a publication effect containing only the world
identity and serialisable draft snapshot. The browser produces a unified diff
that can be applied with standard Git tooling:

```text
git apply greenways-worlds-music-room-r12-4b2d1a93c21e.patch
```

The patch adds an immutable contribution document under:

```text
world/drafts/<project>-r<revision>-<digest>.hodos-world.json
```

The added document identifies format `hodos-repository-world-patch` version
`0.1.0`, the exact base repository commit, the draft export, creation time, and
a SHA-256-derived filename. It does not attempt to rewrite `project.edn`
automatically. A maintainer can review, apply, integrate, or reject it using
normal repository practice.

The browser currently downloads the patch. It does not request GitHub write
credentials or open a pull request itself.

## Signed Hestia-room contribution

`world/publish-hestia` requires a room identifier and emits the same accepted
draft through the Hestia publication adapter. The browser creates:

```json
{
  "format": "hestia-room-contribution",
  "version": "0.1.0",
  "room": "hestia:room:mix-review",
  "kind": "hodos/world-draft",
  "createdAt": "2026-08-04T00:00:00.000Z",
  "subject": {...},
  "payload": {...},
  "proof": {
    "type": "HestiaDataIntegrityProof",
    "cryptosuite": "ecdsa-p256-sha256",
    "verificationMethod": "hestia:key:...",
    "publicKeyJwk": {...},
    "payloadDigest": "sha256:...",
    "signature": "..."
  }
}
```

Unsigned fields are canonicalised by recursively sorting object keys. The
canonical UTF-8 document is hashed with SHA-256 and signed with ECDSA P-256.
The contribution includes enough public information for independent
verification.

The browser stores its signing `CryptoKey` pair in IndexedDB when available.
The private key is never sent to Hara or included in the contribution. A shared
page-memory key store is used when IndexedDB is unavailable.

Network submission is intentionally outside this slice. The signed file is a
complete contribution artifact ready for a future Hestia room transport API.

## Publication receipts

After a successful download, the host returns only compact metadata to Hara:

```clojure
{"target" "hestia"
 "room" "hestia:room:mix-review"
 "digest" "sha256:..."
 "verificationMethod" "hestia:key:..."
 "filename" "...hestia-contribution.json"}
```

Repository receipts contain the target path, filename, digest, format, and
creation time. Failures and cancelled saves are also recorded as receipts.
Patch text, signed envelope contents, private keys, `Blob` values, and browser
handles remain host-only.

## Current scope

Review operates on spatial-audio sources. The proposal format deliberately uses
stable IDs and generic operations so transforms, components, documents, and
other application payloads can later use the same review state machine.

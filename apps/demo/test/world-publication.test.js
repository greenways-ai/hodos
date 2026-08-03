import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import {
  createHestiaContribution,
  createRepositoryPatch,
  MemoryHestiaKeyStore,
  verifyHestiaContribution,
} from "../src/world-publication.js";

const identity = {
  repository: {
    owner: "greenways-worlds",
    repo: "room",
    url: "https://github.com/greenways-worlds/room",
  },
  commit: "a".repeat(40),
  project: { id: "greenways-worlds/room", version: "1.0.0" },
};

const draft = {
  format: "hodos-world-draft",
  version: "0.1.0",
  revision: 7,
  audioSources: [{
    id: "world-source",
    kind: "studio/track",
    track: "track-a",
    clip: null,
    label: "Guitar",
    position: [1, 0.2, -2],
    playing: true,
    loop: true,
    gainDb: -3,
    refDistance: 1,
    maxDistance: 40,
    rolloffFactor: 1,
  }],
};

test("repository publication creates a git-apply compatible addition patch", async () => {
  const artifact = await createRepositoryPatch(identity, draft, {
    createdAt: "2026-08-04T00:00:00.000Z",
    crypto: webcrypto,
  });
  assert.equal(artifact.target, "repository");
  assert.match(artifact.path, /^world\/drafts\/greenways-worlds-room-r7-[0-9a-f]{12}\.hodos-world\.json$/);
  assert.match(artifact.filename, /\.patch$/);
  assert.match(artifact.patch, /^diff --git a\/world\/drafts\//);
  assert.match(artifact.patch, /new file mode 100644/);
  assert.match(artifact.patch, /\+  "format": "hodos-repository-world-patch"/);
  assert.match(artifact.digest, /^sha256:[0-9a-f]{64}$/);
});

test("Hestia contribution is signed and independently verifiable", async () => {
  const keyStore = new MemoryHestiaKeyStore({ crypto: webcrypto });
  const contribution = await createHestiaContribution(
    identity,
    draft,
    "hestia:room:mix-review",
    {
      createdAt: "2026-08-04T00:00:00.000Z",
      keyStore,
      crypto: webcrypto,
    },
  );
  assert.equal(contribution.room, "hestia:room:mix-review");
  assert.equal(contribution.kind, "hodos/world-draft");
  assert.match(contribution.proof.payloadDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(contribution.proof.verificationMethod, /^hestia:key:[0-9a-f]{64}$/);
  assert.equal(await verifyHestiaContribution(contribution, { crypto: webcrypto }), true);

  const tampered = structuredClone(contribution);
  tampered.payload.draft.audioSources[0].gainDb = 12;
  assert.equal(await verifyHestiaContribution(tampered, { crypto: webcrypto }), false);
});

test("Hestia room identifiers are required", async () => {
  await assert.rejects(
    createHestiaContribution(identity, draft, "", {
      keyStore: new MemoryHestiaKeyStore({ crypto: webcrypto }),
      crypto: webcrypto,
    }),
    /room identifier/,
  );
});

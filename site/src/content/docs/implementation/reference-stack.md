---
title: Reference stack
description: How the current Hodos packages map onto the emerging specification layers.
---

The current repository is more capable than the future normative core. This is
useful: it provides concrete behavior against which the smaller specification
can be tested.

| Current package or area | Emerging role |
|---|---|
| `packages/core` | Reference SDK host and contribution lifecycle |
| `packages/kernel` | Canonical Hara runtime endpoint |
| `packages/world-model` | Candidate portable world and authoring models |
| `packages/source-github` | GitHub source adapter |
| `packages/renderer-playcanvas` | PlayCanvas projection adapter |
| `packages/viewer` | Reference browser world shell |
| `packages/viewer-defaults` | First-party adapter composition |
| `packages/addon-*` | Optional authoring, draft, and publication applications |
| `packages/ui-*` | Optional reference interfaces |
| `apps/demo` | Conformance laboratory and complete reference experience |

## Normative versus reference

A behavior becomes normative only when it is described by a versioned document
under `spec/` and covered by public conformance fixtures. First-party code can
prototype a behavior before standardization, and third-party implementations
can satisfy a stable contract without importing the first-party packages.

## Current hard boundary

The most important existing invariant already matches the new direction:

- Hara owns serializable meaning and state.
- The browser host owns DOM nodes, renderer entities, media objects, device and
  file handles, cryptographic keys, and runtime execution objects.
- Hara requests host work through values and receives values in return.

The Host ABI draft turns that implementation discipline into an explicit public
contract.

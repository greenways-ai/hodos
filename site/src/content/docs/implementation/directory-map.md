---
title: Directory map
description: The first repository boundary between specification, reference packages, applications, and implementation notes.
---

The migration starts by introducing stable top-level responsibilities while
leaving the working package graph in place.

```text
hodos/
├── spec/           normative Hodos drafts
├── packages/       reference SDK, runtime, models, adapters, and UI
├── apps/
│   └── demo/       complete working reference world
├── site/           Astro + Starlight public site
├── docs/           non-normative implementation documents
└── src/            Hara distribution and deployment entry points
```

## Why packages have not moved yet

Moving renderer, source, viewer, authoring, and publication packages at the same
time as changing the public site would make failures difficult to isolate. The
initial arrangement therefore changes ownership and documentation first.

The next extraction can proceed package by package:

1. establish source-neutral protocol and world packages;
2. make `source-github` consume the world contract rather than own it;
3. make the Hara runtime bridge implement the Host ABI;
4. classify PlayCanvas, OPFS, Web Audio, Hestia, and wallet support as adapters;
5. keep viewer, editor, Studio, and demo applications above those adapters.

## Public output

The Astro site is deployed at `/hodos/`. The existing demo build is copied,
without rebundling, to `/hodos/demo/`. Its relative assets therefore continue
to resolve inside the demo directory.

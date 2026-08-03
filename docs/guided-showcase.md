# Guided Greenways Worlds showcase

The guided showcase turns the composed `greenways-worlds/splat-garden` world
into a walkthrough of the complete Hodos application model rather than a
renderer-only sample.

## Spatial touchpoints

The world declares four trusted application touchpoints:

| Touchpoint | Surface | Purpose |
| --- | --- | --- |
| Guided tour | `hodos/showcase-guide` | Explain the workflow and derive progress from live Hara state. |
| Music Studio | `hodos/studio` | Import, arrange, persist and export browser-native audio. |
| Hara inspector | `hodos/world-inspector` | Inspect immutable world identity, capabilities, touchpoints, drafts, Studio state and publication receipts. |
| Command deck | `hodos/command-deck` | Search and invoke discoverable semantic commands in an `M-x`-style interface. |

The repository contains only touchpoint data. The Hodos host owns the installed
HTML surface factories, and unknown surface IDs continue to fail closed.

## Guided journey

The guide derives five milestones directly from the current Hara session:

1. Resolve the composed world at an immutable commit.
2. Import audio and create at least one Studio clip.
3. Drag a track or clip back into the 3D scene.
4. Change the resulting Hara world draft after placement.
5. create a repository patch or signed Hestia contribution.

Progress is not stored as a separate browser checklist. It is a view of the
canonical Studio, world-draft and publication state.

## Live inspector

The inspector exposes three views:

- **Overview** — repository, commit, project, declared capabilities and live
  counts.
- **Touchpoints** — every spatial application entry with a semantic Open
  action.
- **Hara state** — a serializable snapshot of session, world, draft, review,
  publication and Studio values.

Host-only values such as DOM nodes, PlayCanvas entities, `AudioBuffer`,
`CryptoKey` and filesystem handles never appear in the inspector because they
never enter Hara state.

## Command deck

The command deck demonstrates the editor substrate behind an “Emacs but 3D”
workflow. Its command catalog describes title, group, availability, shortcut
and semantic action. The initial commands cover:

- opening guide, Studio and inspector surfaces;
- Studio play, stop, undo and redo;
- world-draft undo and redo;
- portable draft export;
- repository patch creation;
- returning to the 3D world.

Search and keyboard navigation are host UI concerns. Invocation always produces
the same Hara event used by buttons elsewhere in the application.

## Repository and host responsibilities

`greenways-worlds/splat-garden` owns the composed world and touchpoint
positions. `apps/demo` owns the guided presentation, surface factories and
featured-world landing experience. The reusable viewer remains neutral: it
only resolves touchpoints and mounts explicitly registered surfaces.

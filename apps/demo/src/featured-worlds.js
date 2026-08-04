export const FEATURED_WORLDS = Object.freeze([
  Object.freeze({
    id: "editor",
    title: "Greenways World Editor",
    description: "Open a composed Gaussian-splat world as a live authoring workspace with an outliner, properties, primitives, lights, transform tools and publishable Hara drafts.",
    repository: "https://github.com/greenways-worlds/splat-garden",
    experience: "editor",
    format: "LIVE WORLD EDITOR",
    action: "Open the editor",
    primary: true,
    features: Object.freeze(["Scene outliner", "Transform tools", "Hara undo/redo", "Publishable drafts"]),
    attribution: "https://github.com/greenways-worlds/splat-garden",
  }),
  Object.freeze({
    id: "studio",
    title: "Music Studio",
    description: "A Hodos touchpoint opens a classical multitrack surface while Hara carries the Studio session, world draft and publication state.",
    repository: "https://github.com/greenways-worlds/apartment",
    experience: "studio",
    format: "HODOS SURFACE",
    action: "Open Studio world",
    features: Object.freeze(["Multitrack", "OPFS", "World drag", "WAV export"]),
    attribution: "https://github.com/greenways-worlds/apartment/blob/main/ATTRIBUTION.md",
  }),
  Object.freeze({
    id: "playbot",
    title: "Playbot",
    description: "A streamed multi-resolution SOG world with a repository-authored Studio touchpoint and the same general scene editor.",
    repository: "https://github.com/greenways-worlds/playbot",
    format: "STREAMED SOG",
    action: "Edit around Playbot",
    features: Object.freeze(["Streamed SOG", "Read-only base", "Editable overlay"]),
    attribution: "https://github.com/greenways-worlds/playbot/blob/main/ATTRIBUTION.md",
  }),
  Object.freeze({
    id: "apartment",
    title: "Apartment",
    description: "A compact SOG base world for rapidly creating primitives, lights, spatial audio and local scene drafts.",
    repository: "https://github.com/greenways-worlds/apartment",
    format: "SOG",
    action: "Open apartment editor",
    features: Object.freeze(["Compact asset", "Fast loading", "Scene composition"]),
    attribution: "https://github.com/greenways-worlds/apartment/blob/main/ATTRIBUTION.md",
  }),
]);

export function featuredWorld(id) {
  return FEATURED_WORLDS.find((world) => world.id === id) ?? null;
}

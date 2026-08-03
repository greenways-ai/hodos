export const FEATURED_WORLDS = Object.freeze([
  Object.freeze({
    id: "showcase",
    title: "Guided Hodos Showcase",
    description: "A composed Greenways world with four spatial applications: guided tour, live Hara inspector, command deck and the complete music Studio workflow.",
    repository: "https://github.com/greenways-worlds/splat-garden",
    experience: "showcase",
    format: "GUIDED WORLD",
    action: "Start the tour",
    primary: true,
    features: Object.freeze(["4 touchpoints", "Live Hara state", "Spatial audio", "Signed publication"]),
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
    description: "A streamed multi-resolution SOG world with a repository-authored Studio touchpoint.",
    repository: "https://github.com/greenways-worlds/playbot",
    format: "STREAMED SOG",
    action: "Meet Playbot",
    features: Object.freeze(["Streamed SOG", "World touchpoint", "Immutable source"]),
    attribution: "https://github.com/greenways-worlds/playbot/blob/main/ATTRIBUTION.md",
  }),
  Object.freeze({
    id: "apartment",
    title: "Apartment",
    description: "A compact single-layer SOG world for testing the viewer, Studio and local world-draft workflow.",
    repository: "https://github.com/greenways-worlds/apartment",
    format: "SOG",
    action: "Open apartment",
    features: Object.freeze(["Compact asset", "Fast loading", "Studio host"]),
    attribution: "https://github.com/greenways-worlds/apartment/blob/main/ATTRIBUTION.md",
  }),
]);

export function featuredWorld(id) {
  return FEATURED_WORLDS.find((world) => world.id === id) ?? null;
}

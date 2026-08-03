export const STUDIO_TOUCHPOINTS = Object.freeze([
  Object.freeze({
    id: "studio-console",
    label: "Open music studio",
    surface: "hodos/studio",
    presentation: "focus-overlay",
    anchor: "scene-center",
    position: [0, 0, 0],
    radius: 0.8,
    config: Object.freeze({ project: "local/current" }),
  }),
]);

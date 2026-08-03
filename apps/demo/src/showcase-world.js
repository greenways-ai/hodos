export const SHOWCASE_EXPERIENCE = "showcase";

export const SHOWCASE_SURFACE_IDS = Object.freeze({
  guide: "hodos/showcase-guide",
  studio: "hodos/studio",
  inspector: "hodos/world-inspector",
  commands: "hodos/command-deck",
});

const FALLBACK_TOUCHPOINTS = Object.freeze({
  [SHOWCASE_SURFACE_IDS.guide]: Object.freeze({
    id: "showcase-guide",
    label: "Guided Hodos tour",
    surface: SHOWCASE_SURFACE_IDS.guide,
    presentation: "focus-overlay",
    config: Object.freeze({ tour: "greenways-worlds/showcase" }),
  }),
  [SHOWCASE_SURFACE_IDS.studio]: Object.freeze({
    id: "showcase-studio",
    label: "Open music Studio",
    surface: SHOWCASE_SURFACE_IDS.studio,
    presentation: "focus-overlay",
    config: Object.freeze({ project: "local/current" }),
  }),
  [SHOWCASE_SURFACE_IDS.inspector]: Object.freeze({
    id: "showcase-inspector",
    label: "Inspect live Hara state",
    surface: SHOWCASE_SURFACE_IDS.inspector,
    presentation: "overlay",
    config: Object.freeze({}),
  }),
  [SHOWCASE_SURFACE_IDS.commands]: Object.freeze({
    id: "showcase-command-deck",
    label: "Open command deck",
    surface: SHOWCASE_SURFACE_IDS.commands,
    presentation: "panel",
    config: Object.freeze({}),
  }),
});

const sourceList = (state) => state?.world?.draft?.audioSources
  ?? state?.world?.audioSources
  ?? [];

export function touchpointForSurface(state, surface) {
  const touchpoints = state?.world?.touchpoints ?? [];
  return touchpoints.find((entry) => entry.surface === surface)
    ?? FALLBACK_TOUCHPOINTS[surface]
    ?? null;
}

export function activateShowcaseSurface(dispatch, state, surface) {
  if (typeof dispatch !== "function") throw new Error("Showcase surface activation requires dispatch");
  const touchpoint = touchpointForSurface(state, surface);
  if (!touchpoint) throw new Error(`No showcase touchpoint is available for ${surface}`);
  return dispatch({ "event/type": "touchpoint/activate", touchpoint });
}

export function showcaseProgress(state) {
  const project = state?.studio?.project ?? { assets: [], tracks: [] };
  const sources = sourceList(state);
  const draft = state?.world?.draft ?? {};
  const history = draft.history ?? { undo: [] };
  const publications = state?.world?.publications ?? [];
  const audioClips = (project.tracks ?? []).reduce(
    (total, track) => total + (track.clips?.length ?? 0),
    0,
  );
  const editedAfterPlacement = (history.undo?.length ?? 0) > sources.length;
  const published = publications.some((receipt) => receipt?.status !== "failed");

  return [
    {
      id: "enter",
      title: "Enter the composed world",
      description: "Resolve Apartment and Playbot from immutable repositories.",
      complete: Boolean(state?.world?.commit),
      surface: SHOWCASE_SURFACE_IDS.inspector,
    },
    {
      id: "create",
      title: "Create in Studio",
      description: "Import audio and arrange at least one Hara-backed clip.",
      complete: (project.assets?.length ?? 0) > 0 && audioClips > 0,
      surface: SHOWCASE_SURFACE_IDS.studio,
    },
    {
      id: "place",
      title: "Place sound in 3D",
      description: "Drag a complete track or clip back into the world.",
      complete: sources.length > 0,
      surface: SHOWCASE_SURFACE_IDS.studio,
    },
    {
      id: "edit",
      title: "Edit the Hara world draft",
      description: "Move a source or tune its gain, range, looping or playback.",
      complete: editedAfterPlacement,
      surface: SHOWCASE_SURFACE_IDS.commands,
    },
    {
      id: "publish",
      title: "Create an accountable contribution",
      description: "Export a repository patch or signed Hestia contribution.",
      complete: published,
      surface: SHOWCASE_SURFACE_IDS.inspector,
    },
  ];
}

export function showcaseStats(state) {
  const project = state?.studio?.project ?? { assets: [], tracks: [] };
  const draft = state?.world?.draft ?? {};
  return {
    touchpoints: state?.world?.touchpoints?.length ?? 0,
    tracks: project.tracks?.length ?? 0,
    assets: project.assets?.length ?? 0,
    sources: sourceList(state).length,
    draftRevision: draft.revision ?? 0,
    publications: state?.world?.publications?.length ?? 0,
  };
}

export function showcaseWorldIdentity(state) {
  const repository = state?.world?.repository;
  return {
    repository: repository?.url
      ?? (repository?.owner && repository?.repo ? `${repository.owner}/${repository.repo}` : "unknown"),
    commit: state?.world?.commit ?? "unresolved",
    project: state?.world?.project?.id ?? "unknown",
    version: state?.world?.project?.version ?? "unknown",
    capabilities: state?.world?.project?.capabilities ?? [],
  };
}

export function firstShowcaseGuideTouchpoint(touchpoints = []) {
  return touchpoints.find((entry) => entry.surface === SHOWCASE_SURFACE_IDS.guide) ?? null;
}

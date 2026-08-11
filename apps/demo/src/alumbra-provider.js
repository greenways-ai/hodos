export const ALUMBRA_PROVIDER_ID = "alumbra/world";
export const PEACOCK_BALLROOM_ACTIVITY_ID = "alumbra-hara/peacock-ballroom";
export const PEACOCK_BALLROOM_PACKAGE = "hara:greenways/alumbra-peacock-ballroom@0.1.0";
export const PEACOCK_BALLROOM_STATES = Object.freeze([
  "ballroom/day",
  "ballroom/gallery-overlook",
  "ballroom/mosaic-floor",
]);
export const PEACOCK_BALLROOM_DEFAULT_STATE = PEACOCK_BALLROOM_STATES[0];
export const ALUMBRA_PROVIDER_ORIGIN = "https://oss.greenways.ai";
export const ALUMBRA_PROVIDER_HOST = `${ALUMBRA_PROVIDER_ORIGIN}/hodos/alumbra/apps/lab/peacock-ballroom.html`;

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
};

export function peacockBallroomProviderUrl(state, baseUrl = ALUMBRA_PROVIDER_HOST) {
  const selected = PEACOCK_BALLROOM_STATES.includes(state) ? state : PEACOCK_BALLROOM_DEFAULT_STATE;
  const url = new URL(baseUrl);
  if (url.protocol !== "https:"
      || url.origin !== ALUMBRA_PROVIDER_ORIGIN
      || !url.pathname.startsWith("/hodos/alumbra/")) {
    throw new Error("Alumbra provider host must use the installed Hodos Greenways origin");
  }
  url.searchParams.set("state", selected);
  url.searchParams.set("embed", "hodos");
  return url.href;
}

export function createAlumbraWorldProviderRegistration({
  document = globalThis.document,
  baseUrl = ALUMBRA_PROVIDER_HOST,
} = {}) {
  if (!document || typeof document.createElement !== "function") {
    throw new TypeError("Alumbra provider adapter requires a document");
  }
  return Object.freeze({
    providerId: ALUMBRA_PROVIDER_ID,
    activities: Object.freeze({
      [PEACOCK_BALLROOM_ACTIVITY_ID]: Object.freeze({
        package: PEACOCK_BALLROOM_PACKAGE,
        defaultState: PEACOCK_BALLROOM_DEFAULT_STATE,
        states: PEACOCK_BALLROOM_STATES,
      }),
    }),
    metadata: Object.freeze({
      label: "Alumbra",
      version: "0.1.0",
      source: "greenways-ai/alumbra",
    }),
    factory({root, launch}) {
      let status = "loading";
      let loads = 0;
      let disposed = false;
      const shell = document.createElement("section");
      shell.className = "provider-world-surface";
      shell.dataset.providerId = launch.providerId;
      shell.dataset.activityId = launch.activityId;
      shell.dataset.state = launch.state;

      const iframe = document.createElement("iframe");
      iframe.className = "provider-world-frame";
      iframe.title = "Peacock Ballroom · Alumbra world provider";
      iframe.src = peacockBallroomProviderUrl(launch.state, baseUrl);
      iframe.allow = "fullscreen";
      iframe.addEventListener("load", () => {
        if (disposed) return;
        loads += 1;
        status = "ready";
        shell.dataset.ready = "true";
      });
      shell.append(iframe);
      root.replaceChildren(shell);

      return Object.freeze({
        snapshot() {
          return deepFreeze({
            format: "hodos.alumbra-provider-evidence/1",
            status,
            providerId: launch.providerId,
            activityId: launch.activityId,
            package: launch.package,
            state: launch.state,
            loads,
          });
        },
        destroy() {
          if (disposed) return;
          disposed = true;
          status = "disposed";
          iframe.src = "about:blank";
          shell.remove?.();
        },
      });
    },
  });
}

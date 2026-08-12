import assert from "node:assert/strict";
import test from "node:test";
import {
  ALUMBRA_PROVIDER_HOST,
  ALUMBRA_PROVIDER_ID,
  ALUMBRA_PROVIDER_RELEASE,
  PEACOCK_BALLROOM_ACTIVITY_ID,
  PEACOCK_BALLROOM_PACKAGE,
  PEACOCK_BALLROOM_STATES,
  createAlumbraWorldProviderRegistration,
  peacockBallroomProviderUrl,
} from "../src/alumbra-provider.js";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.listeners = new Map();
    this.className = "";
    this.src = "";
    this.title = "";
    this.allow = "";
  }
  append(...children) { this.children.push(...children); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type) { this.listeners.get(type)?.(); }
  remove() { this.removed = true; }
}

class FakeDocument {
  createElement(tagName) { return new FakeElement(tagName); }
}

class FakeRoot {
  constructor() { this.children = []; }
  replaceChildren(...children) { this.children = children; }
}

test("builds only the installed Hodos Greenways provider URL", () => {
  const url = new URL(peacockBallroomProviderUrl("ballroom/gallery-overlook"));
  assert.equal(url.origin, "https://oss.greenways.ai");
  assert.equal(url.pathname, "/hodos/alumbra/apps/lab/peacock-ballroom.html");
  assert.equal(url.searchParams.get("state"), "ballroom/gallery-overlook");
  assert.equal(url.searchParams.get("embed"), "hodos");
  assert.equal(url.searchParams.get("release"), ALUMBRA_PROVIDER_RELEASE);
  assert.equal(ALUMBRA_PROVIDER_RELEASE, "3eb7d05d047c8600c64b709d33e0542c74a98789");
  assert.equal(peacockBallroomProviderUrl("ballroom/missing").includes("state=ballroom%2Fday"), true);
  assert.throws(
    () => peacockBallroomProviderUrl("ballroom/day", "https://example.test/world"),
    /installed Hodos Greenways origin/,
  );
  assert.throws(
    () => peacockBallroomProviderUrl("ballroom/day", "https://oss.greenways.ai/visual-language/world"),
    /installed Hodos Greenways origin/,
  );
});

test("registers the exact Peacock Ballroom provider activity and states", () => {
  const registration = createAlumbraWorldProviderRegistration({document: new FakeDocument()});
  assert.equal(registration.providerId, ALUMBRA_PROVIDER_ID);
  assert.equal(registration.metadata.release, ALUMBRA_PROVIDER_RELEASE);
  assert.deepEqual(registration.activities[PEACOCK_BALLROOM_ACTIVITY_ID], {
    package: PEACOCK_BALLROOM_PACKAGE,
    defaultState: "ballroom/day",
    states: PEACOCK_BALLROOM_STATES,
  });
  assert.doesNotMatch(JSON.stringify({
    providerId: registration.providerId,
    activities: registration.activities,
    metadata: registration.metadata,
  }), /mesh|shader|chunk|callback|PlayCanvas/);
});

test("allocates one iframe controller and releases it deterministically", () => {
  const document = new FakeDocument();
  const root = new FakeRoot();
  const registration = createAlumbraWorldProviderRegistration({document, baseUrl: ALUMBRA_PROVIDER_HOST});
  const controller = registration.factory({
    root,
    launch: {
      providerId: ALUMBRA_PROVIDER_ID,
      activityId: PEACOCK_BALLROOM_ACTIVITY_ID,
      package: PEACOCK_BALLROOM_PACKAGE,
      state: "ballroom/mosaic-floor",
    },
  });
  assert.equal(root.children.length, 1);
  const frame = root.children[0].children[0];
  assert.equal(frame.tagName, "IFRAME");
  const frameUrl = new URL(frame.src);
  assert.equal(frameUrl.searchParams.get("state"), "ballroom/mosaic-floor");
  assert.equal(frameUrl.searchParams.get("release"), ALUMBRA_PROVIDER_RELEASE);
  assert.equal(controller.snapshot().status, "loading");
  assert.equal(controller.snapshot().release, ALUMBRA_PROVIDER_RELEASE);
  frame.dispatch("load");
  assert.equal(controller.snapshot().status, "ready");
  assert.equal(controller.snapshot().loads, 1);
  controller.destroy();
  assert.equal(controller.snapshot().status, "disposed");
  assert.equal(frame.src, "about:blank");
});

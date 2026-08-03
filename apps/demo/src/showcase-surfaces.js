import "./showcase.css";
import {
  activateShowcaseSurface,
  showcaseProgress,
  showcaseStats,
  showcaseWorldIdentity,
  SHOWCASE_SURFACE_IDS,
} from "./showcase-world.js";

function element(document, tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(document, label, action, className = "") {
  const node = element(document, "button", className, label);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

function countLabel(value, singular, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function createShowcaseGuideSurface({ root, dispatch, requestClose }) {
  const document = root.ownerDocument ?? globalThis.document;
  let state = null;

  root.innerHTML = `<section class="showcase-guide">
    <div class="showcase-guide-hero">
      <div><p>GREENWAYS WORLDS / GUIDED EXPERIENCE</p><h1>A world can be an application.</h1></div>
      <p>Walk through a composed Gaussian-splat place, open precise web tools from spatial objects, create music, return it to the room, and publish the resulting Hara world draft.</p>
    </div>
    <div class="showcase-guide-body">
      <section class="showcase-journey"><header><span>YOUR JOURNEY</span><strong data-progress-label>0 / 5 complete</strong></header><ol data-progress></ol></section>
      <aside class="showcase-guide-side">
        <section class="showcase-actions"><p>OPEN A SURFACE</p><div data-actions></div></section>
        <section class="showcase-stats"><p>LIVE WORLD</p><dl data-stats></dl></section>
      </aside>
    </div>
    <section class="showcase-architecture" aria-label="Hodos architecture">
      <article><span>01</span><strong>Hara</strong><p>Authoritative world, Studio, review and command state.</p></article>
      <article><span>02</span><strong>PlayCanvas</strong><p>Gaussian splats, spatial anchors, picking and camera projection.</p></article>
      <article><span>03</span><strong>Web platform</strong><p>HTML tools, Web Audio, OPFS, files, hashing and signatures.</p></article>
      <article><span>04</span><strong>Git / Hestia</strong><p>Reviewable patches and signed room contributions.</p></article>
    </section>
  </section>`;

  const progressRoot = root.querySelector("[data-progress]");
  const progressLabel = root.querySelector("[data-progress-label]");
  const statsRoot = root.querySelector("[data-stats]");
  const actionsRoot = root.querySelector("[data-actions]");

  const actions = [
    ["Open Studio", SHOWCASE_SURFACE_IDS.studio, "Create and arrange local audio."],
    ["Inspect Hara", SHOWCASE_SURFACE_IDS.inspector, "See the exact live state carried by the kernel."],
    ["Command deck", SHOWCASE_SURFACE_IDS.commands, "Invoke discoverable semantic commands."],
  ];
  for (const [label, surface, description] of actions) {
    const action = button(document, label, () => activateShowcaseSurface(dispatch, state, surface));
    const wrapper = element(document, "article");
    wrapper.append(action, element(document, "p", "", description));
    actionsRoot.append(wrapper);
  }
  actionsRoot.append(button(document, "Return to world", requestClose, "showcase-secondary"));

  function render(next) {
    state = next;
    const progress = showcaseProgress(next);
    const complete = progress.filter((step) => step.complete).length;
    progressLabel.textContent = `${complete} / ${progress.length} complete`;
    progressRoot.replaceChildren(...progress.map((step, index) => {
      const item = element(document, "li");
      item.dataset.complete = String(step.complete);
      const marker = element(document, "span", "showcase-step-marker", step.complete ? "✓" : String(index + 1).padStart(2, "0"));
      const copy = element(document, "div");
      copy.append(
        element(document, "strong", "", step.title),
        element(document, "p", "", step.description),
      );
      const open = button(document, step.complete ? "Review" : "Open", () => {
        activateShowcaseSurface(dispatch, state, step.surface);
      });
      item.append(marker, copy, open);
      return item;
    }));

    const stats = showcaseStats(next);
    const values = [
      ["Touchpoints", stats.touchpoints],
      ["Studio tracks", stats.tracks],
      ["Audio assets", stats.assets],
      ["World sources", stats.sources],
      ["Draft revision", stats.draftRevision],
      ["Publications", stats.publications],
    ];
    statsRoot.replaceChildren(...values.map(([label, value]) => {
      const row = element(document, "div");
      row.append(element(document, "dt", "", label), element(document, "dd", "", String(value)));
      return row;
    }));
  }

  return { update: render, destroy() { root.replaceChildren(); } };
}

export function inspectorSnapshot(state) {
  const identity = showcaseWorldIdentity(state);
  const project = state?.studio?.project ?? { assets: [], tracks: [] };
  return {
    session: {
      id: state?.id ?? null,
      revision: state?.revision ?? 0,
      activeSurface: state?.surface?.id ?? null,
    },
    world: {
      ...identity,
      touchpoints: state?.world?.touchpoints ?? [],
      draft: state?.world?.draft ?? null,
      review: state?.world?.review ?? null,
      publications: state?.world?.publications ?? [],
    },
    studio: {
      project: {
        id: project.id ?? null,
        title: project.title ?? null,
        assets: project.assets ?? [],
        tracks: project.tracks ?? [],
      },
      transport: state?.studio?.transport ?? null,
      selection: state?.studio?.selection ?? null,
      history: state?.studio?.history ?? null,
    },
  };
}

export function createWorldInspectorSurface({ root, dispatch }) {
  const document = root.ownerDocument ?? globalThis.document;
  let state = null;
  let activeTab = "overview";

  root.innerHTML = `<section class="showcase-inspector">
    <nav aria-label="Inspector views"><button type="button" data-tab="overview">Overview</button><button type="button" data-tab="touchpoints">Touchpoints</button><button type="button" data-tab="state">Hara state</button></nav>
    <div class="showcase-inspector-content" data-content></div>
  </section>`;
  const content = root.querySelector("[data-content]");
  const tabs = [...root.querySelectorAll("[data-tab]")];
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      activeTab = tab.dataset.tab;
      render();
    });
  }

  function renderOverview(snapshot) {
    const section = element(document, "section", "showcase-overview");
    const identity = snapshot.world;
    const heading = element(document, "div", "showcase-overview-heading");
    heading.append(
      element(document, "p", "", "IMMUTABLE WORLD IDENTITY"),
      element(document, "h2", "", identity.project),
      element(document, "code", "", `${identity.repository}@${identity.commit}`),
    );
    const cards = element(document, "div", "showcase-overview-cards");
    const stats = showcaseStats(state);
    for (const [label, value] of [
      ["Session revision", snapshot.session.revision],
      ["Draft revision", stats.draftRevision],
      ["Touchpoints", stats.touchpoints],
      ["Studio tracks", stats.tracks],
      ["Spatial sources", stats.sources],
      ["Receipts", stats.publications],
    ]) {
      const card = element(document, "article");
      card.append(element(document, "span", "", label), element(document, "strong", "", String(value)));
      cards.append(card);
    }
    const capabilities = element(document, "section", "showcase-capabilities");
    capabilities.append(element(document, "h3", "", "Declared host capabilities"));
    const list = element(document, "div");
    for (const capability of identity.capabilities ?? []) list.append(element(document, "code", "", capability));
    capabilities.append(list);
    section.append(heading, cards, capabilities);
    return section;
  }

  function renderTouchpoints(snapshot) {
    const section = element(document, "section", "showcase-touchpoint-list");
    section.append(element(document, "h2", "", "Spatial application touchpoints"));
    for (const touchpoint of snapshot.world.touchpoints ?? []) {
      const item = element(document, "article");
      const copy = element(document, "div");
      copy.append(
        element(document, "strong", "", touchpoint.label || touchpoint.id),
        element(document, "code", "", touchpoint.surface),
      );
      const open = button(document, "Open", () => dispatch({
        "event/type": "touchpoint/activate",
        touchpoint,
      }));
      item.append(copy, open);
      section.append(item);
    }
    return section;
  }

  function renderState(snapshot) {
    const section = element(document, "section", "showcase-state-view");
    const heading = element(document, "div");
    heading.append(
      element(document, "h2", "", "Serializable Hara session"),
      element(document, "p", "", "No DOM nodes, AudioBuffers, CryptoKeys or PlayCanvas entities enter this value."),
    );
    const pre = element(document, "pre");
    pre.textContent = JSON.stringify(snapshot, null, 2);
    section.append(heading, pre);
    return section;
  }

  function render() {
    if (!state) return;
    for (const tab of tabs) tab.dataset.active = String(tab.dataset.tab === activeTab);
    const snapshot = inspectorSnapshot(state);
    content.replaceChildren(
      activeTab === "touchpoints"
        ? renderTouchpoints(snapshot)
        : activeTab === "state"
          ? renderState(snapshot)
          : renderOverview(snapshot),
    );
  }

  return {
    update(next) { state = next; render(); },
    destroy() { root.replaceChildren(); },
  };
}

export function showcaseCommandCatalog(state) {
  const studioHistory = state?.studio?.history ?? { undo: [], redo: [] };
  const worldHistory = state?.world?.draft?.history ?? { undo: [], redo: [] };
  const project = state?.studio?.project ?? { tracks: [] };
  const sources = state?.world?.draft?.audioSources ?? [];
  const reviewing = Boolean(state?.world?.review?.proposal);
  const hasPlayableClips = (project.tracks ?? []).some((track) => (track.clips?.length ?? 0) > 0);

  return [
    {
      id: "surface.guide",
      title: "Open guided tour",
      group: "Surfaces",
      description: "Return to the guided Greenways Worlds journey.",
      shortcut: "G",
      available: true,
      action: { kind: "surface", surface: SHOWCASE_SURFACE_IDS.guide },
    },
    {
      id: "surface.studio",
      title: "Open music Studio",
      group: "Surfaces",
      description: "Open the multitrack browser-native Studio.",
      shortcut: "S",
      available: true,
      action: { kind: "surface", surface: SHOWCASE_SURFACE_IDS.studio },
    },
    {
      id: "surface.inspector",
      title: "Inspect Hara session",
      group: "Surfaces",
      description: "Inspect world identity, touchpoints, drafts and Studio state.",
      shortcut: "I",
      available: true,
      action: { kind: "surface", surface: SHOWCASE_SURFACE_IDS.inspector },
    },
    {
      id: "studio.play",
      title: "Play Studio project",
      group: "Studio",
      description: "Apply the playing transport intent through Hara.",
      shortcut: "Space",
      available: hasPlayableClips,
      action: { kind: "event", event: { "event/type": "studio/transport", status: "playing" } },
    },
    {
      id: "studio.stop",
      title: "Stop Studio project",
      group: "Studio",
      description: "Stop the current browser audio projection through Hara.",
      shortcut: "Shift-Space",
      available: true,
      action: { kind: "event", event: { "event/type": "studio/transport", status: "stopped" } },
    },
    {
      id: "studio.undo",
      title: "Undo Studio command",
      group: "History",
      description: "Restore the previous canonical Studio project.",
      shortcut: "⌘Z",
      available: (studioHistory.undo?.length ?? 0) > 0,
      action: { kind: "event", event: { "event/type": "studio/history-undo" } },
    },
    {
      id: "studio.redo",
      title: "Redo Studio command",
      group: "History",
      description: "Reapply the next canonical Studio project.",
      shortcut: "⇧⌘Z",
      available: (studioHistory.redo?.length ?? 0) > 0,
      action: { kind: "event", event: { "event/type": "studio/history-redo" } },
    },
    {
      id: "world.undo",
      title: "Undo world draft command",
      group: "History",
      description: "Restore the previous spatial source collection.",
      shortcut: "W U",
      available: (worldHistory.undo?.length ?? 0) > 0,
      action: { kind: "event", event: { "event/type": "world/history-undo" } },
    },
    {
      id: "world.redo",
      title: "Redo world draft command",
      group: "History",
      description: "Reapply the next spatial source collection.",
      shortcut: "W R",
      available: (worldHistory.redo?.length ?? 0) > 0,
      action: { kind: "event", event: { "event/type": "world/history-redo" } },
    },
    {
      id: "world.export",
      title: "Export portable world draft",
      group: "Publication",
      description: "Download the exact-world .hodos-world.json draft.",
      shortcut: "W E",
      available: sources.length > 0 && !reviewing,
      action: { kind: "event", event: { "event/type": "world/draft-export" } },
    },
    {
      id: "world.patch",
      title: "Create repository patch",
      group: "Publication",
      description: "Create a git-apply patch containing the accepted draft.",
      shortcut: "W P",
      available: sources.length > 0 && !reviewing,
      action: { kind: "event", event: { "event/type": "world/publish-repository" } },
    },
    {
      id: "surface.close",
      title: "Return to 3D world",
      group: "Surfaces",
      description: "Close the current classical interface.",
      shortcut: "Esc",
      available: true,
      action: { kind: "close" },
    },
  ];
}

export function filterShowcaseCommands(commands, query) {
  const terms = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...commands];
  return commands.filter((command) => {
    const haystack = `${command.id} ${command.title} ${command.group} ${command.description}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function createCommandDeckSurface({ root, dispatch, requestClose }) {
  const document = root.ownerDocument ?? globalThis.document;
  let state = null;
  let query = "";
  let selected = 0;

  root.innerHTML = `<section class="showcase-command-deck">
    <header><span>M-x</span><input type="search" aria-label="Search Hodos commands" placeholder="Type a command…" autocomplete="off"></header>
    <div class="showcase-command-body"><div class="showcase-command-list" data-list></div><aside data-preview></aside></div>
    <footer><span>↑ ↓ navigate</span><span>Enter invoke</span><span>Esc return to world</span></footer>
  </section>`;
  const input = root.querySelector("input");
  const list = root.querySelector("[data-list]");
  const preview = root.querySelector("[data-preview]");

  function commands() {
    return filterShowcaseCommands(showcaseCommandCatalog(state), query);
  }

  function execute(command) {
    if (!command?.available) return;
    if (command.action.kind === "surface") {
      activateShowcaseSurface(dispatch, state, command.action.surface);
    } else if (command.action.kind === "event") {
      dispatch(command.action.event);
    } else if (command.action.kind === "close") {
      requestClose();
    }
  }

  function render() {
    const values = commands();
    selected = Math.max(0, Math.min(selected, Math.max(0, values.length - 1)));
    list.replaceChildren(...values.map((command, index) => {
      const row = button(document, "", () => execute(command), "showcase-command");
      row.dataset.selected = String(index === selected);
      row.disabled = !command.available;
      const copy = element(document, "span");
      copy.append(
        element(document, "strong", "", command.title),
        element(document, "small", "", command.group),
      );
      row.append(copy, element(document, "kbd", "", command.shortcut || ""));
      return row;
    }));

    const command = values[selected];
    preview.replaceChildren();
    if (!command) {
      preview.append(element(document, "p", "", "No matching commands."));
      return;
    }
    preview.append(
      element(document, "p", "showcase-command-group", command.group),
      element(document, "h2", "", command.title),
      element(document, "p", "", command.description),
      element(document, "code", "", command.id),
    );
    if (command.action.event) {
      const pre = element(document, "pre");
      pre.textContent = JSON.stringify(command.action.event, null, 2);
      preview.append(pre);
    }
    if (!command.available) preview.append(element(document, "p", "showcase-command-unavailable", "Not available in the current Hara state."));
  }

  input.addEventListener("input", () => {
    query = input.value;
    selected = 0;
    render();
  });
  input.addEventListener("keydown", (event) => {
    const values = commands();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selected = Math.min(values.length - 1, selected + 1);
      render();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selected = Math.max(0, selected - 1);
      render();
    } else if (event.key === "Enter") {
      event.preventDefault();
      execute(values[selected]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
    }
  });

  queueMicrotask(() => input.focus());
  return {
    update(next) { state = next; render(); },
    destroy() { root.replaceChildren(); },
  };
}

export const SHOWCASE_SURFACE_FACTORIES = Object.freeze({
  [SHOWCASE_SURFACE_IDS.guide]: createShowcaseGuideSurface,
  [SHOWCASE_SURFACE_IDS.inspector]: createWorldInspectorSurface,
  [SHOWCASE_SURFACE_IDS.commands]: createCommandDeckSurface,
});

export const showcaseSummaryText = (state) => {
  const stats = showcaseStats(state);
  return [
    countLabel(stats.touchpoints, "touchpoint"),
    countLabel(stats.tracks, "Studio track"),
    countLabel(stats.sources, "world source"),
    countLabel(stats.publications, "publication"),
  ].join(" · ");
};

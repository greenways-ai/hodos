import "./world-draft-review-panel.css";

function button(document, label, action, className = "") {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  if (className) element.className = className;
  element.addEventListener("click", action);
  return element;
}

function valueText(value) {
  if (value === undefined) return "not set";
  if (value === null) return "none";
  if (Array.isArray(value)) return `[${value.join(", ")}]`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function operationLabel(operation) {
  if (operation === "add") return "Add";
  if (operation === "remove") return "Remove";
  return "Change";
}

export class WorldDraftReviewPanel {
  constructor(root, { dispatch, importDraft } = {}) {
    if (!root) throw new Error("WorldDraftReviewPanel requires a root element");
    if (typeof dispatch !== "function") throw new Error("WorldDraftReviewPanel requires dispatch");
    this.root = root;
    this.dispatch = dispatch;
    this.importDraft = importDraft;
    this.state = null;
    this.destroyed = false;
    this.renderShell();
  }

  renderShell() {
    const document = this.root.ownerDocument ?? globalThis.document;
    this.root.className = "hodos-world-review";
    this.root.innerHTML = "";

    const header = document.createElement("header");
    const identity = document.createElement("div");
    const eyebrow = document.createElement("span");
    eyebrow.textContent = "SEMANTIC REVIEW";
    const title = document.createElement("strong");
    title.textContent = "Import & publish";
    identity.append(eyebrow, title);
    const collapse = button(document, "Hide", () => {
      const collapsed = this.root.dataset.collapsed === "true";
      this.root.dataset.collapsed = String(!collapsed);
      collapse.textContent = collapsed ? "Hide" : "Show";
    }, "hodos-world-review-collapse");
    header.append(identity, collapse);

    const toolbar = document.createElement("div");
    toolbar.className = "hodos-world-review-toolbar";
    this.file = document.createElement("input");
    this.file.type = "file";
    this.file.accept = ".hodos-world.json,application/json,.json";
    this.file.hidden = true;
    this.file.addEventListener("change", () => {
      const [file] = this.file.files ?? [];
      this.file.value = "";
      if (file) this.readImport(file);
    });
    this.importButton = button(document, "Import draft", () => this.file.click());
    this.repositoryButton = button(document, "Repository patch", () => {
      this.dispatch({ "event/type": "world/publish-repository" });
    });
    this.room = document.createElement("input");
    this.room.type = "text";
    this.room.value = "hestia:room:local";
    this.room.placeholder = "Hestia room id";
    this.room.setAttribute("aria-label", "Hestia room identifier");
    this.hestiaButton = button(document, "Sign Hestia", () => {
      this.dispatch({
        "event/type": "world/publish-hestia",
        room: this.room.value,
      });
    });
    toolbar.append(
      this.file,
      this.importButton,
      this.repositoryButton,
      this.room,
      this.hestiaButton,
    );

    this.status = document.createElement("p");
    this.status.className = "hodos-world-review-status";
    this.status.setAttribute("role", "status");
    this.content = document.createElement("div");
    this.content.className = "hodos-world-review-content";
    this.root.append(header, toolbar, this.status, this.content);
  }

  async readImport(file) {
    if (typeof this.importDraft !== "function") {
      this.status.textContent = "This host has not installed a draft importer.";
      return;
    }
    this.importButton.disabled = true;
    this.status.textContent = `Inspecting ${file.name}…`;
    try {
      const proposal = await this.importDraft(file, this.state);
      this.dispatch({ "event/type": "world/draft-propose", proposal });
      this.status.textContent = `${proposal.changes.length} semantic change${proposal.changes.length === 1 ? "" : "s"} ready for review.`;
    } catch (error) {
      console.error("Hodos world draft import failed", error);
      this.status.textContent = `Import rejected: ${error.message}`;
    } finally {
      this.importButton.disabled = false;
    }
  }

  changeRow(change, selected) {
    const document = this.root.ownerDocument ?? globalThis.document;
    const article = document.createElement("article");
    article.className = "hodos-world-review-change";
    article.dataset.operation = change.op;

    const heading = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selected.has(change.id);
    checkbox.addEventListener("change", () => this.dispatch({
      "event/type": "world/draft-review-toggle",
      change: change.id,
    }));
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = `${operationLabel(change.op)} ${change.label || change.source}`;
    const id = document.createElement("small");
    id.textContent = change.source;
    copy.append(name, id);
    heading.append(checkbox, copy);

    const fields = document.createElement("dl");
    for (const field of change.fields ?? []) {
      const row = document.createElement("div");
      const term = document.createElement("dt");
      term.textContent = field.field;
      const detail = document.createElement("dd");
      const before = document.createElement("del");
      before.textContent = valueText(field.before);
      const after = document.createElement("ins");
      after.textContent = valueText(field.after);
      detail.append(before, document.createTextNode(" → "), after);
      row.append(term, detail);
      fields.append(row);
    }
    article.append(heading, fields);
    return article;
  }

  renderReview(review) {
    const document = this.root.ownerDocument ?? globalThis.document;
    const proposal = review?.proposal;
    if (!proposal) return null;
    const section = document.createElement("section");
    section.className = "hodos-world-review-proposal";
    const summary = document.createElement("p");
    const counts = proposal.summary ?? {};
    summary.textContent = `${counts.add || 0} added · ${counts.replace || 0} changed · ${counts.remove || 0} removed`;
    const selected = new Set(review.selected ?? proposal.selected ?? []);
    const changes = document.createElement("div");
    changes.className = "hodos-world-review-changes";
    changes.append(...(proposal.changes ?? []).map((change) => this.changeRow(change, selected)));

    const actions = document.createElement("div");
    actions.className = "hodos-world-review-actions";
    const accept = button(document, `Accept ${selected.size}`, () => {
      this.dispatch({ "event/type": "world/draft-review-accept" });
    }, "hodos-world-review-primary");
    accept.disabled = selected.size === 0;
    actions.append(
      accept,
      button(document, "Reject proposal", () => {
        this.dispatch({ "event/type": "world/draft-review-reject" });
      }),
    );
    section.append(summary, changes, actions);
    return section;
  }

  renderPublications(publications = []) {
    const document = this.root.ownerDocument ?? globalThis.document;
    const section = document.createElement("section");
    section.className = "hodos-world-publications";
    const title = document.createElement("h3");
    title.textContent = "Publication receipts";
    section.append(title);
    if (!publications.length) {
      const empty = document.createElement("p");
      empty.textContent = "No repository patch or Hestia contribution has been produced for this session.";
      section.append(empty);
      return section;
    }
    const list = document.createElement("ol");
    for (const receipt of publications.slice().reverse().slice(0, 8)) {
      const item = document.createElement("li");
      const name = document.createElement("strong");
      name.textContent = receipt.target === "hestia" ? "Hestia contribution" : "Repository patch";
      const detail = document.createElement("span");
      detail.textContent = receipt.room
        ? `${receipt.room} · ${receipt.digest || "signed"}`
        : `${receipt.path || receipt.filename || "patch"} · ${receipt.digest || "created"}`;
      item.append(name, detail);
      list.append(item);
    }
    section.append(list);
    return section;
  }

  update(state) {
    if (this.destroyed) return;
    this.state = state;
    const draft = state?.world?.draft;
    const review = state?.world?.review;
    const publications = state?.world?.publications ?? [];
    const hasSources = Boolean(draft?.audioSources?.length);
    const reviewing = Boolean(review?.proposal);
    this.repositoryButton.disabled = !hasSources || reviewing;
    this.hestiaButton.disabled = !hasSources || reviewing;
    this.room.disabled = reviewing;
    this.content.replaceChildren();

    const proposal = this.renderReview(review);
    if (proposal) {
      this.content.append(proposal);
      this.status.textContent = review.stale
        ? "The proposal is stale because the draft changed. Reject it and import again."
        : "Select the source changes Hara should accept as one reversible world transaction.";
    } else {
      this.content.append(this.renderPublications(publications));
      if (!this.status.textContent || this.status.textContent.includes("ready for review")) {
        this.status.textContent = hasSources
          ? "Import an exact-world draft for semantic review, or publish the accepted local draft."
          : "Place a Studio track or clip before importing or publishing a world draft.";
      }
    }
  }

  destroy() {
    this.destroyed = true;
    this.root.replaceChildren();
  }
}

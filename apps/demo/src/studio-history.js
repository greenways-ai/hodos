function historyButton(document, label, eventType, dispatch) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.disabled = true;
  button.addEventListener("click", () => dispatch({ "event/type": eventType }));
  return button;
}

function acceptsNativeUndo(target, host) {
  const Input = host.HTMLInputElement;
  const Textarea = host.HTMLTextAreaElement;
  return Boolean(
    (Input && target instanceof Input)
    || (Textarea && target instanceof Textarea)
    || target?.isContentEditable,
  );
}

export function withStudioHistory(factory, host = globalThis) {
  if (typeof factory !== "function") throw new Error("Studio history requires a surface factory");
  return (context) => {
    const controller = factory(context) ?? {};
    const document = context.root.ownerDocument;
    const app = context.root.querySelector(".studio-app");
    const actions = context.root.querySelector("[data-actions]");
    if (!app || !actions) throw new Error("Studio history requires the studio application shell");

    const undo = historyButton(document, "Undo", "studio/history-undo", context.dispatch);
    const redo = historyButton(document, "Redo", "studio/history-redo", context.dispatch);
    actions.prepend(redo);
    actions.prepend(undo);

    const abort = new AbortController();
    app.addEventListener("keydown", (event) => {
      if (acceptsNativeUndo(event.target, host)) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        context.dispatch({ "event/type": event.shiftKey ? "studio/history-redo" : "studio/history-undo" });
      } else if (key === "y") {
        event.preventDefault();
        context.dispatch({ "event/type": "studio/history-redo" });
      }
    }, { signal: abort.signal });

    return {
      ...controller,
      update(state) {
        const history = state?.studio?.history ?? { undo: [], redo: [] };
        undo.disabled = !(history.undo?.length);
        redo.disabled = !(history.redo?.length);
        controller.update?.(state);
      },
      destroy() {
        abort.abort();
        controller.destroy?.();
      },
    };
  };
}

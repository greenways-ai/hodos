export async function handleHaraScriptEffect(effect, state, context, evaluateHodosScript) {
  if (effect?.effect !== "script" || effect?.method !== "evaluate") return false;
  if (typeof evaluateHodosScript !== "function") throw new Error("Hodos script effect requires a Hara runtime add-on");
  const [request = {}] = effect.args ?? [];
  try {
    const result = evaluateHodosScript({
      source: request.source,
      event: request.event ?? {},
      entity: request.entity ?? {},
      world: state?.world?.draft ?? {},
    });
    context.dispatch({
      "event/type": "world/script-result",
      trace: request.trace,
      entity: request.entity?.id,
      scriptEvent: request.event,
      status: "completed",
      result,
      at: new Date().toISOString(),
    });
  } catch (error) {
    context.dispatch({
      "event/type": "world/script-result",
      trace: request.trace,
      entity: request.entity?.id,
      scriptEvent: request.event,
      status: "failed",
      error: error.message,
      at: new Date().toISOString(),
    });
  }
  return true;
}

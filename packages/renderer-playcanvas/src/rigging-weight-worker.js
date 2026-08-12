import { executeRiggingWeightTask } from "./rigging-weight-task.js";

self.addEventListener("message", (event) => {
  const id = event?.data?.id;
  try {
    const result = executeRiggingWeightTask(event?.data?.task);
    const transfer = [result.jointIndices.buffer, result.weights.buffer];
    if (result.componentAssignments) transfer.push(result.componentAssignments.buffer);
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: {
        name: error?.name ?? "Error",
        code: error?.code ?? null,
        message: String(error?.message ?? error).slice(0, 1024),
      },
    });
  }
});

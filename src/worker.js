import { evolve, validatePoints } from "./symbolic-core.js";

let runId = 0;
let shouldStop = false;

self.addEventListener("message", (event) => {
  const message = event.data;

  if (message.type === "stop") {
    shouldStop = true;
    return;
  }

  if (message.type !== "start") {
    return;
  }

  runId += 1;
  const activeRunId = runId;
  shouldStop = false;
  const points = message.points ?? [];
  const errors = validatePoints(points);

  if (errors.length > 0) {
    self.postMessage({ type: "error", runId: activeRunId, errors });
    return;
  }

  try {
    const result = evolve(
      points,
      message.config ?? {},
      (progress) => {
        if (activeRunId === runId && !shouldStop) {
          self.postMessage({ type: "progress", runId: activeRunId, result: progress });
        }
      },
      () => shouldStop || activeRunId !== runId
    );

    if (shouldStop) {
      self.postMessage({ type: "stopped", runId: activeRunId, result });
      return;
    }

    self.postMessage({ type: "done", runId: activeRunId, result });
  } catch (error) {
    self.postMessage({
      type: "error",
      runId: activeRunId,
      errors: [error instanceof Error ? error.message : String(error)]
    });
  }
});

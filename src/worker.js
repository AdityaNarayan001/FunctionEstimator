import { evolve, validatePoints } from "./symbolic-core.js";

// One worker runs one search. The search is a synchronous loop, so the page
// stops it by terminating the worker rather than by sending a message.
self.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type !== "start") {
    return;
  }

  const points = message.points ?? [];
  const errors = validatePoints(points);
  if (errors.length > 0) {
    self.postMessage({ type: "error", errors });
    return;
  }

  try {
    const result = evolve(points, message.config ?? {}, (progress) => {
      self.postMessage({ type: "progress", result: progress });
    });
    self.postMessage({ type: "done", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      errors: [error instanceof Error ? error.message : String(error)]
    });
  }
});

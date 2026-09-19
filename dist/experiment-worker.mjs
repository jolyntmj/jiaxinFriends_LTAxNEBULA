import { runExperiment } from "./experiments.mjs";
self.onmessage = ({ data: { data, change } }) => {
  try {
    const experiment = runExperiment(data, change, (scenario) =>
      self.postMessage({ type: "progress", scenario }),
    );
    self.postMessage({ type: "done", experiment });
  } catch (error) {
    self.postMessage({ type: "error", message: error.message });
  }
};

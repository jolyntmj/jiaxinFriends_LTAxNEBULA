import { runOperationalReplan } from "./operational-replan.mjs";

self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      type: "done",
      replan: runOperationalReplan(data.data, data.baseline, data.change),
    });
  } catch (error) {
    self.postMessage({ type: "error", message: error.message });
  }
};

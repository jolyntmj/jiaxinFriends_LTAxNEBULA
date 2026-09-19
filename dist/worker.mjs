import { findRecommendation, findStartDateSuggestion } from "./recommendations.mjs";
import { solve } from "./solver.mjs";

self.onmessage = (event) => {
  try {
    const { data } = event.data;

    const scenarios = ["A", "B", "C"];

    for (const scenario of scenarios) {
      self.postMessage({
        type: "progress",
        scenario,
      });

      const result = solve(data, scenario);

      self.postMessage({
        type: "result",
        scenario,
        result,
      });
      const recommendation =
        findRecommendation(data, result) || findStartDateSuggestion(data, result);
      self.postMessage({ type: "recommendation", scenario, recommendation });
    }

    self.postMessage({
      type: "done",
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error.message,
    });
  }
};

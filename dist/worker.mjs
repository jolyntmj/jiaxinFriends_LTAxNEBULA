import { solve } from "./solver.mjs";

self.onmessage = (event) => {
  try {
    const {
      data,
      options = {},
      baselines = {},
    } = event.data;

    const scenarios = [
      "A",
      "B",
      "C",
    ];

    for (const scenario of scenarios) {
      self.postMessage({
        type: "progress",
        scenario,
      });

      const result = solve(
        data,
        scenario,
        {
          ...options,
          baseline:
            baselines[scenario],
        },
      );

      self.postMessage({
        type: "result",
        scenario,
        result,
      });
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
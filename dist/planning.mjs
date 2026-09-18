import { scheduleChanges } from "./solver.mjs";

export const activityAccesses = (result, activityId) =>
  result.access
    .filter(
      (access) =>
        access.activity_id === activityId,
    )
    .sort(
      (first, second) =>
        first.week - second.week,
    );

export function activityAdvice(
  result,
  activityId,
) {
  const activity =
    result.modelInfo.activities.find(
      (item) => item.id === activityId,
    );

  const activityRows =
    activityAccesses(
      result,
      activityId,
    );

  const predecessorRows =
    activity.predecessor
      ? activityAccesses(
          result,
          activity.predecessor,
        )
      : [];

  const predecessorFinish =
    predecessorRows.length
      ? Math.max(
          ...predecessorRows.map(
            (access) => access.week,
          ),
        )
      : null;

  const effectiveStart = Math.max(
    activity.start,
    predecessorFinish !== null
      ? predecessorFinish + 1
      : 1,
  );

  const standardFinish =
    effectiveStart +
    Math.ceil(activity.workload) -
    1;

  const availableWeeks = Math.max(
    0,
    activity.due -
      effectiveStart +
      1,
  );

  const minimumECLO = Math.max(
    0,
    Math.ceil(
      2 *
        (
          activity.workload -
          availableWeeks
        ),
    ),
  );

  const scheduledFinish =
    activityRows.length
      ? Math.max(
          ...activityRows.map(
            (access) => access.week,
          ),
        )
      : null;

  return {
    a: activity,

    effective: effectiveStart,

    standardFinish,

    available: availableWeeks,

    minimumECLO,

    ecloCanFit:
      availableWeeks > 0 &&
      minimumECLO <= availableWeeks,

    earlierStart:
      activity.due -
      Math.ceil(activity.workload) +
      1,

    finish: scheduledFinish,

    late:
      scheduledFinish !== null &&
      scheduledFinish > activity.due,

    predFinish: predecessorFinish,
  };
}

export function comparePlans(
  baseline,
  current,
) {
  const changed =
    scheduleChanges(
      baseline,
      current,
    );

  const metricKeys = [
    "objective_score",
    "overrun_days_total",
    "eclo_nights_total",
    "excess_access_nights_total",
  ];

  const metrics = metricKeys.map(
    (key) => ({
      key,

      before:
        baseline.report[key],

      after:
        current.report[key],

      delta:
        current.report[key] -
        baseline.report[key],
    }),
  );

  const rows = changed.map(
    (activityId) => {
      const before =
        activityAccesses(
          baseline,
          activityId,
        );

      const after =
        activityAccesses(
          current,
          activityId,
        );

      const activity =
        current.modelInfo.activities.find(
          (item) =>
            item.id === activityId,
        );

      const beforeWeeks = before
        .map(
          (access) =>
            "W" +
            access.week +
            (
              access.eclo
                ? "*"
                : ""
            ),
        )
        .join(", ");

      const afterWeeks = after
        .map(
          (access) =>
            "W" +
            access.week +
            (
              access.eclo
                ? "*"
                : ""
            ),
        )
        .join(", ");

      const beforeFinish = Math.max(
        0,
        ...before.map(
          (access) => access.week,
        ),
      );

      const afterFinish = Math.max(
        0,
        ...after.map(
          (access) => access.week,
        ),
      );

      return {
        id: activityId,

        contract:
          activity.contract,

        before: beforeWeeks,

        after: afterWeeks,

        beforeFinish,

        afterFinish,
      };
    },
  );

  return {
    changed,

    unchanged:
      current.modelInfo.activities.length -
      changed.length,

    metrics,

    rows,
  };
}

export function changeEvidence(
  baseline,
  current,
  activityId,
) {
  const experiment =
    current.experiment || {};

  const baselineAccesses =
    activityAccesses(
      baseline,
      activityId,
    );

  const activity =
    current.modelInfo.activities.find(
      (item) =>
        item.id === activityId,
    );

  const disruptionHits = (
    experiment.disruptions || []
  ).filter(
    (disruption) =>
      activity.core.includes(
        disruption.location,
      ) &&
      baselineAccesses.some(
        (access) =>
          access.week >=
            disruption.from &&
          access.week <=
            disruption.to,
      ),
  );

  const reasons = [];

  if (
    experiment.startWeeks?.[
      activityId
    ]
  ) {
    reasons.push(
      "Start-week input changed to W" +
        experiment.startWeeks[
          activityId
        ] +
        ".",
    );
  }

  for (
    const disruption of disruptionHits
  ) {
    reasons.push(
      "Baseline occupied " +
        disruption.location +
        " during the reduced-capacity interval W" +
        disruption.from +
        "–" +
        disruption.to +
        ".",
    );
  }

  const predecessorChanged =
    activity.predecessor &&
    scheduleChanges(
      baseline,
      current,
    ).includes(
      activity.predecessor,
    );

  if (predecessorChanged) {
    reasons.push(
      "Predecessor " +
        activity.predecessor +
        " also changed; finish-to-start precedence still applies.",
    );
  }

  const decisions =
    current.decisions[
      activityId
    ] || [];

  for (
    const decision of decisions.slice(
      0,
      5,
    )
  ) {
    const blockers =
      decision.blockers?.length
        ? " (activities considered in conflicting slots: " +
          decision.blockers.join(", ") +
          ")"
        : "";

    reasons.push(
      "W" +
        decision.week +
        ": " +
        decision.reason +
        blockers +
        ".",
    );
  }

  if (reasons.length) {
    return reasons;
  }

  return [
    "The selected re-optimised plan uses a different placement. " +
      "No direct input change or specific deferral was recorded for this activity; " +
      "this is not proof of a unique cause.",
  ];
}
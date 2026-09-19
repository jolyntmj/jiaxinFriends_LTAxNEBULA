export const activityAccesses = (result, activityId) =>
  result.access
    .filter((access) => access.activity_id === activityId)
    .sort((first, second) => first.week - second.week);

export function activityAdvice(result, activityId) {
  const activity = result.modelInfo.activities.find((item) => item.id === activityId);

  const activityRows = activityAccesses(result, activityId);
  const predecessorRows = activity.predecessor
    ? activityAccesses(result, activity.predecessor)
    : [];

  const predecessorFinish = predecessorRows.length
    ? Math.max(...predecessorRows.map((access) => access.week))
    : null;

  const effectiveStart = Math.max(
    activity.start,
    predecessorFinish !== null ? predecessorFinish + 1 : 1,
  );

  const standardFinish = effectiveStart + Math.ceil(activity.workload) - 1;

  const availableWeeks = Math.max(0, activity.due - effectiveStart + 1);

  const minimumECLO = Math.max(0, Math.ceil(2 * (activity.workload - availableWeeks)));

  const scheduledFinish = activityRows.length
    ? Math.max(...activityRows.map((access) => access.week))
    : null;

  return {
    a: activity,
    effective: effectiveStart,
    standardFinish,
    available: availableWeeks,
    minimumECLO,
    ecloCanFit: availableWeeks > 0 && minimumECLO <= availableWeeks,
    finish: scheduledFinish,
    late: scheduledFinish !== null && scheduledFinish > activity.due,
    predFinish: predecessorFinish,
  };
}

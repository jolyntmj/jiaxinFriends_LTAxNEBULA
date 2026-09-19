import { prepare, validate, solve, csv } from './solver.mjs';

// Rebuild all derived schedule fields before using the shared validator/scorer.
export function evaluatePlan(model, original, access, occupancy) {
  const rows = access.map(row => ({ ...row })).sort((a, b) =>
    a.activity_id.localeCompare(b.activity_id) || a.week - b.week);
  const sequence = new Map();
  const finish = new Map();
  for (const row of rows) {
    row.access_seq = (sequence.get(row.activity_id) || 0) + 1;
    sequence.set(row.activity_id, row.access_seq);
    finish.set(row.activity_id, row.week);
  }
  const results = original.results.map(row => {
    const activities = model.acts.filter(a => a.contract_number === row.contract_number);
    const end = Math.max(...activities.map(a => finish.get(a.activity_id) || 0));
    const completion = model.endDate(end);
    const due = Math.min(...activities.map(a => Date.parse(a.p.planned_completion_date)));
    return { ...row, simulated_completion_date: completion,
      overrun_days: Math.max(0, Math.round((Date.parse(completion) - due) / 86400000)) };
  });
  const candidate = { ...original, access: rows, occupancy, results,
    last: Math.max(0, ...rows.map(row => row.week)), decisions: {},
    weekPlans: [], windows: {}, method: 'Validated local recommendation from the original schedule' };
  candidate.report = validate(model, candidate);
  candidate.cost = candidate.report.objective_score;
  return candidate;
}

export function findRecommendation(data, baseline, { maxEvaluations = 3000 } = {}) {
  if (!baseline.report.feasible || baseline.report.objective_score <= 0) return null;
  const model = prepare(data);
  let best = null;
  let evaluated = 0;
  const consider = (access, occupancy, action) => {
    if (evaluated++ >= maxEvaluations) return;
    const candidate = evaluatePlan(model, baseline, access, occupancy);
    const saving = +(baseline.report.objective_score - candidate.report.objective_score).toFixed(3);
    if (candidate.report.feasible && saving > 0.000001 && (!best || saving > best.saving)) {
      best = { action, saving, originalScore: baseline.report.objective_score,
        suggestedScore: candidate.report.objective_score, candidate };
    }
  };
  // Try recovery for late activities first, then resource savings elsewhere.
  const activities = [...model.acts].sort((a, b) => {
    const lateness = item => Math.max(0, ...baseline.access.filter(r => r.activity_id === item.activity_id)
      .map(r => r.week - item.p.due)) * item.weight;
    return lateness(b) - lateness(a);
  });
  for (const activity of activities) {
    const id = activity.activity_id;
    const rows = baseline.access.filter(r => r.activity_id === id).sort((a, b) => a.week - b.week);
    // Two extended accesses replace one standard access. Test the complete plan,
    // including successors and each line's C continuity window.
    if (baseline.scenario !== 'A' && rows.length >= 3) {
      const last = rows.at(-1);
      if (!last.eclo) for (let i = 0; i < rows.length - 1; i++) {
        for (let j = i + 1; j < rows.length - 1; j++) {
          if (rows[i].eclo || rows[j].eclo) continue;
          const access = baseline.access.filter(r => r !== last).map(r =>
            r === rows[i] || r === rows[j] ? { ...r, eclo: 1 } : r);
          const occupancy = baseline.occupancy.filter(r => !(r.activity_id === id && r.week === last.week));
          consider(access, occupancy, `${id}: use ECLO in W${rows[i].week} and W${rows[j].week}; remove the W${last.week} access and finish in W${rows.at(-2).week}.`);
        }
      }
    }
    for (const row of [...rows].reverse()) {
      if (row.eclo) consider(baseline.access.map(r => r === row ? { ...r, eclo: 0 } : r),
        baseline.occupancy, `${id}: use a standard access instead of ECLO in W${row.week}.`);
      for (let week = activity.start; week < row.week; week++) {
        if (rows.some(r => r.week === week)) continue;
        const groups = [...new Set(baseline.occupancy.filter(r => r.week === week).map(r => r.co_share_group))];
        let newGroup = 'recommendation';
        while (groups.includes(newGroup)) newGroup += '_';
        groups.push(newGroup);
        for (const group of groups) for (let night = 1; night <= activity.p.cap; night++) {
          if (evaluated >= maxEvaluations) return best;
          const access = baseline.access.map(r => r === row ? { ...r, week, access_night: night } : r);
          const occupancy = baseline.occupancy.map(r => r.activity_id === id && r.week === row.week
            ? { ...r, week, co_share_group: group } : r);
          consider(access, occupancy, `${id}: shift the W${row.week} access forward to W${week}.`);
        }
      }
    }
  }
  return best;
}

// Input changes are kept separate from moves that satisfy the original instance.
export function findStartDateSuggestion(data, baseline) {
  if (!baseline.report.feasible || baseline.report.objective_score <= 0) return null;
  let best = null;
  const targets = baseline.modelInfo.activities.filter(activity => {
    const rows = baseline.access.filter(row => row.activity_id === activity.id);
    return rows.some(row => row.eclo) || Math.max(...rows.map(row => row.week)) > activity.due;
  }).slice(0, 8);
  for (const activity of targets) {
    for (let weeks = 1; weeks <= Math.min(3, activity.start - 1); weeks++) {
      const revised = structuredClone(data);
      const row = revised['08_ACTIVITY_DETAILS'].find(item => item.activity_id === activity.id);
      const previous = row.planned_start_date;
      row.planned_start_date = new Date(Date.parse(previous) - weeks * 7 * 86400000).toISOString().slice(0, 10);
      const candidate = solve(revised, baseline.scenario);
      const saving = +(baseline.report.objective_score - candidate.report.objective_score).toFixed(3);
      if (!candidate.report.feasible || saving <= 0 || (best && saving <= best.saving)) continue;
      const changed = baseline.modelInfo.activities.filter(a => {
        const signature = result => JSON.stringify(result.access.filter(r => r.activity_id === a.id)
          .map(r => [r.week, r.eclo, r.access_night]));
        return signature(baseline) !== signature(candidate);
      }).map(a => a.id);
      const delayed = baseline.modelInfo.activities.filter(a => {
        const finish = result => Math.max(...result.access.filter(r => r.activity_id === a.id).map(r => r.week));
        return finish(candidate) > finish(baseline);
      }).map(a => a.id);
      candidate.inputRevision = { activityId: activity.id, previous, proposed: row.planned_start_date,
        files: Object.fromEntries(Object.entries(revised).map(([name, rows]) => [name + '.csv', csv(rows)])) };
      best = { saving, originalScore: baseline.report.objective_score, suggestedScore: candidate.report.objective_score,
        action: `${activity.id}: bring the planned start forward ${weeks} week${weeks === 1 ? '' : 's'}, from ${previous} to ${row.planned_start_date}, then reschedule.`,
        changed, delayed, candidate };
    }
  }
  return best;
}

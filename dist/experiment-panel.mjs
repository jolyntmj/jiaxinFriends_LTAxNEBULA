import { $, esc, fmt, table } from './ui.mjs';
import { buildExperiment, compareActivities } from './experiments.mjs';

const policies = { A: 'Protect supply', B: 'Protect deadlines', C: 'Balance both' };
const signed = n => `${n > 0 ? '+' : ''}${fmt(n)}`;

export function createExperimentPanel(api) {
  const panel = $('experiment-lab');
  let dataset = null;
  let experiment = null;
  let job = null;
  let draft = {};

  function controls() {
    return {
      activity: $('experiment-activity').value,
      startWeek: Number($('experiment-start').value),
      location: $('experiment-location').value,
      from: Number($('experiment-from').value),
      to: Number($('experiment-to').value),
      capacity: Number($('experiment-capacity').value),
    };
  }

  panel.addEventListener('change', event => {
    draft = controls();
    if (event.target.tagName === 'INPUT') return;
    const state = api.state();
    if (event.target.id === 'experiment-activity' && draft.activity) {
      draft.startWeek = state.originals.A.modelInfo.activities.find(a => a.id === draft.activity).start;
    }
    if (event.target.id === 'experiment-location' && draft.location) {
      draft.capacity = Number(state.data['04_LOCATION_SUPPLY'].find(row => row.location_id === draft.location).supply_capacity);
    }
    render();
  });
  panel.addEventListener('submit', event => { event.preventDefault(); run(controls()); });
  panel.addEventListener('click', event => {
    const button = event.target.closest('[data-experiment-action]');
    if (!button || api.state().busy) return;
    const action = button.dataset.experimentAction;
    if (action === 'baseline') api.show(api.state().originals);
    if (action === 'experiment' && experiment) api.show(experiment.results);
    if (action === 'reset') { experiment = null; draft = {}; api.show(api.state().originals); }
    if (action === 'suggestion') {
      const state = api.state();
      const suggestion = state.suggestions[state.scenario];
      if (!suggestion) return;
      if (!suggestion.candidate.inputRevision?.activityId) {
        experiment = { results: { ...state.originals, [state.scenario]: suggestion.candidate }, description: suggestion.action };
        api.show(experiment.results);
        api.message(`Suggestion applied to scenario ${state.scenario}. Other policies retain their baselines.`);
        return;
      }
      const activity = suggestion.candidate.modelInfo.activities.find(a => a.id === suggestion.candidate.inputRevision.activityId);
      draft = { activity: activity.id, startWeek: activity.start };
      run(draft);
    }
  });

  function run(change) {
    const state = api.state();
    if (state.busy || !state.originals.A || !state.originals.B || !state.originals.C) return;
    try { buildExperiment(state.data, change); }
    catch (error) { api.message(error.message, true); return; }
    draft = change;
    api.busy(true);
    render();
    api.message('Testing the change across all three policies…');
    job = new Worker('experiment-worker.mjs', { type: 'module' });
    const finish = () => { job?.terminate(); job = null; api.busy(false); };
    job.onmessage = ({ data: response }) => {
      if (response.type === 'progress') api.message(`Checking scenario ${response.scenario} against the experiment…`);
      if (response.type === 'error') { finish(); render(); api.message(response.message, true); }
      if (response.type === 'done') {
        finish();
        experiment = response.experiment;
        api.show(experiment.results);
        api.message('Comparison ready. Your original baseline is preserved; the workspace now shows the experiment.');
      }
    };
    job.onerror = error => { finish(); render(); api.message(`Experiment failed: ${error.message}`, true); };
    job.postMessage({ data: state.data, change });
  }

  function render() {
    const state = api.state();
    if (dataset !== state.data) { dataset = state.data; experiment = null; draft = {}; }
    const ready = ['A', 'B', 'C'].every(s => state.originals[s]);
    if (!ready) {
      panel.innerHTML = '<div class="lab-heading"><div><p class="eyebrow">PLAN COMPARISON</p><h2>See what changes before changing the plan.</h2><p class="muted">Generate a baseline to test a disruption or an earlier activity start.</p></div></div>';
      return;
    }
    const baseline = state.originals[state.scenario];
    const active = experiment && state.results[state.scenario] === experiment.results[state.scenario];
    const activities = state.originals.A.modelInfo.activities;
    const horizon = baseline.modelInfo.horizon;
    const disabled = state.busy ? 'disabled' : '';
    const options = (items, selected) => items.map(([value, label]) => `<option value="${esc(value)}" ${selected === value ? 'selected' : ''}>${esc(label)}</option>`).join('');
    const suggestion = state.suggestions[state.scenario];
    const revision = suggestion?.candidate.inputRevision;
    panel.innerHTML = `<div class="lab-heading"><div><p class="eyebrow">PLAN COMPARISON</p><h2>Test changes. Compare outcomes.</h2><p class="muted">Use a suggested change or define your own here. Your original plan stays available.</p></div><span class="badge ${active ? 'experiment-badge' : ''}">${active ? 'Viewing experiment' : 'Viewing baseline'}</span></div>
      ${experiment ? `<div class="plan-switcher"><div class="actions" role="group" aria-label="Plan shown in results"><button data-experiment-action="baseline" aria-pressed="${!active}" ${disabled}>Original baseline</button><button data-experiment-action="experiment" aria-pressed="${Boolean(active)}" ${disabled}>Experiment</button><button data-experiment-action="reset" ${disabled}>Reset experiment</button></div><a href="#results-tabs">Explore this plan’s results ↓</a></div>` : ''}
      ${suggestion && !experiment ? `<div class="suggestion-callout"><div><b>Suggested change${revision?.activityId ? ' · ' + esc(revision.activityId) : ''}</b><p>${esc(suggestion.action)} Scenario ${state.scenario}: ${fmt(suggestion.originalScore)} → ${fmt(suggestion.suggestedScore)} penalty.</p></div><button data-experiment-action="suggestion" ${disabled}>Compare this change →</button></div>` : ''}
      <form id="experiment-form"><fieldset ${disabled}><legend>Define the change</legend><div class="experiment-fields">
      <label>Activity start<select id="experiment-activity"><option value="">Keep activity starts</option>${options(activities.map(a => [a.id, `${a.id} · ${a.contract} · current W${a.start}`]), draft.activity)}</select></label>
      <label>New earliest week<input id="experiment-start" type="number" min="1" max="${horizon}" step="1" value="${draft.startWeek || 1}" ${!draft.activity ? 'disabled' : ''}></label>
      <label>Location capacity<select id="experiment-location"><option value="">Keep location capacity</option>${options(state.data['04_LOCATION_SUPPLY'].map(row => [row.location_id, row.location_id]), draft.location)}</select></label>
      <label>From week<input id="experiment-from" type="number" min="1" max="${horizon}" step="1" value="${draft.from || 1}" ${!draft.location ? 'disabled' : ''}></label>
      <label>To week<input id="experiment-to" type="number" min="1" max="${horizon}" step="1" value="${draft.to || 2}" ${!draft.location ? 'disabled' : ''}></label>
      <label>Weekly slots<input id="experiment-capacity" type="number" min="0" step="1" value="${draft.capacity ?? 0}" ${!draft.location ? 'disabled' : ''}></label>
      </div><div class="experiment-submit"><button class="primary" type="submit" ${disabled}>${state.busy ? 'Calculating…' : 'Run comparison →'}</button></div></fieldset></form>
      <div id="experiment-comparison" aria-live="polite">${experiment ? comparison(state, active, disabled) : ''}</div>`;
  }

  function comparison(state, active, disabled) {
    const current = experiment.results[state.scenario];
    const baseline = state.originals[state.scenario];
    const changes = compareActivities(baseline, current);
    const earlier = changes.filter(row => row.shift < 0).length;
    const later = changes.filter(row => row.shift > 0).length;
    const scoreChange = current.report.objective_score - baseline.report.objective_score;
    const summary = current.report.feasible
      ? `Scenario ${state.scenario}: ${Math.abs(scoreChange) < 0.001 ? 'penalty unchanged' : `${fmt(Math.abs(scoreChange))} points ${scoreChange < 0 ? 'lower' : 'higher'}`}. ${earlier} activities finish earlier; ${later} finish later.`
      : `Scenario ${state.scenario} fails ${current.report.hard_violations.length} checks. Its score is not a feasible result.`;
    const breakdown = (report, scenario) => `${scenario === 'B' ? '0 (not scored)' : fmt(report.priority_weighted_score)} delay + ${scenario === 'A' ? 0 : 7 * report.excess_access_nights_total} extra access + ${scenario === 'A' ? 0 : 5 * report.eclo_nights_total} extended hours`;
    return `<div class="comparison-heading"><div><p class="eyebrow">COMPARISON READY</p><h3>${esc(experiment.description)}</h3></div></div>
      ${table(['Policy', 'Original penalty', 'Experiment penalty', 'Change', 'Experiment checks'], ['A', 'B', 'C'].map(s => {
        const before = state.originals[s].report;
        const after = experiment.results[s].report;
        return [`<b>${s} · ${policies[s]}</b>`, fmt(before.objective_score), after.feasible ? fmt(after.objective_score) : 'Not feasible',
          before.feasible && after.feasible ? signed(after.objective_score - before.objective_score) : '—',
          `${after.feasible ? 'Passed' : `${after.hard_violations.length} violations`} · ${after.complete}/${after.total} activities`];
      }))}
      <p class="muted">Compare each policy with its own baseline. A scores delay; B scores additional resources; C scores both.</p>
      <div class="impact-summary"><h3>${esc(summary)}</h3><p>Original: ${breakdown(baseline.report, state.scenario)} = <b>${fmt(baseline.report.objective_score)}</b></p><p>Experiment: ${breakdown(current.report, state.scenario)} = <b>${fmt(current.report.objective_score)}</b></p>
      <p>Contract-delay days: ${baseline.report.overrun_days_total} → ${current.report.overrun_days_total}. Extra slots: ${baseline.report.excess_access_nights_total} → ${current.report.excess_access_nights_total}. Extended accesses: ${baseline.report.eclo_nights_total} → ${current.report.eclo_nights_total}.</p></div>
      <details><summary>See affected activities · ${changes.length} changed</summary>${table(['Activity', 'Contract', 'Original finish', 'Experiment finish', 'Impact', 'Extended accesses'], changes.map(row => [esc(row.id), esc(row.contract), row.before ? 'W' + row.before : 'Unscheduled', row.after ? 'W' + row.after : 'Unscheduled', row.shift === null ? 'Incomplete' : row.shift === 0 ? 'Access pattern changed' : `${Math.abs(row.shift)} weeks ${row.shift < 0 ? 'earlier' : 'later'}`, `${row.ecloBefore} → ${row.ecloAfter}`]))}</details>
      ${current.report.feasible ? '' : `<details open><summary>Checks to resolve</summary>${current.report.hard_violations.map(v => `<p>${esc(v.rule)}: ${esc(v.detail)}</p>`).join('')}</details>`}
      <p class="muted">${active ? 'The timeline and downloads now show the experiment, including its changed assumptions.' : 'The original / selected plan is shown below.'} The original baseline is preserved. Checks are local; the official validator has not been run.</p>`;
  }
  return { render, run, reset() { experiment = null; draft = {}; } };
}

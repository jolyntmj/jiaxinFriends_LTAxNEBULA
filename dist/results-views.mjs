import { $, esc, fmt, table } from './ui.mjs';
import { activityStatus, weekDate, shortDate, locationName, capacityAt, capacityRows } from './result-data.mjs';

const tag = (text, tone = '') => `<span class="result-tag ${tone}">${esc(text)}</span>`;
const cards = items => `<div class="result-summary">${items.map(([value, label]) => `<div><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join('')}</div>`;
const guide = (title, text) => `<div class="view-guide"><b>${esc(title)}</b><p>${esc(text)}</p></div>`;
const activityButton = id => `<button class="table-button" data-inspect="${esc(id)}">${esc(id)} ↗</button>`;
let attentionOnly = false;
let capacityMode = 'pressure';
let networkWeek = 1;
let networkStation = '';

export function renderTimeline(result, ctx) {
  const all = ctx.activities.map(a => ({ a, ...activityStatus(result, a, ctx.data) }));
  const late = all.filter(row => row.lateDays > 0);
  const incomplete = all.filter(row => !row.complete);
  const rows = all.filter(row => !attentionOnly || row.lateDays || !row.complete)
    .sort((a, b) => Number(a.complete) - Number(b.complete) || b.lateDays - a.lateDays || a.a.id.localeCompare(b.a.id));
  const weeks = Math.max(result.modelInfo.horizon, result.last);
  $('view').innerHTML = guide('Read the plan from left to right', 'Each row is an activity and each column is a calendar week. A numbered cell is one scheduled access: 1 unit for a standard night or 1.5 for extended hours. Empty cells mean no access. Select any activity or access for its full details.') +
    cards([[rows.length, 'activities shown'], [late.length, 'finish after target'], [incomplete.length, 'workloads incomplete'], [rows.reduce((n, row) => n + row.extended, 0), 'extended accesses shown']]) +
    `<div class="view-controls"><label><input id="attention-only" type="checkbox" ${attentionOnly ? 'checked' : ''}> Only late or incomplete activities</label><button id="jump-late" ${!late.length ? 'disabled' : ''}>Jump to first late week →</button><span>Late / incomplete work is listed first. All weeks remain available.</span></div>
    <div class="legend"><span><i></i>Alpha</span><span><i class="blue"></i>Beta</span><span><b class="extended-key">1.5</b> Extended hours (ECLO)</span><span><i class="red"></i>Red outline = after target</span><span>Dashed column edge = activity target week</span></div>
    <div class="scroll timeline-scroll" tabindex="0" aria-label="Scrollable weekly activity schedule"><table class="timeline readable-timeline"><thead><tr><th>Activity / delivery status</th>${Array.from({ length: weeks }, (_, i) => `<th data-week="${i + 1}">W${i + 1}<small>${shortDate(weekDate(result, i + 1))}</small></th>`).join('')}</tr></thead><tbody>${rows.map(row => {
      const byWeek = new Map(row.rows.map(access => [access.week, access]));
      return `<tr><td>${activityButton(row.a.id)} <span class="contract-ref">${esc(row.a.contract)}</span><small>${esc(row.a.line)} · ${esc(row.a.bound)} · priority ${row.a.priority}</small>${tag(!row.complete ? 'Incomplete' : row.lateDays ? `${row.lateDays} days late` : 'On time', !row.complete || row.lateDays ? 'warn' : 'good')}<small>Finish ${row.finish ? 'W' + row.finish : '—'} · target W${row.a.due}<br>${fmt(row.units)} / ${fmt(row.a.workload)} units</small></td>${Array.from({ length: weeks }, (_, i) => {
        const week = i + 1;
        const access = byWeek.get(week);
        const target = week === row.a.due ? ' class="target-week" title="Target completion week"' : '';
        if (!access) return `<td${target}></td>`;
        const label = `${row.a.id}, week ${week}, ${weekDate(result, week)}, ${access.eclo ? 'extended access: 1.5 units' : 'standard access: 1 unit'}${week > row.a.due ? ', after target' : ''}`;
        return `<td${target}><button data-inspect="${esc(row.a.id)}" ${week > row.a.due ? `data-late-week="${week}"` : ''} aria-label="${esc(label)}" title="${esc(label)}"><span class="cell ${row.a.line.toLowerCase()} ${access.eclo ? 'extended' : ''} ${week > row.a.due ? 'late' : ''}">${access.eclo ? '1.5' : '1'}</span></button></td>`;
      }).join('')}</tr>`;
    }).join('')}</tbody></table></div>${!rows.length ? '<p class="view-empty">No activities match these filters.</p>' : ''}<p class="view-footnote">Week 1 starts ${esc(result.modelInfo.start)}. Scroll horizontally to explore the full schedule. A blank week is not necessarily spare capacity: safety, start dates and dependencies may restrict placement.</p>`;
  $('attention-only').onchange = event => { attentionOnly = event.target.checked; ctx.redraw(); };
  $('jump-late').onclick = () => {
    const viewport = $('view').querySelector('.timeline-scroll');
    const access = [...viewport.querySelectorAll('[data-late-week]')]
      .sort((a, b) => Number(a.dataset.lateWeek) - Number(b.dataset.lateWeek))[0];
    if (!access) return;
    viewport.querySelectorAll('.jump-target').forEach(node => node.classList.remove('jump-target'));
    access.classList.add('jump-target');
    // Use the scroll container's coordinates, including both sticky headers.
    // offsetLeft belongs to the table's layout context, not the viewport.
    const bounds = viewport.getBoundingClientRect();
    const cell = access.getBoundingClientRect();
    const frozenWidth = viewport.querySelector('th').getBoundingClientRect().width;
    const headerHeight = viewport.querySelector('thead').getBoundingClientRect().height;
    viewport.scrollTo({
      left: viewport.scrollLeft + cell.left - bounds.left - frozenWidth - 24,
      top: viewport.scrollTop + cell.top - bounds.top - headerHeight - 24,
      behavior: 'instant',
    });
    viewport.scrollIntoView({ block: 'center', behavior: 'instant' });
    access.focus({ preventScroll: true });
    let status = $('timeline-jump-status');
    if (!status) {
      status = document.createElement('p');
      status.id = 'timeline-jump-status';
      status.className = 'view-footnote';
      status.setAttribute('role', 'status');
      viewport.after(status);
    }
    status.textContent = `Showing the first late access: ${access.dataset.inspect}, week ${access.dataset.lateWeek}. The highlighted cell is after this activity’s target.`;
  };
}

export function renderContracts(result, ctx) {
  const contracts = new Set(ctx.activities.map(a => a.contract));
  const rows = result.results.filter(row => contracts.has(row.contract_number)).sort((a, b) => b.overrun_days - a.overrun_days || a.contract_number.localeCompare(b.contract_number));
  const statuses = new Map(result.modelInfo.activities.map(a => [a.id, activityStatus(result, a, ctx.data)]));
  const completeContract = row => result.modelInfo.activities.filter(a => a.contract === row.contract_number).every(a => statuses.get(a.id).complete);
  $('view').innerHTML = guide('Which contracts need a delivery decision?', 'Contracts with delay appear first. The last activity to finish determines contract completion. Expand a contract to see the activities driving its finish, their individual targets, and their delay penalties. Contract dates below include all its activities, even when a line filter is selected.') +
    cards([[rows.filter(r => completeContract(r) && !r.overrun_days).length, 'contracts on time'], [rows.filter(r => completeContract(r) && r.overrun_days).length, 'contracts late'], [rows.filter(r => !completeContract(r)).length, 'contracts incomplete'], [rows.reduce((n, r) => n + r.overrun_days, 0), 'total contract-delay days']]) +
    `<div class="contract-list">${rows.map(row => {
      const activities = result.modelInfo.activities.filter(a => a.contract === row.contract_number);
      const projectRows = ctx.data['07_PROJECT_DETAILS'].filter(p => p.contract_number === row.contract_number);
      const target = projectRows.map(p => p.planned_completion_date).sort()[0];
      const complete = completeContract(row);
      const finish = Math.max(0, ...activities.map(a => statuses.get(a.id).finish || 0));
      const drivers = activities.filter(a => statuses.get(a.id).finish === finish).map(a => a.id);
      const weighted = activities.reduce((sum, a) => sum + statuses.get(a.id).delayPenalty, 0);
      return `<details class="contract-card" ${row.overrun_days ? 'open' : ''}><summary><span><b>${esc(row.contract_number)}</b> · priority ${esc(projectRows[0].contract_priority)} · ${activities.length} activities</span>${tag(!complete ? 'Incomplete' : row.overrun_days ? `${row.overrun_days} days late` : 'On time', !complete || row.overrun_days ? 'warn' : 'good')}<span class="contract-dates">Target ${shortDate(target)} → ${complete ? 'finish' : 'latest access'} ${shortDate(row.simulated_completion_date)}</span></summary><div class="contract-body"><p><b>${complete ? 'Completion driven by' : 'Latest scheduled work'}:</b> ${drivers.map(activityButton).join(' ')} · W${finish}. ${result.scenario === 'B' ? 'B requires every target to be met; delay is a failed check, not a score trade-off.' : `The contract contributes ${fmt(weighted)} weighted delay points across all its activities.`}</p>
        ${table(['Activity', 'Target date', 'Finish / workload', 'Delivery', 'Delay points'], activities.map(a => {
          const status = statuses.get(a.id);
          return [activityButton(a.id), esc(status.dueDate), `${status.finish ? 'W' + status.finish : 'Unscheduled'} · ${fmt(status.units)}/${fmt(a.workload)} units`, status.complete ? status.lateDays ? `${status.lateDays} days late` : 'On time' : 'Incomplete', result.scenario === 'B' ? 'Not scored in B' : fmt(status.delayPenalty)];
        }))}<p class="muted">Target: ${esc(target)} · Scheduled completion: ${esc(row.simulated_completion_date)}. Priority 1 has the highest delay weight. Activity delay points and contract-delay days measure different things.</p></div></details>`;
    }).join('') || '<p class="view-empty">No contracts match these filters.</p>'}</div>`;
}

const RULES = {
  workload: ['Full workload delivered', 'Every activity receives enough work units; nothing is dropped.'],
  planned_start: ['Start dates respected', 'Work starts no earlier than its permitted week.'],
  predecessor: ['Dependencies in order', 'A successor starts in a week after its predecessor finishes.'],
  closure: ['Safety separation', 'Work respects exclusion buffers, opposite-bound closures and live interchange closures.'],
  mix: ['Compatible sharing', 'Each location uses a legal combination of possession types.'],
  allocation: ['Weekly contractor allowance', 'Contractor night indices stay within the weekly allowance.'],
  workfront: ['Team limits', 'Concurrent activities do not exceed the available workfronts.'],
  capacity: ['Scenario capacity allowance', 'Used slots remain within the capacity allowed by this policy.'],
  eclo: ['Extended-hours policy', 'ECLO flags are valid, and no ECLO is used in A.'],
  eclo_window: ['Continuous extended-hours window', 'In C, each line’s extended accesses fit within two consecutive weeks.'],
  frequency: ['One access per activity per week', 'An activity does not receive multiple accesses in the same week.'],
  occupancy: ['Complete route recorded', 'Every access records all of its occupied platform and tunnel locations.'],
  possession: ['Consistent possession group', 'An access uses one dispatch group throughout its route.'],
  planned_date: ['Deadline gate', 'Scenario B requires every activity to finish by its target.'],
  results: ['Completion dates agree', 'Reported contract completion matches the scheduled final access.'],
  activity: ['Known activity IDs', 'Every scheduled access belongs to an activity in the dataset.'],
};

export function renderCapacity(result, ctx) {
  const report = result.report;
  const allowed = new Set(ctx.activities.map(a => a.id));
  const allRows = capacityRows(ctx.data, result).filter(row => [...row.activities].some(id => allowed.has(id)) && (!ctx.line || row.location.split(':')[1] === ctx.line));
  const pressure = allRows.filter(row => row.used >= row.capacity);
  const rows = capacityMode === 'all' ? allRows : pressure;
  const weighted = result.scenario === 'B' ? 0 : report.priority_weighted_score;
  const extra = result.scenario === 'A' ? 0 : report.excess_access_nights_total * 7;
  const extended = result.scenario === 'A' ? 0 : report.eclo_nights_total * 5;
  const policy = { A: 'A permits no extra slots or extended hours. Full capacity is allowed; exceeding it is a violation.', B: 'B can purchase extra slots and extended hours, but every deadline must be met.', C: 'C permits at most one extra slot per location-week and a two-week extended-hours window per line.' }[result.scenario];
  const rules = [...new Set([...Object.keys(RULES), ...report.hard_violations.map(v => v.rule)])].sort((a, b) => Number(report.hard_violations.some(v => v.rule === b)) - Number(report.hard_violations.some(v => v.rule === a)));
  $('view').innerHTML = guide(report.feasible ? 'The plan passes the implemented checks' : 'Resolve these violations before using this plan', `${report.hard_violations.length} hard violations across the full plan. ${policy} These are app checks, not official validator results.`) +
    `<div class="score-equation"><div><strong>${fmt(weighted)}</strong><span>weighted delay${result.scenario === 'B' ? ' · not scored in B' : ''}</span></div><b>+</b><div><strong>${fmt(extra)}</strong><span>${report.excess_access_nights_total} extra slots × ${result.scenario === 'A' ? '0 (forbidden)' : '7'}</span></div><b>+</b><div><strong>${fmt(extended)}</strong><span>${report.eclo_nights_total} extended accesses × ${result.scenario === 'A' ? '0 (forbidden)' : '5'}</span></div><b>=</b><div><strong>${fmt(report.objective_score)}</strong><span>${report.feasible ? 'penalty · lower is better' : 'score of an invalid candidate'}</span></div></div>
    <h3 class="section-title">Where is access tight?</h3>${cards([[pressure.filter(r => !r.excess).length, 'location-weeks at nominal capacity'], [allRows.filter(r => r.excess).length, 'location-weeks above nominal capacity'], [allRows.reduce((n, r) => n + r.excess, 0), 'extra slots in filtered view']])}
    <div class="view-controls"><label>Show <select id="capacity-mode"><option value="pressure" ${capacityMode === 'pressure' ? 'selected' : ''}>At or above capacity</option><option value="all" ${capacityMode === 'all' ? 'selected' : ''}>All used locations</option></select></label><span>Each row is one location in one week. A shared possession group uses one slot, even with several activities.</span></div>
    ${table(['Week', 'Location', 'Used / available slots', 'Extra slots', 'Meaning', 'Activities'], rows.map(row => {
      const violation = result.scenario === 'A' ? row.excess > 0 : result.scenario === 'C' && row.excess > 1;
      const hotspot = report.hotspots.findIndex(h => h.week === row.week && h.location === row.location);
      const label = `${esc(locationName(row.location))}<small class="raw-location">${esc(row.location)}</small>`;
      return [`W${row.week}<small class="raw-location">${shortDate(weekDate(result, row.week))}</small>`, hotspot >= 0 ? `<button class="table-button" data-hotspot="${hotspot}">${label} ↗</button>` : label,
        `<b>${row.used} / ${row.capacity}</b><span class="capacity-meter"><i style="width:${Math.min(100, row.capacity ? row.used / row.capacity * 100 : 100)}%"></i></span>`, row.excess,
        tag(violation ? 'Over policy limit' : row.excess ? 'Allowed extra access' : row.used === row.capacity ? 'Full · allowed' : 'Space remaining', violation ? 'warn' : row.excess ? 'extra' : 'good'),
        [...row.activities].map(activityButton).join(' ')];
    }))}${!rows.length ? '<p class="view-empty">No used locations match this capacity filter.</p>' : ''}
    <h3 class="section-title">Checks explained <small>Full plan · not limited by filters</small></h3><div class="explained-checks">${rules.map(rule => {
      const violations = report.hard_violations.filter(v => v.rule === rule);
      const [title, description] = RULES[rule] || [rule, 'Additional validation rule.'];
      const applicable = !(rule === 'planned_date' && result.scenario !== 'B' || rule === 'eclo_window' && result.scenario !== 'C');
      return `<details class="explained-check ${violations.length ? 'failed' : ''}" ${violations.length ? 'open' : ''}><summary>${tag(violations.length ? `${violations.length} failed` : applicable ? 'Passed' : 'Not applicable', violations.length ? 'warn' : 'good')} ${esc(title)}</summary><p>${esc(description)}</p>${violations.map(v => `<p class="violation-detail">${esc(v.detail)}</p>`).join('')}<small>Rule: ${esc(rule)}</small></details>`;
    }).join('')}</div>`;
  $('capacity-mode').onchange = event => { capacityMode = event.target.value; ctx.redraw(); };
}

export function renderNetwork(result, ctx) {
  if (ctx.line && networkStation && !networkStation.startsWith(ctx.line + ':')) networkStation = '';
  networkWeek = Math.min(networkWeek, Math.max(result.last, result.modelInfo.horizon));
  const allowed = new Set(ctx.activities.map(a => a.id));
  const scheduled = result.access.filter(row => row.week === networkWeek && allowed.has(row.activity_id));
  const activities = scheduled.map(row => result.modelInfo.activities.find(a => a.id === row.activity_id));
  const counts = location => ({ work: activities.filter(a => a.core.includes(location)), safety: activities.filter(a => a.footprint.includes(location) && !a.core.includes(location)) });
  const matchingLines = ctx.data['01_LINES'].filter(line => !ctx.line || ctx.line === line.line_code);
  $('view').innerHTML = guide('Where is work taking place this week?', 'Follow each coloured line through its stations. Numbers show activities occupying the platforms in the selected week; “closure” counts other activities whose safety footprint reaches them. Select a station to inspect both platform directions below. The location table also includes tunnel sectors.') +
    `<div class="view-controls"><label>Week <select id="network-week">${Array.from({ length: Math.max(result.last, result.modelInfo.horizon) }, (_, i) => `<option value="${i + 1}" ${networkWeek === i + 1 ? 'selected' : ''}>W${i + 1} · ${shortDate(weekDate(result, i + 1))}</option>`).join('')}</select></label><button id="network-clear">Show all locations</button><span>${scheduled.length} activities scheduled in this filtered view</span></div>
    <div class="network-map">${matchingLines.map(line => {
      const stations = ctx.data['02_STATIONS'].filter(s => s.line_code === line.line_code).sort((a, b) => +a.seq - +b.seq);
      return `<section class="network-route ${line.line_code === 'ALP' ? 'alpha-route' : 'beta-route'}"><h3>${esc(line.line_name)} <small>${esc(line.line_code)} · separate eastbound and westbound tracks</small></h3><div class="station-track">${stations.map(station => {
        const east = counts(`PLAT:${line.line_code}:${station.station_id}:EB`);
        const west = counts(`PLAT:${line.line_code}:${station.station_id}:WB`);
        const closure = east.safety.length + west.safety.length;
        const selected = networkStation === `${line.line_code}:${station.station_id}`;
        return `<button class="station-node ${selected ? 'selected' : ''}" data-station="${esc(line.line_code + ':' + station.station_id)}" aria-pressed="${selected}"><span class="station-dot ${station.is_interchange === '1' ? 'interchange' : ''}"></span><b>${esc(station.station_id)}</b><small>East ${east.work.length} · West ${west.work.length}</small><small>${closure ? `${closure} closure footprints` : 'No external closure'}</small>${station.is_interchange === '1' ? '<span class="hub-label">Interchange</span>' : ''}</button>`;
      }).join('')}</div></section>`;
    }).join('')}</div><div class="network-reading"><div><b>Platforms and tunnels</b><p>PLAT is a station platform; SEC is the tunnel between stations. EB means eastbound, WB westbound. Each has its own access supply.</p></div><div><b>Shared hubs, separate capacity</b><p>H01 and H02 occur on both lines. Ordinary work stays on its own line. Live work mirrors closures to the opposite direction and can close both lines at the interchange.</p></div><div><b>Work versus safety footprint</b><p>Work occupies the core route. Safety closures can extend beyond it. Closure counts are not extra capacity usage; different possession nights can separate work safely.</p></div></div>
    <h3 class="section-title">${networkStation ? esc(networkStation.replace(':', ' · ')) + ' platforms' : 'Platforms and tunnels'} · Week ${networkWeek}</h3>
    ${table(['Location', 'Work here', 'Safety closure from elsewhere', 'Used / nominal slots'], ctx.data['04_LOCATION_SUPPLY'].filter(row => (!ctx.line || row.location_id.split(':')[1] === ctx.line) && (!networkStation || row.location_id.startsWith('PLAT:' + networkStation + ':'))).map(row => {
      const { work, safety } = counts(row.location_id);
      const groups = new Set(result.occupancy.filter(o => o.week === networkWeek && o.location_id === row.location_id).map(o => o.co_share_group));
      return [`${esc(locationName(row.location_id))}<small class="raw-location">${esc(row.location_id)}</small>`, work.length ? work.map(a => activityButton(a.id)).join(' ') : 'No matching work', safety.length ? safety.map(a => activityButton(a.id)).join(' ') : 'No matching closure', `${groups.size} / ${capacityAt(ctx.data, result, row.location_id, networkWeek)}`];
    }))}`;
  $('network-week').onchange = event => { networkWeek = Number(event.target.value); ctx.redraw(); };
  $('network-clear').onclick = () => { networkStation = ''; ctx.redraw(); };
  $('view').querySelectorAll('[data-station]').forEach(button => { button.onclick = () => { networkStation = button.dataset.station; ctx.redraw(); }; });
}


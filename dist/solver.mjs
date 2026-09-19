// TrackPlan: deterministic multi-start serial schedule generation, no external dependencies.
import { csv } from "./csv.mjs";
import {
  accessUnits,
  DAYS_PER_WEEK,
  ECLO_PENALTY,
  EXTENDED_ACCESS_UNITS,
  EXTRA_ACCESS_PENALTY,
  MILLISECONDS_PER_DAY,
  STANDARD_ACCESS_UNITS,
} from "./rules.mjs";
export { parseCSV, csv } from "./csv.mjs";
export const FILES = [
  "01_LINES",
  "02_STATIONS",
  "03_SECTORS",
  "04_LOCATION_SUPPLY",
  "05_BUFFER_LOCATION",
  "06_PARAMETERS",
  "07_PROJECT_DETAILS",
  "08_ACTIVITY_DETAILS",
];
const date = (x) => {
  const n = Date.parse(x + "T00:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(x) ||
    !Number.isFinite(n) ||
    new Date(n).toISOString().slice(0, 10) !== x
  )
    throw Error("Invalid date: " + x);
  return n;
};
const intersection = (a, b) => a.some((x) => b.includes(x));

function buildRoutes(data) {
  const routes = {};
  for (const line of data["01_LINES"]) {
    const stations = data["02_STATIONS"]
      .filter((station) => station.line_code === line.line_code)
      .sort((first, second) => +first.seq - +second.seq);
    const sectors = data["03_SECTORS"].filter((sector) => sector.line_code === line.line_code);
    const path = [];

    for (let index = 0; index < stations.length; index++) {
      path.push(`PLAT:${line.line_code}:${stations[index].station_id}`);
      if (index === stations.length - 1) continue;

      const sector = sectors.find(
        (candidate) =>
          candidate.from_station_id === stations[index].station_id &&
          candidate.to_station_id === stations[index + 1].station_id,
      );
      if (!sector) throw Error(`Disconnected route ${line.line_code}`);
      path.push(sector.sector_id);
    }
    routes[line.line_code] = path;
  }
  return routes;
}

function indexAndValidateActivities(activities) {
  const activitiesById = new Map(activities.map((activity) => [activity.activity_id, activity]));
  if (activitiesById.size !== activities.length) throw Error("Duplicate activity ID");

  const visited = new Set();
  const active = new Set();
  function visit(activity) {
    if (active.has(activity.activity_id))
      throw Error(`Predecessor cycle at ${activity.activity_id}`);
    if (visited.has(activity.activity_id)) return;
    active.add(activity.activity_id);
    if (activity.predecessor_activity_id) {
      const predecessor = activitiesById.get(activity.predecessor_activity_id);
      if (!predecessor) throw Error(`Missing predecessor ${activity.predecessor_activity_id}`);
      visit(predecessor);
    }
    active.delete(activity.activity_id);
    visited.add(activity.activity_id);
  }
  activities.forEach(visit);
  return activitiesById;
}

/**
 * Validate and clone a planning instance, then build its routes and activity model.
 * @param {Record<string, Array<Record<string, string>>>} data Eight parsed input tables.
 * @param {{capacityOverrides?: Array<{location: string, from: number, to: number, capacity: number}>}} [options]
 * @returns {object} Prepared model used by solve and validate.
 * @throws {Error} For missing, inconsistent, or invalid planning data.
 */
export function prepare(data, options = {}) {
  data = structuredClone(data);
  for (const f of FILES) if (!data[f]?.length) throw Error("Missing or empty " + f + ".csv");
  const params = Object.fromEntries(data["06_PARAMETERS"].map((r) => [r.key, r.value]));
  const start = date(params.horizon_start),
    horizon = +params.horizon_weeks;
  if (!Number.isInteger(horizon) || horizon < 1) throw Error("Invalid planning horizon");
  const week = (x) => Math.floor((date(x) - start) / (DAYS_PER_WEEK * MILLISECONDS_PER_DAY)) + 1;
  const supplies = new Map();
  for (const r of data["04_LOCATION_SUPPLY"]) {
    if (
      supplies.has(r.location_id) ||
      !Number.isInteger(+r.supply_capacity) ||
      +r.supply_capacity < 0
    )
      throw Error("Invalid/duplicate location capacity: " + r.location_id);
    supplies.set(r.location_id, +r.supply_capacity);
  }
  const routes = buildRoutes(data);
  const projects = new Map();
  for (const p of data["07_PROJECT_DETAILS"]) {
    const key = p.contract_number + "|" + p.activity_type;
    if (projects.has(key)) throw Error("Duplicate contract/type");
    if (!["PM", "PC", "C"].includes(p.access_type)) throw Error("Unknown possession type");
    if (
      ![1, 2, 3].includes(+p.contract_priority) ||
      ![+p.number_of_workfronts, +p.number_of_maximum_access_per_week].every(
        (n) => Number.isInteger(n) && n > 0,
      )
    )
      throw Error("Invalid project limits");
    projects.set(key, {
      ...p,
      key,
      cap: +p.number_of_maximum_access_per_week,
      fronts: +p.number_of_workfronts,
      priority: +p.contract_priority,
      due:
        Math.floor(
          (date(p.planned_completion_date) - start - (DAYS_PER_WEEK - 1) * MILLISECONDS_PER_DAY) /
            (DAYS_PER_WEEK * MILLISECONDS_PER_DAY),
        ) + 1,
    });
  }
  const acts = data["08_ACTIVITY_DETAILS"].map((r) => {
    const p = projects.get(r.contract_number + "|" + r.activity_type);
    if (!p) throw Error("Unknown contract/type for " + r.activity_id);
    const parts = r.start_location_id.split(":"),
      end = r.end_location_id.split(":"),
      line = parts[1],
      bound = parts.at(-1);
    if (end[1] !== line || end.at(-1) !== bound || !["EB", "WB"].includes(bound))
      throw Error("Activity must remain on one line and bound: " + r.activity_id);
    const path = routes[line];
    if (!path) throw Error("Unknown line " + line);
    let lo = path.indexOf(parts.slice(0, -1).join(":")),
      hi = path.indexOf(end.slice(0, -1).join(":"));
    if (lo < 0 || hi < 0) throw Error("Unknown endpoint " + r.activity_id);
    [lo, hi] = [Math.min(lo, hi), Math.max(lo, hi)];
    if (lo % 2 === 1) lo--;
    if (hi % 2 === 1) hi++;
    const core = path.slice(lo, hi + 1).map((x) => x + ":" + bound);
    const rule = data["05_BUFFER_LOCATION"].find(
      (b) => b.nature_of_works.toLowerCase() === p.nature_of_activity.toLowerCase(),
    );
    if (!rule) throw Error("Missing buffer rule " + p.nature_of_activity);
    const buffer = +rule.up_to_buffer_sectors;
    if (!Number.isInteger(buffer) || buffer < 0) throw Error("Invalid buffer size");
    const live = p.nature_of_activity.toLowerCase() === "live";
    let footprint = path
      .slice(Math.max(0, lo - buffer * 2), Math.min(path.length, hi + buffer * 2 + 1))
      .map((x) => x + ":" + bound);
    if (live)
      footprint.push(
        ...footprint.map((x) => x.replace(/:(EB|WB)$/, bound === "EB" ? ":WB" : ":EB")),
      );
    if (live && footprint.some((x) => /:H01_H02:|:H01:|:H02:/.test(x))) {
      for (const [other, route] of Object.entries(routes))
        if (other !== line)
          for (const x of route.filter((x) => /:H01_H02$|:H01$|:H02$/.test(x)))
            for (const b of ["EB", "WB"]) footprint.push(x + ":" + b);
    }
    footprint = [...new Set(footprint)];
    for (const loc of footprint) if (!supplies.has(loc)) throw Error("No supply entry for " + loc);
    const workload = +r.total_accesses;
    if (!Number.isFinite(workload) || workload <= 0 || ![1, 2, 3].includes(+r.activity_priority))
      throw Error("Invalid activity workload/priority");
    return {
      ...r,
      p,
      line,
      bound,
      core,
      footprint,
      live,
      workload,
      start: Math.max(1, week(r.planned_start_date)),
      weight:
        { 1: 100, 2: 10, 3: 1 }[p.priority] * (1 + { 1: 0.3, 2: 0.2, 3: 0 }[r.activity_priority]),
      lines: [...new Set(footprint.map((x) => x.split(":")[1]))],
    };
  });
  const byId = indexAndValidateActivities(acts);
  const overrides = options.capacityOverrides || [];
  for (const change of overrides)
    if (
      !supplies.has(change.location) ||
      !Number.isInteger(change.from) ||
      !Number.isInteger(change.to) ||
      change.from < 1 ||
      change.to < change.from ||
      !Number.isInteger(change.capacity) ||
      change.capacity < 0
    )
      throw Error("Invalid capacity change");
  return {
    data,
    start,
    horizon,
    projects,
    acts,
    byId,
    supplies,
    routes,
    hardDisruption: options.hardDisruption === true,
    isDisrupted: (loc, week) =>
      overrides.some(
        (change) => change.location === loc && +week >= change.from && +week <= change.to,
      ),
    capacity: (loc, week) =>
      overrides.find(
        (change) => change.location === loc && +week >= change.from && +week <= change.to,
      )?.capacity ?? supplies.get(loc),
    endDate: (w) =>
      new Date(start + (w * DAYS_PER_WEEK - 1) * MILLISECONDS_PER_DAY).toISOString().slice(0, 10),
  };
}
// Conservative co-sharing: overlapping work spans, no Live or PM, legal local mix.
function canShare(a, b) {
  return (
    !a.live &&
    !b.live &&
    a.p.access_type !== "PM" &&
    b.p.access_type !== "PM" &&
    !(a.p.access_type === "PC" && b.p.access_type === "PC") &&
    intersection(a.core, b.core)
  );
}
function slotFit(m, a, peers) {
  for (const b of peers)
    if (intersection(a.footprint, b.footprint) && !canShare(a, b)) return false;
  for (const loc of a.core) {
    const here = peers.filter((b) => b.core.includes(loc));
    if (here.length >= 4) return false;
    if (a.p.access_type === "PM" && here.length) return false;
    if (here.some((b) => b.p.access_type === "PM")) return false;
    if (a.p.access_type === "PC" && here.some((b) => b.p.access_type === "PC")) return false;
  }
  return true;
}
function run(
  m,
  scenario,
  seed,
  windows = {},
  allowECLO = false,
  strictCapacity = false,
  replan = {},
) {
  const remaining = new Map(m.acts.map((a) => [a.activity_id, a.workload])),
    done = new Map(),
    access = [],
    occupancy = [],
    decisions = {},
    weekPlans = [];
  let last = 0;
  const frozenThrough = replan.freezeThroughWeek || 0;
  const baseline = replan.lockedBaseline;
  const baselineAccess = new Map();
  const baselineGroup = new Map();
  const placedCount = new Map();
  if (baseline) {
    for (const row of baseline.access) {
      const rows = baselineAccess.get(row.activity_id) || [];
      rows.push(row);
      baselineAccess.set(row.activity_id, rows);
    }
    for (const row of baseline.occupancy)
      baselineGroup.set(`${row.activity_id}|${row.week}`, row.co_share_group);
    for (const rows of baselineAccess.values())
      rows.sort((first, second) => first.week - second.week);
    for (const row of baseline.access.filter((entry) => entry.week <= frozenThrough)) {
      const remainingUnits = remaining.get(row.activity_id) - accessUnits(row);
      if (remainingUnits <= 1e-9) {
        remaining.delete(row.activity_id);
        done.set(row.activity_id, row.week);
      } else remaining.set(row.activity_id, remainingUnits);
      access.push({ ...row });
      placedCount.set(row.activity_id, (placedCount.get(row.activity_id) || 0) + 1);
      last = Math.max(last, row.week);
    }
    occupancy.push(
      ...baseline.occupancy
        .filter((entry) => entry.week <= frozenThrough)
        .map((entry) => ({ ...entry })),
    );
  }
  const maxWeeks =
    Math.max(m.horizon, ...m.acts.map((a) => a.start)) +
    Math.ceil(m.acts.reduce((s, a) => s + a.workload, 0)) +
    40;
  for (let w = frozenThrough + 1; remaining.size && w <= maxWeeks; w++) {
    const slots = [],
      contractSlots = new Map(),
      locSlots = new Map();
    let eligible = m.acts.filter((activity) => {
      const nextPlannedWeek = baselineAccess.get(activity.activity_id)?.[
        placedCount.get(activity.activity_id) || 0
      ]?.week;
      return (
        remaining.has(activity.activity_id) &&
        activity.start <= w &&
        (!baseline || !replan.preserveFuture || !nextPlannedWeek || w >= nextPlannedWeek) &&
        (!activity.predecessor_activity_id ||
          (done.has(activity.predecessor_activity_id) &&
            done.get(activity.predecessor_activity_id) < w))
      );
    });
    const hash = (a) => {
      let h = seed * 997;
      for (const c of a.activity_id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      return (h % 1000) / 1000;
    };
    eligible.sort((a, b) => {
      const sa =
          a.p.due -
          w -
          Math.ceil(
            remaining.get(a.activity_id) /
              (scenario === "B" ? EXTENDED_ACCESS_UNITS : STANDARD_ACCESS_UNITS),
          ) +
          1,
        sb =
          b.p.due -
          w -
          Math.ceil(
            remaining.get(b.activity_id) /
              (scenario === "B" ? EXTENDED_ACCESS_UNITS : STANDARD_ACCESS_UNITS),
          ) +
          1;
      const mode = seed % 6;
      return (
        (mode === 3
          ? Number(b.live) - Number(a.live)
          : mode === 4
            ? b.footprint.length - a.footprint.length
            : mode === 5
              ? hash(a) - hash(b)
              : 0) ||
        (mode === 0
          ? sa - sb
          : mode === 1
            ? b.weight - a.weight
            : Math.min(sa, 0) - Math.min(sb, 0)) ||
        a.p.due - b.p.due ||
        hash(a) - hash(b)
      );
    });
    for (const a of eligible) {
      const rem = remaining.get(a.activity_id),
        key = a.p.key,
        used = contractSlots.get(key) || new Map();
      let eclo = 0;
      const timeLeft = a.p.due - w + 1;
      if (scenario === "B" && allowECLO && rem > timeLeft + 1e-9) eclo = 1;
      if (
        scenario === "C" &&
        allowECLO &&
        a.lines.every((l) => windows[l] != null && w >= windows[l] && w <= windows[l] + 1) &&
        rem > Math.max(0, timeLeft) &&
        rem > 1
      )
        eclo = 1;
      const candidates = [],
        rejections = new Set(),
        blockers = new Set();
      for (let s = 0; s <= slots.length; s++) {
        const peers = slots[s] || [];
        if (!used.has(s) && used.size >= a.p.cap) {
          rejections.add("Weekly contractor night limit");
          continue;
        }
        if ((used.get(s) || 0) >= a.p.fronts) {
          rejections.add("Concurrent team limit");
          continue;
        }
        if (!slotFit(m, a, peers)) {
          rejections.add("Safety footprint or possession mix");
          for (const b of peers)
            if (intersection(a.footprint, b.footprint)) blockers.add(b.activity_id);
          continue;
        }
        let excess = 0,
          invalid = false;
        for (const loc of a.core) {
          const current = locSlots.get(loc) || new Set(),
            n = current.size + (current.has(s) ? 0 : 1),
            cap = m.capacity(loc, w);
          if (
            ((scenario === "A" || strictCapacity || (m.hardDisruption && m.isDisrupted(loc, w))) &&
              n > cap) ||
            (scenario === "C" && n > cap + 1)
          ) {
            invalid = true;
            rejections.add("Capacity at " + loc + " (limit " + cap + ")");
            break;
          }
          excess += Math.max(0, n - cap) - Math.max(0, current.size - cap);
        }
        if (invalid) continue;
        const sharing = peers.filter((b) => intersection(a.core, b.core)).length;
        const plannedGroup = baselineGroup.get(`${a.activity_id}|${w}`);
        candidates.push({
          s,
          score:
            excess * EXTRA_ACCESS_PENALTY -
            sharing * 0.2 +
            (s === slots.length ? 0.01 : 0) +
            (plannedGroup && plannedGroup !== `n${s + 1}` ? 4 : 0),
        });
      }
      if (!candidates.length) {
        (decisions[a.activity_id] ??= []).push({
          week: w,
          reason: [...rejections].join("; "),
          blockers: [...blockers],
        });
        continue;
      }
      candidates.sort((a, b) => a.score - b.score || a.s - b.s);
      const s = candidates[0].s;
      if (!slots[s]) slots[s] = [];
      slots[s].push(a);
      if (!used.has(s)) used.set(s, 0);
      used.set(s, used.get(s) + 1);
      contractSlots.set(key, used);
      const night = [...used.keys()].indexOf(s) + 1;
      access.push({
        activity_id: a.activity_id,
        access_seq: (placedCount.get(a.activity_id) || 0) + 1,
        week: w,
        eclo,
        access_night: night,
      });
      for (const loc of a.core) {
        if (!locSlots.has(loc)) locSlots.set(loc, new Set());
        locSlots.get(loc).add(s);
        occupancy.push({
          activity_id: a.activity_id,
          week: w,
          location_id: loc,
          co_share_group: "n" + (s + 1),
        });
      }
      placedCount.set(a.activity_id, (placedCount.get(a.activity_id) || 0) + 1);
      const left = rem - (eclo ? EXTENDED_ACCESS_UNITS : STANDARD_ACCESS_UNITS);
      if (left <= 1e-9) {
        remaining.delete(a.activity_id);
        done.set(a.activity_id, w);
      } else remaining.set(a.activity_id, left);
      last = w;
    }
    if (slots.length)
      weekPlans.push({ week: w, possessions: slots.length, activities: slots.flat().length });
  }
  const results = [...new Set(m.acts.map((a) => a.contract_number))].map((c) => {
    const aa = m.acts.filter((a) => a.contract_number === c),
      finish = Math.max(...aa.map((a) => done.get(a.activity_id) || 0));
    const due = Math.min(...aa.map((a) => date(a.p.planned_completion_date)));
    return {
      scenario,
      contract_number: c,
      simulated_completion_date: m.endDate(finish),
      overrun_days: Math.max(0, Math.round((date(m.endDate(finish)) - due) / MILLISECONDS_PER_DAY)),
    };
  });
  return {
    scenario,
    access,
    occupancy,
    results,
    decisions,
    weekPlans,
    windows,
    last,
    remaining: [...remaining.keys()],
  };
}
/**
 * Independently check a proposed schedule against implemented hard rules and score it.
 * This is not the organiser's reference validator.
 * @param {object} m Model returned by prepare.
 * @param {object} r Candidate schedule with access, occupancy, and results arrays.
 * @returns {object} Feasibility, violations, workload totals, and score components.
 */
export function validate(m, r) {
  const violations = [],
    add = (rule, detail) => violations.push({ rule, detail }),
    byAct = new Map(),
    occ = new Map(),
    groups = new Map(),
    contractNights = new Map(),
    end = new Map();
  for (const x of r.access) {
    const a = m.byId.get(x.activity_id);
    if (!a) {
      add("activity", "Unknown " + x.activity_id);
      continue;
    }
    if (!byAct.has(x.activity_id)) byAct.set(x.activity_id, []);
    byAct.get(x.activity_id).push(x);
    if (!Number.isInteger(x.week) || x.week < a.start) add("planned_start", x.activity_id);
    if (![0, 1].includes(x.eclo) || (r.scenario === "A" && x.eclo)) add("eclo", x.activity_id);
    if (!Number.isInteger(x.access_night) || x.access_night < 1 || x.access_night > a.p.cap)
      add("allocation", x.activity_id);
    const k = a.p.key + "|" + x.week + "|" + x.access_night;
    if (!contractNights.has(k)) contractNights.set(k, []);
    contractNights.get(k).push(a);
  }
  for (const a of m.acts) {
    const rows = byAct.get(a.activity_id) || [];
    if (rows.reduce((s, x) => s + accessUnits(x), 0) + 1e-9 < a.workload)
      add("workload", a.activity_id + " incomplete");
    if (new Set(rows.map((x) => x.week)).size !== rows.length)
      add("frequency", a.activity_id + " repeated in a week");
    if (rows.length) end.set(a.activity_id, Math.max(...rows.map((x) => x.week)));
    if (r.scenario === "B" && end.get(a.activity_id) > a.p.due)
      add("planned_date", a.activity_id + " finishes after target");
  }
  for (const a of m.acts)
    if (a.predecessor_activity_id) {
      const first = Math.min(...(byAct.get(a.activity_id) || []).map((x) => x.week));
      if (!(first > end.get(a.predecessor_activity_id))) add("predecessor", a.activity_id);
    }
  for (const [k, aa] of contractNights) if (aa.length > aa[0].p.fronts) add("workfront", k);
  for (const o of r.occupancy) {
    const a = m.byId.get(o.activity_id);
    if (!a || !a.core.includes(o.location_id)) {
      add("occupancy", "Unexpected " + o.activity_id + " " + o.location_id);
      continue;
    }
    const k = o.activity_id + "|" + o.week;
    if (!occ.has(k)) occ.set(k, []);
    occ.get(k).push(o);
    const g = o.week + "|" + o.location_id + "|" + o.co_share_group;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(a);
  }
  const slotMap = new Map();
  for (const x of r.access) {
    const a = m.byId.get(x.activity_id);
    if (!a) continue;
    const oo = occ.get(x.activity_id + "|" + x.week) || [];
    if (oo.length !== a.core.length || new Set(oo.map((o) => o.location_id)).size !== a.core.length)
      add("occupancy", "Missing/duplicate span " + x.activity_id);
    if (new Set(oo.map((o) => o.co_share_group)).size !== 1)
      add("possession", "Inconsistent dispatch slot " + x.activity_id);
    const k = x.week + "|" + oo[0]?.co_share_group;
    if (!slotMap.has(k)) slotMap.set(k, []);
    slotMap.get(k).push(a);
  }
  for (const [k, aa] of slotMap)
    for (let i = 0; i < aa.length; i++)
      for (let j = i + 1; j < aa.length; j++)
        if (intersection(aa[i].footprint, aa[j].footprint) && !canShare(aa[i], aa[j]))
          add("closure", k + ": " + aa[i].activity_id + " / " + aa[j].activity_id);
  const counts = new Map();
  for (const [g, aa] of groups) {
    const k = g.split("|").slice(0, 2).join("|");
    counts.set(k, (counts.get(k) || 0) + 1);
    if (
      aa.length > 4 ||
      aa.filter((a) => a.p.access_type === "PC").length > 1 ||
      (aa.some((a) => a.p.access_type === "PM") && aa.length > 1)
    )
      add("mix", g);
  }
  let excess = 0;
  const hotspots = [];
  for (const [k, n] of counts) {
    const [w, loc] = k.split("|"),
      cap = m.capacity(loc, w),
      over = Math.max(0, n - cap);
    excess += over;
    if (
      (r.scenario === "A" && over > 0) ||
      (r.scenario === "C" && over > 1) ||
      (m.hardDisruption && m.isDisrupted(loc, w) && over > 0)
    )
      add("capacity", k);
    if (n >= cap) hotspots.push({ week: +w, location: loc, used: n, capacity: cap, excess: over });
  }
  const eclo = r.access.filter((x) => x.eclo).length;
  if (r.scenario === "C") {
    for (const l of Object.keys(m.routes)) {
      const ww = r.access
        .filter((x) => x.eclo && m.byId.get(x.activity_id).lines.includes(l))
        .map((x) => x.week);
      if (ww.length && Math.max(...ww) - Math.min(...ww) > 1) add("eclo_window", l);
    }
  }
  let weighted = 0;
  for (const a of m.acts)
    if (end.has(a.activity_id))
      weighted +=
        Math.max(
          0,
          (date(m.endDate(end.get(a.activity_id))) - date(a.p.planned_completion_date)) /
            MILLISECONDS_PER_DAY,
        ) * a.weight;
  for (const row of r.results) {
    const aa = m.acts.filter((a) => a.contract_number === row.contract_number),
      w = Math.max(...aa.map((a) => end.get(a.activity_id) || 0));
    if (row.simulated_completion_date !== m.endDate(w))
      add("results", row.contract_number + " date mismatch");
  }
  const complete = m.acts.filter(
    (a) => (byAct.get(a.activity_id) || []).reduce((s, x) => s + accessUnits(x), 0) >= a.workload,
  ).length;
  return {
    feasible: violations.length === 0,
    hard_violations: violations,
    complete,
    total: m.acts.length,
    work_units: r.access.reduce((s, x) => s + accessUnits(x), 0),
    required_units: m.acts.reduce((s, a) => s + a.workload, 0),
    excess_access_nights_total: excess,
    eclo_nights_total: eclo,
    priority_weighted_score: +weighted.toFixed(3),
    objective_score: +(
      (r.scenario === "B" ? 0 : weighted) +
      (r.scenario === "A" ? 0 : EXTRA_ACCESS_PENALTY * excess + ECLO_PENALTY * eclo)
    ).toFixed(3),
    overrun_days_total: r.results.reduce((s, x) => s + x.overrun_days, 0),
    contracts_overrunning: r.results.filter((x) => x.overrun_days > 0).length,
    hotspots,
    validation_source:
      "TrackPlan implementation of published rules; official validator unavailable",
    assumptions: [
      "Possession groups use consistent dispatch slots across the route; access_night remains a separate local contractor index.",
      "Buffers and Live closures are enforced between activities in the same dispatch slot.",
      "Co-sharing is conservative: overlapping non-Live work spans only.",
      "Baseline supply repeats weekly.",
    ],
  };
}
/**
 * Search bounded deterministic schedule variants and return the best candidate.
 * A failed search does not prove that no feasible schedule exists.
 * @param {Record<string, Array<Record<string, string>>>} data Eight parsed input tables.
 * @param {"A"|"B"|"C"} scenario Scheduling policy.
 * @param {{capacityOverrides?: Array<object>, attempts?: number}} [options]
 * @returns {object} Schedule, diagnostics, score report, and model metadata.
 */
export function solve(data, scenario, options = {}) {
  if (!["A", "B", "C"].includes(scenario)) throw Error("Unknown scenario");
  const m = prepare(data, options);
  let best = null;
  const consider = (r) => {
    r.report = validate(m, r);
    const cost =
      (r.report.hard_violations.length ? 1e12 + r.report.hard_violations.length * 1e8 : 0) +
      r.report.objective_score;
    if (!best || cost < best.cost) best = { ...r, cost };
  };
  const attempts = options.attempts ?? 12;
  const replan = {
    lockedBaseline: options.lockedBaseline,
    freezeThroughWeek: options.freezeThroughWeek,
    preserveFuture: options.preserveFuture,
  };
  for (let s = 0; s < attempts; s++) {
    consider(
      run(m, scenario, s, options.lockedBaseline?.windows || {}, scenario === "B", false, replan),
    );
    if (scenario !== "A")
      consider(
        run(m, scenario, s, options.lockedBaseline?.windows || {}, scenario === "B", true, replan),
      );
  }
  if (scenario === "C" && best.report.objective_score > 0) {
    const lines = Object.keys(m.routes);
    const candidates = [
      ...new Set(
        m.acts
          .filter((a) => a.start + Math.ceil(a.workload) - 1 > a.p.due)
          .flatMap((a) => [Math.max(a.start, a.p.due - 1), a.start]),
      ),
    ];
    for (const w of candidates)
      for (let s = 0; s < Math.min(6, attempts); s++)
        consider(
          run(m, scenario, s, Object.fromEntries(lines.map((l) => [l, w])), true, false, replan),
        );
    if (lines.length === 2)
      for (const x of candidates)
        for (const y of candidates)
          if (x !== y)
            consider(run(m, scenario, 1, { [lines[0]]: x, [lines[1]]: y }, true, false, replan));
  }
  return {
    ...best,
    modelInfo: {
      activities: m.acts.map((a) => ({
        id: a.activity_id,
        contract: a.contract_number,
        line: a.line,
        bound: a.bound,
        priority: a.p.priority,
        activity_priority: +a.activity_priority,
        workload: a.workload,
        start: a.start,
        due: a.p.due,
        predecessor: a.predecessor_activity_id,
        core: a.core,
        footprint: a.footprint,
        nature: a.p.nature_of_activity,
        access_type: a.p.access_type,
        weight: a.weight,
      })),
      horizon: m.horizon,
      start: new Date(m.start).toISOString().slice(0, 10),
    },
    method: "Deterministic multi-start greedy heuristic; no claim of global optimality",
  };
}
/**
 * Build the three published CSV outputs from a schedule.
 * Callers must check result.report.feasible before offering a submission download.
 * @param {object} r Schedule returned by solve.
 * @returns {Record<string, string>} CSV text keyed by published filename.
 */
export function outputFiles(r) {
  return {
    "SCHEDULE_ACCESS.csv": csv(r.access, [
      "activity_id",
      "access_seq",
      "week",
      "eclo",
      "access_night",
    ]),
    "SCHEDULE_OCCUPANCY.csv": csv(r.occupancy, [
      "activity_id",
      "week",
      "location_id",
      "co_share_group",
    ]),
    "RESULTS.csv": csv(r.results, [
      "scenario",
      "contract_number",
      "simulated_completion_date",
      "overrun_days",
    ]),
  };
}

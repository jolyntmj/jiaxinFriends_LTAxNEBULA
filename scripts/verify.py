"""Independent CSV audit. Does not import the JavaScript scheduling engine.
This is not the organiser's reference validator.
"""

import csv
import json
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

root = Path(__file__).resolve().parents[1]
d = json.loads((root / "dist/example.json").read_text())
projects = {(p["contract_number"], p["activity_type"]): p for p in d["07_PROJECT_DETAILS"]}
acts = {a["activity_id"]: a for a in d["08_ACTIVITY_DETAILS"]}
params = {r["key"]: r["value"] for r in d["06_PARAMETERS"]}
start = date.fromisoformat(params["horizon_start"])
supply = {r["location_id"]: int(r["supply_capacity"]) for r in d["04_LOCATION_SUPPLY"]}
paths = {}
for line_row in d["01_LINES"]:
    line = line_row["line_code"]
    stations = sorted(
        [s for s in d["02_STATIONS"] if s["line_code"] == line], key=lambda s: int(s["seq"])
    )
    path = []
    for i, s in enumerate(stations):
        path.append("PLAT:" + line + ":" + s["station_id"])
        if i + 1 < len(stations):
            sec = next(
                x
                for x in d["03_SECTORS"]
                if x["line_code"] == line
                and x["from_station_id"] == s["station_id"]
                and x["to_station_id"] == stations[i + 1]["station_id"]
            )
            path.append(sec["sector_id"])
    paths[line] = path
shapes = {}
for aid, a in acts.items():
    p = projects[a["contract_number"], a["activity_type"]]
    line = a["start_location_id"].split(":")[1]
    bound = a["start_location_id"].split(":")[-1]
    path = paths[line]
    lo, hi = sorted(
        [path.index(a[k].rsplit(":", 1)[0]) for k in ["start_location_id", "end_location_id"]]
    )
    lo -= lo % 2
    hi += hi % 2
    core = {x + ":" + bound for x in path[lo : hi + 1]}
    buf = int(
        next(x for x in d["05_BUFFER_LOCATION"] if x["nature_of_works"] == p["nature_of_activity"])[
            "up_to_buffer_sectors"
        ]
    )
    foot = {x + ":" + bound for x in path[max(0, lo - 2 * buf) : hi + 2 * buf + 1]}
    live = p["nature_of_activity"] == "Live"
    if live:
        foot |= {
            x.rsplit(":", 1)[0] + (":" + ("WB" if bound == "EB" else "EB")) for x in list(foot)
        }
        if any(x.split(":")[2] in ["H01", "H02", "H01_H02"] for x in foot):
            for other, route in paths.items():
                if other != line:
                    foot |= {
                        x + ":" + b
                        for x in route
                        if x.split(":")[2] in ["H01", "H02", "H01_H02"]
                        for b in ["EB", "WB"]
                    }
    shapes[aid] = (core, foot, live)


def load_csv(path):
    """Read an output CSV and close its file before validation begins."""
    with path.open(newline="", encoding="utf-8") as source:
        return list(csv.DictReader(source))


for scenario in "ABC":
    folder = root / "results" / scenario
    access = load_csv(folder / "SCHEDULE_ACCESS.csv")
    occupancy = load_csv(folder / "SCHEDULE_OCCUPANCY.csv")
    results = load_csv(folder / "RESULTS.csv")
    by = defaultdict(list)
    occ = defaultdict(list)
    groups = defaultdict(list)
    teams = defaultdict(set)
    slots = defaultdict(set)
    for a in access:
        aid = a["activity_id"]
        assert aid in acts
        w = int(a["week"])
        ec = int(a["eclo"])
        night = int(a["access_night"])
        p = projects[acts[aid]["contract_number"], acts[aid]["activity_type"]]
        assert ec in (0, 1) and not (scenario == "A" and ec)
        assert 1 <= night <= int(p["number_of_maximum_access_per_week"])
        assert w >= ((date.fromisoformat(acts[aid]["planned_start_date"]) - start).days // 7 + 1)
        by[aid].append((w, ec, int(a["access_seq"])))
        teams[p["contract_number"], p["activity_type"], w, night].add(aid)
    for key, ids in teams.items():
        assert len(ids) <= int(projects[key[:2]]["number_of_workfronts"])
    finish = {}
    for aid, a in acts.items():
        rows = sorted(by[aid])
        assert rows and len({r[0] for r in rows}) == len(rows)
        assert [r[2] for r in rows] == list(range(1, len(rows) + 1))
        assert sum(1 + 0.5 * r[1] for r in rows) >= float(a["total_accesses"])
        finish[aid] = max(r[0] for r in rows)
    for aid, a in acts.items():
        if a["predecessor_activity_id"]:
            assert min(x[0] for x in by[aid]) > finish[a["predecessor_activity_id"]]
    for o in occupancy:
        occ[o["activity_id"], int(o["week"])].append(o)
        groups[int(o["week"]), o["location_id"], o["co_share_group"]].append(o["activity_id"])
    for aid, rows in by.items():
        for w, ec, _ in rows:
            oo = occ[aid, w]
            assert len(oo) == len(shapes[aid][0])
            assert {o["location_id"] for o in oo} == shapes[aid][0]
            assert len({o["co_share_group"] for o in oo}) == 1
            slots[w, oo[0]["co_share_group"]].add(aid)
    counts = defaultdict(int)
    for (w, loc, g), ids in groups.items():
        counts[w, loc] += 1
        types = [
            projects[acts[i]["contract_number"], acts[i]["activity_type"]]["access_type"]
            for i in ids
        ]
        assert len(types) <= 4 and types.count("PC") <= 1 and ("PM" not in types or len(types) == 1)
    for (w, g), ids in slots.items():
        ids = sorted(ids)
        for i, a in enumerate(ids):
            for b in ids[i + 1 :]:
                ca, fa, la = shapes[a]
                cb, fb, lb = shapes[b]
                pa = projects[acts[a]["contract_number"], acts[a]["activity_type"]]
                pb = projects[acts[b]["contract_number"], acts[b]["activity_type"]]
                if fa & fb:
                    assert (
                        not la
                        and not lb
                        and ca & cb
                        and "PM" not in [pa["access_type"], pb["access_type"]]
                        and [pa["access_type"], pb["access_type"]] != ["PC", "PC"]
                    ), (scenario, w, a, b)
    excess = sum(max(0, count - supply[location]) for (_, location), count in counts.items())
    if scenario == "A":
        assert excess == 0
    if scenario == "C":
        assert all(count <= supply[location] + 1 for (_, location), count in counts.items())
        for line in paths:
            ww = [
                w
                for aid, rows in by.items()
                for w, ec, _ in rows
                if ec and any(":" + line + ":" in x for x in shapes[aid][1])
            ]
            assert not ww or max(ww) - min(ww) <= 1
    weighted = 0
    for aid, a in acts.items():
        p = projects[a["contract_number"], a["activity_type"]]
        end = start + timedelta(days=finish[aid] * 7 - 1)
        delay = max(0, (end - date.fromisoformat(p["planned_completion_date"])).days)
        if scenario == "B":
            assert delay == 0
        weighted += (
            delay
            * {1: 100, 2: 10, 3: 1}[int(p["contract_priority"])]
            * (1 + {1: 0.3, 2: 0.2, 3: 0}[int(a["activity_priority"])])
        )
    assert {r["contract_number"] for r in results} == {a["contract_number"] for a in acts.values()}
    for r in results:
        assert r["scenario"] == scenario
        c = r["contract_number"]
        aa = [a for a in acts.values() if a["contract_number"] == c]
        end = start + timedelta(days=max(finish[a["activity_id"]] for a in aa) * 7 - 1)
        due = min(
            date.fromisoformat(projects[c, a["activity_type"]]["planned_completion_date"])
            for a in aa
        )
        assert r["simulated_completion_date"] == end.isoformat() and int(r["overrun_days"]) == max(
            0, (end - due).days
        )
    ec = sum(e for rows in by.values() for w, e, _ in rows)
    score = (0 if scenario == "B" else weighted) + (0 if scenario == "A" else 7 * excess + 5 * ec)
    report = json.loads((folder / "validation.json").read_text())
    assert abs(report["objective_score"] - score) < 1e-8
    summary = f"{scenario}: independent audit passed; {len(acts)} complete; score={score:g}"
    print(f"{summary}; ECLO={ec}; excess={excess}")

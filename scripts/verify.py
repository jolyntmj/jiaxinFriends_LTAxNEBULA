"""
Independent CSV audit.

This does not import the JavaScript scheduling engine.
This is not the organiser's reference validator.
"""

import csv
import json
import sys

from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path


# Locate the main project directory.
root = Path(__file__).resolve().parents[1]

# Load the example dataset.
data = json.loads(
    (root / "dist" / "example.json").read_text()
)

# Organise project and activity information for quick lookup.
projects = {
    (project["contract_number"], project["activity_type"]): project
    for project in data["07_PROJECT_DETAILS"]
}

activities = {
    activity["activity_id"]: activity
    for activity in data["08_ACTIVITY_DETAILS"]
}

parameters = {
    row["key"]: row["value"]
    for row in data["06_PARAMETERS"]
}

horizon_start = date.fromisoformat(
    parameters["horizon_start"]
)

# Store the standard supply capacity for every location.
supply = {
    row["location_id"]: int(row["supply_capacity"])
    for row in data["04_LOCATION_SUPPLY"]
}


# ---------------------------------------------------------------------
# Construct the ordered railway path for each line.
# ---------------------------------------------------------------------

paths = {}

for line_row in data["01_LINES"]:
    line_code = line_row["line_code"]

    stations = sorted(
        [
            station
            for station in data["02_STATIONS"]
            if station["line_code"] == line_code
        ],
        key=lambda station: int(station["seq"]),
    )

    path = []

    for index, station in enumerate(stations):
        path.append(
            f"PLAT:{line_code}:{station['station_id']}"
        )

        if index + 1 < len(stations):
            next_station = stations[index + 1]

            sector = next(
                row
                for row in data["03_SECTORS"]
                if (
                    row["line_code"] == line_code
                    and row["from_station_id"]
                    == station["station_id"]
                    and row["to_station_id"]
                    == next_station["station_id"]
                )
            )

            path.append(sector["sector_id"])

    paths[line_code] = path


# ---------------------------------------------------------------------
# Calculate the core and buffered footprint of every activity.
# ---------------------------------------------------------------------

shapes = {}

for activity_id, activity in activities.items():
    project_key = (
        activity["contract_number"],
        activity["activity_type"],
    )

    project = projects[project_key]

    line_code = activity["start_location_id"].split(":")[1]
    bound = activity["start_location_id"].split(":")[-1]
    path = paths[line_code]

    start_index, end_index = sorted(
        [
            path.index(
                activity[field].rsplit(":", 1)[0]
            )
            for field in [
                "start_location_id",
                "end_location_id",
            ]
        ]
    )

    # Adjust the indexes so that the full railway segment is included.
    start_index -= start_index % 2
    end_index += end_index % 2

    core = {
        location + ":" + bound
        for location in path[start_index : end_index + 1]
    }

    buffer_size = int(
        next(
            row
            for row in data["05_BUFFER_LOCATION"]
            if row["nature_of_works"]
            == project["nature_of_activity"]
        )["up_to_buffer_sectors"]
    )

    footprint = {
        location + ":" + bound
        for location in path[
            max(0, start_index - 2 * buffer_size) :
            end_index + 2 * buffer_size + 1
        ]
    }

    is_live = project["nature_of_activity"] == "Live"

    if is_live:
        opposite_bound = (
            "WB"
            if bound == "EB"
            else "EB"
        )

        footprint |= {
            location.rsplit(":", 1)[0]
            + ":"
            + opposite_bound
            for location in list(footprint)
        }

        # Include connected routes around the shared H01/H02 area.
        if any(
            location.split(":")[2]
            in ["H01", "H02", "H01_H02"]
            for location in footprint
        ):
            for other_line, route in paths.items():
                if other_line == line_code:
                    continue

                footprint |= {
                    location + ":" + direction
                    for location in route
                    if location.split(":")[2]
                    in ["H01", "H02", "H01_H02"]
                    for direction in ["EB", "WB"]
                }

    shapes[activity_id] = (
        core,
        footprint,
        is_live,
    )


def load_csv(file_path):
    """Load a CSV file and return its rows as dictionaries."""

    with file_path.open() as file:
        return list(csv.DictReader(file))


# ---------------------------------------------------------------------
# Independently audit scenarios A, B and C.
# ---------------------------------------------------------------------

for scenario in "ABC":
    scenario_folder = root / "results" / scenario

    access_rows = load_csv(
        scenario_folder / "SCHEDULE_ACCESS.csv"
    )

    occupancy_rows = load_csv(
        scenario_folder / "SCHEDULE_OCCUPANCY.csv"
    )

    result_rows = load_csv(
        scenario_folder / "RESULTS.csv"
    )

    accesses_by_activity = defaultdict(list)
    occupancy_by_activity_week = defaultdict(list)
    co_share_groups = defaultdict(list)
    contractor_teams = defaultdict(set)
    dispatch_slots = defaultdict(set)

    # -----------------------------------------------------------------
    # Validate scheduled access rows.
    # -----------------------------------------------------------------

    for access_row in access_rows:
        activity_id = access_row["activity_id"]

        assert activity_id in activities

        week = int(access_row["week"])
        eclo = int(access_row["eclo"])
        access_night = int(access_row["access_night"])

        activity = activities[activity_id]

        project = projects[
            (
                activity["contract_number"],
                activity["activity_type"],
            )
        ]

        assert eclo in (0, 1)
        assert not (
            scenario == "A"
            and eclo
        )

        assert (
            1
            <= access_night
            <= int(
                project[
                    "number_of_maximum_access_per_week"
                ]
            )
        )

        earliest_week = (
            (
                date.fromisoformat(
                    activity["planned_start_date"]
                )
                - horizon_start
            ).days
            // 7
            + 1
        )

        assert week >= earliest_week

        accesses_by_activity[activity_id].append(
            (
                week,
                eclo,
                int(access_row["access_seq"]),
            )
        )

        contractor_teams[
            (
                project["contract_number"],
                project["activity_type"],
                week,
                access_night,
            )
        ].add(activity_id)

    # Check the number of simultaneous contractor workfronts.
    for team_key, activity_ids in contractor_teams.items():
        project_key = team_key[:2]

        assert len(activity_ids) <= int(
            projects[project_key]["number_of_workfronts"]
        )

    # -----------------------------------------------------------------
    # Validate workload delivery and activity sequence.
    # -----------------------------------------------------------------

    finish_weeks = {}

    for activity_id, activity in activities.items():
        rows = sorted(
            accesses_by_activity[activity_id]
        )

        assert rows

        assert len(
            {
                row[0]
                for row in rows
            }
        ) == len(rows)

        assert [
            row[2]
            for row in rows
        ] == list(
            range(1, len(rows) + 1)
        )

        delivered_workload = sum(
            1 + 0.5 * row[1]
            for row in rows
        )

        assert delivered_workload >= float(
            activity["total_accesses"]
        )

        finish_weeks[activity_id] = max(
            row[0]
            for row in rows
        )

    # Check predecessor constraints.
    for activity_id, activity in activities.items():
        predecessor_id = activity[
            "predecessor_activity_id"
        ]

        if predecessor_id:
            activity_start_week = min(
                row[0]
                for row
                in accesses_by_activity[activity_id]
            )

            assert (
                activity_start_week
                > finish_weeks[predecessor_id]
            )

    # -----------------------------------------------------------------
    # Organise and validate occupancy rows.
    # -----------------------------------------------------------------

    for occupancy_row in occupancy_rows:
        activity_id = occupancy_row["activity_id"]
        week = int(occupancy_row["week"])

        occupancy_by_activity_week[
            (activity_id, week)
        ].append(occupancy_row)

        co_share_groups[
            (
                week,
                occupancy_row["location_id"],
                occupancy_row["co_share_group"],
            )
        ].append(activity_id)

    for activity_id, rows in accesses_by_activity.items():
        for week, eclo, sequence in rows:
            activity_occupancy = (
                occupancy_by_activity_week[
                    (activity_id, week)
                ]
            )

            expected_core = shapes[activity_id][0]

            assert (
                len(activity_occupancy)
                == len(expected_core)
            )

            assert {
                row["location_id"]
                for row in activity_occupancy
            } == expected_core

            assert len(
                {
                    row["co_share_group"]
                    for row in activity_occupancy
                }
            ) == 1

            dispatch_slots[
                (
                    week,
                    activity_occupancy[0][
                        "co_share_group"
                    ],
                )
            ].add(activity_id)

    # -----------------------------------------------------------------
    # Check co-sharing rules and calculate capacity usage.
    # -----------------------------------------------------------------

    location_counts = defaultdict(int)

    for (
        week,
        location_id,
        group,
    ), activity_ids in co_share_groups.items():
        location_counts[
            (week, location_id)
        ] += 1

        access_types = [
            projects[
                (
                    activities[activity_id][
                        "contract_number"
                    ],
                    activities[activity_id][
                        "activity_type"
                    ],
                )
            ]["access_type"]
            for activity_id in activity_ids
        ]

        assert len(access_types) <= 4
        assert access_types.count("PC") <= 1

        assert (
            "PM" not in access_types
            or len(access_types) == 1
        )

    # Check footprint conflicts within each dispatch slot.
    for (
        week,
        group,
    ), activity_ids in dispatch_slots.items():
        activity_ids = sorted(activity_ids)

        for index, first_id in enumerate(activity_ids):
            for second_id in activity_ids[index + 1 :]:
                (
                    first_core,
                    first_footprint,
                    first_live,
                ) = shapes[first_id]

                (
                    second_core,
                    second_footprint,
                    second_live,
                ) = shapes[second_id]

                first_activity = activities[first_id]
                second_activity = activities[second_id]

                first_project = projects[
                    (
                        first_activity["contract_number"],
                        first_activity["activity_type"],
                    )
                ]

                second_project = projects[
                    (
                        second_activity["contract_number"],
                        second_activity["activity_type"],
                    )
                ]

                if first_footprint & second_footprint:
                    assert (
                        not first_live
                        and not second_live
                        and first_core & second_core
                        and "PM"
                        not in [
                            first_project["access_type"],
                            second_project["access_type"],
                        ]
                        and [
                            first_project["access_type"],
                            second_project["access_type"],
                        ]
                        != ["PC", "PC"]
                    ), (
                        scenario,
                        week,
                        first_id,
                        second_id,
                    )

    # Calculate the number of excess access slots.
    excess_access = sum(
        max(
            0,
            count - supply[location_id],
        )
        for (
            week,
            location_id,
        ), count in location_counts.items()
    )

    if scenario == "A":
        assert excess_access == 0

    if scenario == "C":
        assert all(
            count <= supply[location_id] + 1
            for (
                week,
                location_id,
            ), count in location_counts.items()
        )

        # Check that ECLO activity on each line is concentrated
        # within a maximum two-week interval.
        for line_code in paths:
            eclo_weeks = [
                week
                for activity_id, rows
                in accesses_by_activity.items()
                for week, eclo, sequence in rows
                if (
                    eclo
                    and any(
                        f":{line_code}:" in location
                        for location
                        in shapes[activity_id][1]
                    )
                )
            ]

            assert (
                not eclo_weeks
                or max(eclo_weeks)
                - min(eclo_weeks)
                <= 1
            )

    # -----------------------------------------------------------------
    # Calculate weighted delay penalties.
    # -----------------------------------------------------------------

    weighted_delay = 0

    contract_priority_weights = {
        1: 100,
        2: 10,
        3: 1,
    }

    activity_priority_weights = {
        1: 0.3,
        2: 0.2,
        3: 0,
    }

    for activity_id, activity in activities.items():
        project = projects[
            (
                activity["contract_number"],
                activity["activity_type"],
            )
        ]

        simulated_end_date = (
            horizon_start
            + timedelta(
                days=finish_weeks[activity_id] * 7 - 1
            )
        )

        planned_completion_date = date.fromisoformat(
            project["planned_completion_date"]
        )

        delay_days = max(
            0,
            (
                simulated_end_date
                - planned_completion_date
            ).days,
        )

        if scenario == "B":
            assert delay_days == 0

        contract_weight = contract_priority_weights[
            int(project["contract_priority"])
        ]

        activity_weight = activity_priority_weights[
            int(activity["activity_priority"])
        ]

        weighted_delay += (
            delay_days
            * contract_weight
            * (1 + activity_weight)
        )

    # -----------------------------------------------------------------
    # Validate contract-level results.
    # -----------------------------------------------------------------

    assert {
        row["contract_number"]
        for row in result_rows
    } == {
        activity["contract_number"]
        for activity in activities.values()
    }

    for result_row in result_rows:
        assert result_row["scenario"] == scenario

        contract_number = result_row["contract_number"]

        contract_activities = [
            activity
            for activity in activities.values()
            if activity["contract_number"]
            == contract_number
        ]

        simulated_completion_date = (
            horizon_start
            + timedelta(
                days=max(
                    finish_weeks[
                        activity["activity_id"]
                    ]
                    for activity
                    in contract_activities
                )
                * 7
                - 1
            )
        )

        planned_completion_date = min(
            date.fromisoformat(
                projects[
                    (
                        contract_number,
                        activity["activity_type"],
                    )
                ]["planned_completion_date"]
            )
            for activity in contract_activities
        )

        overrun_days = max(
            0,
            (
                simulated_completion_date
                - planned_completion_date
            ).days,
        )

        assert (
            result_row["simulated_completion_date"]
            == simulated_completion_date.isoformat()
        )

        assert (
            int(result_row["overrun_days"])
            == overrun_days
        )

    # -----------------------------------------------------------------
    # Recalculate and verify the final objective score.
    # -----------------------------------------------------------------

    eclo_count = sum(
        eclo
        for rows in accesses_by_activity.values()
        for week, eclo, sequence in rows
    )

    objective_score = (
        0
        if scenario == "B"
        else weighted_delay
    ) + (
        0
        if scenario == "A"
        else 7 * excess_access + 5 * eclo_count
    )

    validation_report = json.loads(
        (
            scenario_folder / "validation.json"
        ).read_text()
    )

    assert (
        abs(
            validation_report["objective_score"]
            - objective_score
        )
        < 1e-8
    )

    print(
        f"{scenario}: independent audit passed; "
        f"{len(activities)} complete; "
        f"score={objective_score:g}; "
        f"ECLO={eclo_count}; "
        f"excess={excess_access}"
    )
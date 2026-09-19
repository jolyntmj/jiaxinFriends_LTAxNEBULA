# TrackPlan — Problem Statement 1

TrackPlan is a browser-based railway track access scheduler for the supplied
dual-line network. Upload the eight required CSV files, generate Scenarios A,
B and C, inspect the resulting schedules, and export the required outputs.

## Live Demo

TrackPlan is hosted on Google Cloud and can be accessed here:

https://storage.googleapis.com/nebula-lta-hackathon26/index.html

No installation is required to use the hosted version.

## How to Use

1. Open the live website.
2. Upload the eight required CSV files (`01_LINES.csv` to `08_ACTIVITY_DETAILS.csv`).
3. Generate the baseline schedules.
4. Compare Scenarios A, B and C.
5. Inspect the schedule, capacity usage and validation results.
6. Download the required output files.

All scheduling runs locally in the browser. Uploaded files are not sent to a
backend server.

## Run Locally

If you prefer to run TrackPlan locally:

```bash
python -m http.server 8000 --directory dist
```

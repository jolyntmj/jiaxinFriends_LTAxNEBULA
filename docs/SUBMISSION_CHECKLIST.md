# PS1 submission checklist

## Included and ready to review

- Working hosted app and complete portable source.
- A, B and C computed output folders, each containing SCHEDULE_ACCESS.csv, SCHEDULE_OCCUPANCY.csv and RESULTS.csv.
- Reproducible batch runner and independent audit.
- Solution write-up and three-minute recording script.

## Actions still needed outside this session

1. Run the organiser's reference validator if made available. The bundled audit is independent of the JS engine but is not the official validator.
2. Open the hosted app and test upload → generate → inspect → export. Make the site accessible to the judges; the current site access setting is public (confirmed during the feature update); still check the link from a judge session.
3. Create a GitLab repository in the team's account and upload the contents of source/. Include the actual GitLab URL; a Sites source repository is not a GitLab URL. If the event's general slide still asks for GitHub, clarify the difference with the organiser because the PS1 README explicitly asks for GitLab.
4. Record the actual application walkthrough using VIDEO_SCRIPT.md, keep it under three minutes and upload it to YouTube. Add the actual YouTube URL.
5. Name the final submission folder with the registered team name. Include the public test output ZIP, app URL, repository URL, video URL and write-up. Meet any event-wide submission requirements as well.

## Suggested package layout

- Public_Test_Results.zip (A/, B/, C/; three CSVs in each)
- source/ (app, engine, runner, verification and documentation)
- SOLUTION_WRITEUP.md
- VIDEO_SCRIPT.md
- SUBMISSION_CHECKLIST.md

No GitLab or YouTube URLs are fabricated. The local generated output is verified programmatically; record the visible browser export in the final demo.

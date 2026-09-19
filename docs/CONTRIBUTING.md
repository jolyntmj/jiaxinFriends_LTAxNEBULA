# Contributing to TrackPlan

1. Work on a branch, not `main`: `git switch -c codex/short-description` (or your team's branch prefix). Keep unrelated changes out of the same review.
2. Make the smallest behavior-preserving change that solves the problem. Prefer descriptive camelCase JavaScript names and snake_case Python names; use uppercase names for shared constants. Avoid speculative abstractions.
3. Document public APIs, non-obvious rules, assumptions, and workarounds. Comments should explain _why_. Update the [developer guide](DEVELOPER_GUIDE.md) when inputs, outputs, architecture, or limitations change.
4. Add or update a regression test for each bug fix or scheduling-rule change. Use `npm run check` before review; the GitHub workflow runs the same command on pushes and pull requests. If public-instance outputs change intentionally, regenerate them and run `python3 scripts/verify.py`.
5. Review the diff for secrets, unescaped user data, accidental generated files, and changes to unrelated work. Do not claim official feasibility from the local checks.
6. Commit with a concise purpose statement (for example, `Validate CSV row widths`) and request review before merging. The reviewer should examine both code and test evidence; passing tests alone do not prove correctness.

`node_modules/` is never committed. `dist/TrackPlan_Source.zip`, `dist/example.json`, and `results/` are generated artifacts; refresh them only as part of a deliberate submission or input-instance update. The ZIP is produced by `python3 scripts/package.py`.

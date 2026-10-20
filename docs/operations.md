# Maintaining the project

## Before a public launch

- Record repository/hosting recovery access and assign at least two maintainers.
- Compare the manifest’s upcoming semester, campuses and subjects with catalog coverage and the collection receipt. Distinguish complete public class collection from instructor-discovery coverage.
- Spot-check official class numbers, full instructor names and roles, meetings, sessions and linked components across campuses. Include published names, likely matches, multiple candidates and unresolved instructors.
- Check search by course number/name, instructor, campus and subject. Open section details and request live seat availability; confirm its timestamp is separate from the snapshot timestamp.
- Test saving/removing sections, semester changes, refresh persistence, meeting conflicts and calendar export. Check arranged/online offerings and missing or partial meeting dates.
- Check keyboard navigation, visible focus, form labels, pagination, empty/error states and a narrow mobile viewport.
- If using the API, check `/api/health`, allowed frontend origins and static fallback when API coverage or evidence is older/incomplete.
- Confirm production HTTPS, visible source timestamps and the independent-project notice. Track corrections through the repository.

## Refresh monitoring

Start with one base collection each day and the default 20-minute instructor-search budget. Enable scheduled runs with `ENABLE_SCHEDULED_IMPORTS=true`, then monitor Actions failures and source timestamps. GitHub’s cron schedule is not a freshness guarantee.

The workflow restores `artifacts/university/` from the latest matching cache. The public snapshot contains only the upcoming term; `history.json` stays in the local/build cache. Cache keys include branch, upcoming term, history term and campus selector; each successful run saves a new immutable cache after Python, Java and frontend checks pass. The cache contains:

| File                                        | Purpose                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `catalog.json`                              | Latest working catalog, including preserved surname/full-name evidence                  |
| `history.json`                              | Build-only historical records for instructor candidates; never published as app classes |
| `discovery-state.json`                      | Completed surname queries, source check times and section-scope fingerprints            |
| `collection.json`                           | Validated campus totals, latest discovery progress and batch failures                   |
| `latest-import.log`, `latest-discovery.log` | Most recent Java collection/search diagnostics                                          |

A missing or evicted cache rebuilds from the checked-in catalog and recollects history. It can repeat queries but must not remove previously published evidence merely because progress state is absent. Build-only historical records refresh when missing, on scheduled Sunday runs, or when a manual run selects `refresh_history`.

The surname queue checks previously unsearched names first, then changed scopes, then expired queries oldest first. Repeated checks of busy subjects therefore cannot indefinitely delay untouched scopes. New work prioritizes unresolved sections with scheduled meetings. Each Java batch has at most 40 surnames. Successful queries are reused for seven days unless the scope’s class identifiers change. The budget is checked between batches; it is not an exact job-duration limit. A large queue can span many daily runs. Inspect `pendingBatches` and `pendingSurnameQueries`, and review the failure list instead of treating an unfinished search as exhaustive coverage.

## Failure handling

A source/pagination/count-validation failure during base collection stops the run and deployment. Keep the previous public snapshot, inspect schema changes, source availability and count drops, and investigate with deployment disabled.

A failed surname batch retains previous evidence and remains pending. The orchestrator records the failure and can still publish a validated base catalog plus successful discovery batches. It never interprets a failed request as “no instructor assigned.” Recheck exact search criteria, no-results negative controls and class-number joins before changing the discovery adapter.

If frontend verification or any later required check fails, the workflow does not save the new cache or deploy. The prior successful cache and site remain available. When investigating locally, retain the working directory and logs. Do not manually mark unsuccessful surname queries complete.

Published instructor names, surname matches and full-name candidates have different evidence meanings. Confirm **Likely match** labels remain present across course rows, profiles, comparisons, saved plans and calendar exports. Instructor identity reviews and surname checks retain their own timestamps. A fresh base import must not make older evidence look freshly verified.

## Roster and history maintenance

The workflow refreshes CSE’s official directory using `update_cse_roster.py --catalog artifacts/university/catalog.json`. Reviewed identity and direct RateMyProfessors links are retained. Other subjects derive candidates from upcoming and build-only historical instructor records; adding an official directory for a department can expand its candidate set.

Reverify curated profile links and individual RateMyProfessors identities separately. A school-scoped search link does not verify an RMP profile. Historical Registrar associations are checked-in evidence; runtime refreshes need no PDF parser. Preserve source URLs and printed names, and never expand initials into guessed given names.

Run all Python collector/publisher/resume tests after changing those paths:

```sh
python3 -m unittest discover -s data/bootstrap -p 'test_*.py'
```

## Retention and recovery

Successful workflows retain a seven-day artifact containing the catalog index/files, production site, collection/discovery receipts and CSE roster/registry. The workflow does not commit generated catalogs. Periodically review a successful artifact and update the checked-in baseline through a normal pull request. Keep offline copies as well; Actions caches and artifacts are not permanent backups.

Rollback a bad static deployment through the hosting provider and disable `ENABLE_CLOUDFLARE_DEPLOY` while investigating. Rebuild from a known-good Git revision or retained artifact. Include the catalog index and every referenced file together; publishing only an index can leave clients unable to load their catalog.

The optional Render API serves the checked-in catalog from its container build. Rebuild it after updating that baseline. Its filesystem is ephemeral. If using PostgreSQL, keep regular exports and test a restore into a separate database.

## Sustainable ownership

Update the workflow’s default upcoming and build-history term codes before registration changes semesters. Review current coverage, pending discovery work, free-service limits and dependency updates regularly. Keep production tokens in repository/hosting secrets, rotate them when maintainers leave, and document the next maintainer before graduation.

Automated checks cover source pagination, all-subject normalization, scope preservation, resumable searches, atomic file publication, manifest validation, instructor evidence, frontend search/planning and live-seat response handling. They cannot establish that an unpublished future assignment is correct or replace manual visual/source checks. No external hosting deployment is configured by these local changes.

# Maintaining the project

## Before a public launch

- Place the repository, hosting project, and any domain under shared ownership. Record recovery access and assign at least two maintainers.
- Verify that displayed terms, subjects, and campus match `catalog.json` coverage; don't describe the pilot as all-OSU coverage.
- Compare several class numbers, instructor names, and meetings with official OSU results. Include a full-name section, a surname match, an ambiguous match, a TBA section, a lecture/lab course, and an arranged/online offering. Verify surname-search scope and collection time without assuming a primary instructor or full identity.
- Check search by exact course number and instructor name. Open section details and official-source links.
- Test saving/removing sections, term changes, refresh persistence, meeting conflicts, and `.ics` calendar export. Confirm overnight, partial-date, and missing-time cases are either handled or shown as limitations.
- Check keyboard navigation, visible focus, form labels, empty/error states, and a narrow mobile viewport.
- If using the API, confirm `/api/health`, CORS, timestamps, and static fallback when the API is unavailable.
- Confirm production HTTPS, a visible source timestamp, an independent-project notice, and a way for maintainers to receive corrections through the repository.

## Refresh monitoring

Start with one import per day. Watch the Actions tab and enable GitHub workflow failure notifications for maintainers. Schedules can stop or be delayed; compare the site's timestamp with the last successful workflow instead of assuming cron ran.

For an import failure, leave the published snapshot in place. Check source availability, pagination/schema changes, coverage warnings, and count drops. Run a manual refresh with publication disabled while investigating. Review the resulting artifact before enabling a source-parser change. An old timestamp should remain visible when refreshes fail.

The scheduled import reruns CSE surname discovery using all available current/included historical catalog candidates plus reviewed seeds, then joins official-record full names with curated registry overrides. A discovery or registry failure is an import failure: it must not publish a fresh catalog with evidence silently erased. Record sources, preserve stable IDs, respect candidate/result limits, and compare exact-search results with a no-results negative control. Monitor runtime as candidate history grows. Reverify curated profile links and individual rating URLs separately; school-scoped search links do not verify an RMP identity. Preserve old check times on untested evidence. Inspect a previously matched section that stops matching and a newly matched section. Confirm likely labels persist across views, and unresolved rows do not imply an unassigned section or completed exhaustive search.

Run `data/bootstrap/update_cse_roster.py` before a manual import, as the scheduled workflow does. Review official roster changes and retain curated identity/link overrides. The refreshed roster/seed files are included in the workflow artifact; update the checked-in baseline through a reviewed change rather than silently losing new names on the next run.

The collector also loads reviewed historical Registrar course associations from checked-in JSON; no PDF parser is needed during a refresh. Recheck the original official schedule before changing that evidence, retain source URLs, and do not expand printed initials into guessed given names. Run `python3 -m unittest discover -s data/bootstrap -p test_update_cse_roster.py` when changing collector behavior or historical identity matching; CI and scheduled refresh run it before collection.

The scheduled workflow does not commit generated JSON. Its successful output is retained as a seven-day Actions artifact, and optional Cloudflare deployment publishes that output. Periodically download and review a successful catalog and update the checked-in baseline through a normal pull request. The importer's drop check compares against that checked-in baseline in each workflow run, not an automatically downloaded previous deployment. Keep the baseline current during registration.

## Recovery

For a bad static deployment, use the provider's deployment rollback and disable `ENABLE_CLOUDFLARE_DEPLOY` while investigating. Rebuild from a known-good Git revision or a retained artifact. Keep a known-good catalog in version control and periodic offline exports; workflow artifact retention is not a permanent backup.

The optional Render API contains the checked-in snapshot from its last container build, so redeploy it after updating that baseline. The free Render filesystem is ephemeral. If using PostgreSQL, export it regularly to a private location and test a restore into a separate database. Public course snapshots do not need a student-data backup system.

## Sustainable ownership

Document each active term/campus/subject scope and the source parser assumptions. Review provider limits and dependency updates monthly, and test the next term before registration begins. Keep production tokens in hosting/GitHub secret settings with minimal permissions and rotate them after a maintainer leaves. Record the next maintainer and handoff date before graduation; domain and billing access should never depend on one student's personal account.

## Verification of this initial build

- Frontend checks cover catalog/URL semantics, snapshot integrity, API freshness/fallback, saved-plan persistence, comparison dialogs, instructor navigation, surname discovery presentation/filtering, meeting conflicts, and calendar export. Run the current suite for its exact count.
- Java checks cover framework-free core compilation, API/CORS behavior, pagination, incomplete-import rejection, scope preservation, instructor enrichment, and atomic publication. Run Maven verification for current results.
- The TypeScript check and production frontend build passed. A production-preview request returned the exact bundled 623-course / 4,793-section snapshot.
- A live Java refresh of all six Spring subjects matched the pilot counts and preserved Autumn records. An isolated PostgreSQL 17 verification covered migration, archive write, and API readback.
- Visual browser QA was not completed because Chrome access was not approved. Desktop and narrow-screen layout still need a manual visual check before public launch.
- No external hosting deployment has been configured or performed.

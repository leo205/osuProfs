# Free-first deployment

## Recommended first launch

Deploy only `frontend/dist` to Cloudflare Pages. The bundle includes a catalog exported by Java; searches run in the browser. An API and database add no value to basic snapshot browsing, so they are optional. Use the included free provider subdomain initially.

1. Use the public [leo205/osuProfs](https://github.com/leo205/osuProfs) repository and record recovery/maintainer access. Keep `.env` files and tokens out of the repository.
2. Run the local tests and a production build described in the README.
3. Create a **Direct Upload** Cloudflare Pages project. Use its `pages.dev` URL; there is no domain purchase requirement.
4. Upload `frontend/dist` through Cloudflare's dashboard for the first release, or use the configured workflow below.
5. Check search, saved sections, mobile layout, timestamps, and official-source links on the deployed site.

The workflow uses Direct Upload so the freshly imported snapshot is part of the published build without committing a generated dataset every day. A separate Git-integrated Pages build would use the checked-in snapshot instead. Choose one deployment method for the project; follow [Cloudflare's Direct Upload CI guide](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/).

## GitHub Actions configuration

`Verify application` runs on pushes and pull requests. It tests/builds React and verifies/packages Java. It never deploys.

`Refresh catalog and optionally publish` can be run manually in the Actions tab. Its defaults collect Spring 2027 (`1272`) across every public campus and offered subject, with Autumn 2026 (`1268`) cached only as instructor-history input. The published website includes Spring alone; Autumn classes are not selectable. The Java importer validates source pagination and scope totals. The Python orchestrator checks campus totals, preserves existing evidence and resumes exact-surname instructor searches across subjects.

Manual inputs are `term`, `history_term`, `campuses` (`ALL` or a comma-separated campus list), `discovery_minutes` (default `20`) and `refresh_history`. Instructor searches run in batches of at most 40 surnames. A batch can finish after the time budget, and unfinished work resumes later. Setting the budget to `0` processes the whole pending queue, subject to the workflow’s 60-minute job limit; use the bounded default for routine refreshes.

The workflow restores the latest checked `artifacts/university/` cache for its branch, terms and campus selector. It contains the working catalog, build-only instructor history, query progress and receipts. A first run or cache miss initializes from the checked-in manifest and fetches build-only instructor history. History refreshes on scheduled Sundays or with `refresh_history=true`; upcoming classes refresh on every normal run. Successful query checks are reused for seven days unless the scope’s class identifiers change.

Current and historical published instructor names seed each subject’s searches. The workflow also refreshes CSE’s official directory and reviewed identity registry before collection. Its 2,000-name roster sanity bound is separate from the 40-surname network batch limit. It does not automatically verify every curated profile or RateMyProfessors URL. Inferred full names remain likely candidates, and unresolved names remain visible.

Python tests, Maven verification and the frontend tests/build run before the new working state is cached or the site is deployed. A failed base collection or required check blocks publication. A failed surname batch preserves its previous evidence and appears in the receipt for retry; validated class data and successful batches can still publish. The seven-day review artifact contains the catalog index/files, built site, collection/discovery receipts and roster/registry.

The daily schedule is **10:23 UTC** and is enabled by default. Set `PAUSE_CATALOG_REFRESH=true` to pause it. GitHub schedules can be delayed or skipped. Observe actual timestamps and queue progress instead of assuming every instructor has been rechecked each day.

The static publisher groups whole subjects into files with a target size of 4 MiB, separated by term and campus, and refuses an individual file over 24 MiB. A small `catalog-index.json` lists their URLs, scopes and counts. The browser validates the entire manifest and catalog set before using it, downloads up to four files at once, and falls back to legacy `catalog.json` only when the index returns HTTP 404. Publish the index and its referenced files together.

To enable publication, add these **Actions repository secrets**:

| Secret                    | Value                                                              |
| ------------------------- | ------------------------------------------------------------------ |
| `CLOUDFLARE_ACCOUNT_ID`   | Account containing your Pages project                              |
| `CLOUDFLARE_API_TOKEN`    | Token scoped to that account with Cloudflare Pages edit permission |
| `CLOUDFLARE_PROJECT_NAME` | Existing Direct Upload project name                                |

Then set the repository variable `ENABLE_CLOUDFLARE_DEPLOY=true`. All three secrets and this explicit switch are required. Removing the switch disables publication while preserving build/refresh jobs. A run deploys its current Git branch; match the project's production branch to your default branch. Keep manual experiments on preview branches.

Leave `VITE_API_BASE_URL` unset for static-only operation. If using the optional backend, set that Actions variable to its public HTTPS origin. Any `VITE_` value becomes public frontend code; never put credentials there. API and bundled fallback snapshots refresh independently. The frontend checks both, restricts the API to the upcoming terms listed in the published catalog, and uses it only when it preserves published scope coverage and is at least as fresh in each scope. It also protects published names, section details, surname evidence and each full-name candidate’s identity/review time from an incomplete API response. Published full-name assignments can supersede likely metadata. A genuinely newer complete scope can reflect removed sections; equally fresh partial data cannot silently discard their evidence. A cold API request times out after 2.5 seconds and falls back to the bundled data. If the published catalog cannot load, the app asks the user to reload or retry; it does not trust an API-only term list that could expose archived semesters.

## Optional Spring Boot API on Render

The root `render.yaml` creates one free Docker web service and no database. It builds using `backend/Dockerfile` with the repository root as the Docker context, packages the checked-in catalog, and exposes `/api/health`. Importing the Blueprint into Render is a separate deployment action. Automatic code deployments are off in the template.

Set `APP_CORS_ORIGINS` to the exact frontend origin, such as `https://your-project.pages.dev`, before calling the API from React. The default `local` profile reads `/app/data/catalog-index.json` and its referenced files. The Docker build includes the entire `frontend/public/data` directory. Rebuild the container after updating the checked-in snapshot; the static-site refresh workflow does not update Render's container. Do not write durable data to a free service's filesystem.

Free Render web services sleep after 15 minutes without traffic and take about a minute to wake. They share 750 monthly instance hours per workspace and have ephemeral storage. Free Render Postgres expires after 30 days, so it is not our long-term database choice. Measure memory and startup time with the schoolwide catalog before enabling this optional service. Browser searches use static data for a dependable first load. [Render free-service limits](https://render.com/docs/free)

## Optional PostgreSQL on Neon

Use the backend `postgres` profile only when persistent storage is useful. Set these environment variables in the backend host's settings:

```dotenv
SPRING_PROFILES_ACTIVE=postgres
DATABASE_URL=jdbc:postgresql://YOUR_HOST/YOUR_DATABASE?sslmode=require
DATABASE_USERNAME=YOUR_USER
DATABASE_PASSWORD=YOUR_PASSWORD
```

Use separate username/password fields and a JDBC URL, not an unmodified `postgresql://` URL. Use the connection method recommended by your Neon project, a small connection pool, and SSL. Run and verify a test import before switching a public API to this profile. Keep the JSON snapshot as a portable backup and static fallback. Do not add database credentials to the frontend.

## Cost limits

Limits checked against provider documentation on October 20, 2026; review them again when creating accounts.

| Service          | Free-first use           | Relevant limit                                                                                                                                                                                                                                   |
| ---------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloudflare Pages | Static frontend and JSON | 500 builds/month, 20,000 files, 25 MiB maximum per asset; verify Direct Upload limits for your account. [Limits](https://developers.cloudflare.com/pages/platform/limits/)                                                                       |
| GitHub Actions   | CI and daily Java import | Standard hosted runners are free for public repositories. Private repositories use plan-specific included minutes/storage; artifacts also consume storage. [Billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| Render           | Optional API             | Free instance limits above; do not rely on a sleeping API for initial searches. [Limits](https://render.com/docs/free)                                                                                                                           |
| Neon             | Optional PostgreSQL      | Free plan currently lists 1 GB storage and 100 CU-hours/month per project. [Pricing](https://neon.com/pricing)                                                                                                                                   |
| Domain           | Optional                 | $0 with provider subdomain; a custom domain adds a separate renewal cost.                                                                                                                                                                        |

A daily import is roughly 30 builds per month, plus development builds. Start with one daily run, watch actual duration and data size, and retain workflow artifacts for only seven days. The publisher already splits catalog assets by term/campus/subject. Monitor Actions cache and artifact storage as catalogs grow; a cache eviction repeats work and does not require paid storage. Configure account spend controls or disable paid overages where supported. A free quota can lead to suspension or require an upgrade; $0 is a target within quotas, not a promise of unlimited service.

## Saved instructor data

Daily collection is enabled by default. Verified catalog files and search progress are committed automatically to GitHub after tests pass. `PAUSE_CATALOG_REFRESH=true` pauses collection. The browser checks newer saved data at `https://raw.githubusercontent.com/leo205/osuProfs/main/frontend/public` and keeps the bundled catalog as a fallback. Override that public base with `VITE_CATALOG_BASE_URL`, or explicitly set it empty for offline/bundled-only use. No always-running database is required for this setup.

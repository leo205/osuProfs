# Free-first deployment

## Recommended first launch

Deploy only `frontend/dist` to Cloudflare Pages. The bundle includes a catalog exported by Java; searches run in the browser. An API and database add no value to basic snapshot browsing, so they are optional. Use the included free provider subdomain initially.

1. Create a shared GitHub repository and upload this project. Give at least two maintainers access. Keep `.env` files and tokens out of the repository.
2. Run the local tests and a production build described in the README.
3. Create a **Direct Upload** Cloudflare Pages project. Use its `pages.dev` URL; there is no domain purchase requirement.
4. Upload `frontend/dist` through Cloudflare's dashboard for the first release, or use the configured workflow below.
5. Check search, saved sections, mobile layout, timestamps, and official-source links on the deployed site.

The workflow uses Direct Upload so the freshly imported snapshot is part of the published build without committing a generated dataset every day. A separate Git-integrated Pages build would use the checked-in snapshot instead. Choose one deployment method for the project; follow [Cloudflare's Direct Upload CI guide](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/).

## GitHub Actions configuration

`Verify application` runs on pushes and pull requests. It tests/builds React and verifies/packages Java. It never deploys.

`Refresh catalog and optionally publish` can be run manually in the Actions tab. By default, it fetches Spring 2027 Columbus CSE, MATH, STAT, PHYSICS, ECE, and ENGR and derives CSE surname candidates from all available current and included historical instructor records, augmented by the expanded official-directory seed file `data/discovery/cse-surnames.txt`. It verifies the importer, refreshes and enriches the JSON atomically, runs frontend checks, builds the site, and uploads a seven-day review artifact. If catalog collection, discovery, or a later check fails, the deploy step is skipped and the previous published site continues to serve.

Discovery is explicitly enabled with `app.discovery.subject=CSE` and `app.discovery.include-catalog-candidates=true`. The candidate list therefore grows with available catalog history and official directory records instead of stopping at a small manual list. The workflow tests the roster collector before running it; reviewed historical Registrar course associations load from checked-in JSON, with no PDF dependency at runtime. The workflow sets `app.discovery.max-candidates=200` to bound source requests; inspect a limit failure before raising it. `app.discovery.identity-file=data/discovery/cse-instructor-identities.json` supplies reviewed full-name/rating-link overrides while other full-name candidates use official catalog records as their source. A malformed or missing configured registry fails the run. The workflow rechecks surname queries; it does not automatically reverify curated profile or rating URLs, whose separate review times remain unchanged. If a manual import excludes CSE, unrelated CSE evidence remains in the merged snapshot. Broader collection uses more source requests and runner minutes; check actual duration and source limits before increasing frequency.

The daily schedule is **10:23 UTC**. GitHub schedules can be delayed or skipped, and are not an exact-time freshness guarantee. Scheduled runs stay disabled until the repository variable `ENABLE_SCHEDULED_IMPORTS` is set to `true`.

Before the Java import, the workflow runs `python3 data/bootstrap/update_cse_roster.py` using the standard runner's Python 3 and curl. This refreshes official directory names/seeds and preserves curated overrides, so future instructors are not limited to a frozen roster. A roster-refresh failure stops the run. The successful artifact includes the roster/seed files as well as the catalog and site for review.

To enable publication, add these **Actions repository secrets**:

| Secret                    | Value                                                              |
| ------------------------- | ------------------------------------------------------------------ |
| `CLOUDFLARE_ACCOUNT_ID`   | Account containing your Pages project                              |
| `CLOUDFLARE_API_TOKEN`    | Token scoped to that account with Cloudflare Pages edit permission |
| `CLOUDFLARE_PROJECT_NAME` | Existing Direct Upload project name                                |

Then set the repository variable `ENABLE_CLOUDFLARE_DEPLOY=true`. All three secrets and this explicit switch are required. Removing the switch disables publication while preserving build/refresh jobs. A run deploys its current Git branch; match the project's production branch to your default branch. Keep manual experiments on preview branches.

Leave `VITE_API_BASE_URL` unset for static-only operation. If using the optional backend, set that Actions variable to its public HTTPS origin. Any `VITE_` value becomes public frontend code; never put credentials there. API and bundled fallback snapshots refresh independently. The frontend checks both and uses the API only when it preserves published scope coverage and is at least as fresh in each scope. It also protects surname evidence and each full-name candidate's identity/review time from an older API response. Published full-name assignments can supersede likely metadata. A genuinely newer complete scope can reflect removed sections; equally fresh partial data cannot silently discard their evidence. A cold API request times out after 2.5 seconds and falls back to the bundled data.

## Optional Spring Boot API on Render

The root `render.yaml` creates one free Docker web service and no database. It builds using `backend/Dockerfile` with the repository root as the Docker context, packages the checked-in catalog, and exposes `/api/health`. Importing the Blueprint into Render is a separate deployment action. Automatic code deployments are off in the template.

Set `APP_CORS_ORIGINS` to the exact frontend origin, such as `https://your-project.pages.dev`, before calling the API from React. The default `local` profile reads `/app/data/catalog.json`. Rebuild the container after updating the checked-in snapshot; the static-site refresh workflow does not update Render's container. Do not write durable data to a free service's filesystem.

Free Render web services sleep after 15 minutes without traffic and take about a minute to wake. They share 750 monthly instance hours per workspace and have ephemeral storage. Free Render Postgres expires after 30 days, so it is not our long-term database choice. The small container has no availability guarantee; browser searches should use static data for a dependable first load. [Render free-service limits](https://render.com/docs/free)

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

A daily import is roughly 30 builds per month, plus development builds. Start with one daily run, watch actual duration and data size, and retain workflow artifacts for only seven days. Split catalog assets by term/subject before reaching the asset size limit. Configure account spend controls or disable paid overages where supported. A free quota can lead to suspension or require an upgrade; $0 is a target within quotas, not a promise of unlimited service.

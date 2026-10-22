# Buckeye Course Guide

An independent OSU course and instructor explorer built with React, TypeScript, Java 21 and Spring Boot. It shows public course records for the upcoming semester, across every campus and offered subject returned by OSU’s public class search.

The free-first deployment serves the website and validated catalog files from static hosting. Java handles collection and normalization; enabled daily GitHub Actions jobs refresh classes, resume instructor searches, and commit verified results and search progress back to this repository. Browsing needs no always-running API or database. Spring Boot REST and PostgreSQL adapters remain available when needed.

## Run locally

Install Node.js 22.21+ and npm. Java 21 and Maven 3.9+ are needed for the backend/importer. Collection orchestration also uses Python 3 and curl, without additional Python packages.

```sh
cd frontend
npm ci
npm run dev
```

Open Vite’s local URL, normally <http://localhost:5173>. The website reads the saved `frontend/public/data/catalog-index.json` and its catalog files. It also checks this public repository for newer saved data on startup and every 15 minutes while visible, so new instructor records appear without asking Codex or rebuilding the frontend. Unchanged files are reused; a failed or partial remote request keeps the saved local catalog. Set `VITE_CATALOG_BASE_URL=` in `frontend/.env.local` to use bundled data only. Records include their actual source collection times. Search, RateMyProfessors links and local schedule planning work without an account or paid service.

For the optional API, use another terminal:

```sh
cd backend
mvn spring-boot:run
```

The API starts at <http://localhost:8080/api/health>. To use it from React, add this to `frontend/.env.local` and restart Vite:

```dotenv
VITE_API_BASE_URL=http://localhost:8080
```

React retains the bundled catalog if the API is unavailable, older or missing richer instructor/section information. The bundled catalog defines the visible upcoming term; archived API semesters stay hidden. If the published catalog cannot load, the app asks you to retry before using API data. `.env.example` documents backend settings; Spring Boot does not automatically load a root `.env` file.

## Course and instructor coverage

- Search by semester, campus, subject, course number, instructor and course text.
- See course descriptions, credits, prerequisites, all available attributes and every imported section.
- Read published instructor names and roles, meeting dates/times/locations, delivery mode, session details, linked sections and enrollment consent when supplied.
- Open section details and choose **Check current seats** to request current availability directly from OSU. Snapshot status and the live seat check keep separate timestamps.
- Follow instructor profiles and RateMyProfessors links; save a schedule locally, inspect conflicts and export a calendar.
- Inspect collection coverage and official source links.

The public catalog contains only upcoming Spring 2027 (`1272`) across all campuses. Autumn 2026 (`1268`) is collected into a local/build-only history file to help identify instructors; its classes are not published or selectable in the app. The manifest and each catalog file’s `coverage` records describe what is actually included; the collection receipt records campus totals checked against OSU. A complete class collection does not mean every instructor identity has been published or resolved.

Instructor discovery uses current and historical published names for each subject, plus CSE’s official directory and reviewed identity overrides. It searches current-term class assignments by exact surname in OSU’s public PeopleSoft search. Work runs in paced, resumable batches instead of stopping at a small manual list.

A surname query does not prove a full identity or primary teaching role. Full names inferred from official records and teaching history remain **Likely match**; multiple supported candidates remain visible. **Instructor not resolved** means current evidence has not identified the instructor. Published assignments remain separate. RateMyProfessors pages open externally; ratings and reviews are not imported. See [data coverage and evidence](docs/data-and-coverage.md).

## Refresh all offered classes

Run from the repository root. On the first run, flatten the checked-in manifest into a local working catalog:

```sh
python3 data/bootstrap/publish_catalog.py \
  --input frontend/public/data/catalog-index.json \
  --flatten artifacts/university/catalog.json
python3 data/bootstrap/update_cse_roster.py \
  --catalog artifacts/university/catalog.json
mvn -B -ntp -f backend/pom.xml verify
python3 data/bootstrap/refresh_university.py \
  --term 1272 \
  --history-term 1268 \
  --campuses ALL \
  --discover \
  --discovery-minutes 20
```

On later runs, retain `artifacts/university/` and skip the initial flatten command so previous successful discovery progress survives. The orchestrator collects all offered subjects/campuses, verifies section counts, caches build-only instructor history and processes batches of at most 40 surnames. The time budget is checked between batches, so a final batch can extend beyond it. Pending work resumes on the next run. Build-only history refreshes when missing or with `--refresh-history`; the scheduled workflow also refreshes it on Sundays.

To continue only pending searches against an already validated local snapshot:

```sh
python3 data/bootstrap/refresh_university.py \
  --term 1272 --history-term 1268 --campuses ALL \
  --skip-base --discover --discovery-minutes 20
```

A discovery budget of `0` processes the entire pending queue and can take a long time. Keep the bounded default for scheduled free-tier runs. Base collection failures stop publication. Failed surname batches keep prior data, remain pending and appear in `artifacts/university/collection.json`; they do not become false “no instructor” results. See [collection tools](data/bootstrap/README.md) and [operations](docs/operations.md).

## Verify and build

```sh
python3 -m unittest discover -s data/bootstrap -p 'test_*.py'
mvn -B -ntp -f backend/pom.xml verify
cd frontend
npm test
npm run build
npm run preview
```

CI runs these checks on pushes and pull requests. The refresh workflow builds and saves only checked output. The catalog and `data/discovery/refresh-state/` are durable Git records; the Actions cache is only an accelerator. [Manual checks](docs/operations.md) cover source comparisons, accessibility and visual behavior.

## Structure and deployment

```text
frontend/              React UI, catalog index and static catalog files
backend/               Java domain, ports, adapters and Spring Boot entry point
data/bootstrap/        Collection orchestration, roster and publication tools
data/discovery/        Reviewed identity evidence and CSE roster inputs
data/discovery/refresh-state/  Durable checked queries and refresh status
artifacts/university/  Disposable working cache and build-only instructor history
.github/workflows/     Verification and optional scheduled refresh/deployment
docs/                  Architecture, source coverage, deployment and operations
render.yaml            Optional API service blueprint
```

The backend follows [hexagonal architecture](docs/architecture.md): domain models and use cases are independent of OSU HTTP, JSON files, REST and PostgreSQL. The Python orchestrator drives the Java CLI and packages the resulting catalog for static hosting.

Use Cloudflare Pages with a free `pages.dev` address and GitHub’s standard public-repository runners for the $0/month target. The optional API, database and custom domain are separate choices. Service eligibility, quotas and storage limits still apply; [deployment and costs](docs/deployment.md) describes the setup. Running locally does not create hosting resources or publish the site.

Saved schedules stay in this browser’s local storage. Keep credentials and private student data out of the repository, and record project recovery access and a maintainer handoff plan.

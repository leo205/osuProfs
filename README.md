# Buckeye Course Guide

A student-built OSU course and instructor explorer using React, TypeScript, and a Java 21 / Spring Boot backend. It is an independent project, with public-source snapshots rather than a connection to a student's enrollment account.

The cheapest deployment serves the website and a validated catalog as static files. Java collects and normalizes OSU data; GitHub Actions can refresh it daily. Browsing does not require an always-running API or database. The Spring Boot API and PostgreSQL adapter are available when needed.

## Run locally

Install Node.js 22.21+ and npm. Java 21 and Maven 3.9+ are needed for the backend and importer, but not for the static frontend.

Refreshing the official instructor roster also uses Python 3 and curl, with no additional Python packages.

```sh
cd frontend
npm ci
npm run dev
```

Open the local URL printed by Vite, normally <http://localhost:5173>. The included `frontend/public/data/catalog.json` contains real public OSU records and collection timestamps. Search and planning work without accounts, secrets, or paid services.

For the optional API, use another terminal:

```sh
cd backend
mvn spring-boot:run
```

The API starts at <http://localhost:8080/api/health>. To use it from React, add this to `frontend/.env.local` and restart Vite:

```dotenv
VITE_API_BASE_URL=http://localhost:8080
```

React falls back to the bundled catalog if the optional API cannot be reached. `.env.example` documents backend settings; Spring Boot does not automatically load a root `.env` file.

## What this version covers

- Course and instructor search with semester, campus, and subject filtering.
- Section details, published instructor names, likely full-name matches from public instructor-search evidence, meeting times, and source links.
- Instructor profiles and RateMyProfessors links, with published assignments separated from likely identity matches.
- A local saved-section planner with meeting conflict detection and calendar export.
- Source, freshness, and coverage information beside the catalog.
- A static-first website, an HTTP API, a repeatable importer, automated checks, and optional deployment configuration.

The initial pilot covers Spring 2027 in Columbus for CSE, MATH, STAT, PHYSICS, ECE, and ENGR, with Autumn 2026 CSE for comparison. Read the current catalog's `coverage` entries for exact scope and completeness. An empty search outside this scope does not mean OSU offers no such course.

The CSE discovery pipeline searches OSU's public PeopleSoft class search by exact surname and joins current-term class numbers to the catalog. Candidates come from all available current and included historical CSE instructor records, plus reviewed seeds. Official teaching records provide full-name candidates, with the reviewed registry supplying identity and rating-link overrides. CSE 3421 classes 6248 and 36012 show **Rubao Lee — Likely match**, with official records and a RateMyProfessors link.

The surname search itself does not expose a full identity or a confirmed primary instructor; an associated instructor or coordinator may cause a match. Full names derived from official records and teaching history are explicitly **likely**, and multiple candidates stay visible without a single winner. Published names remain unchanged. An **Instructor not resolved** row means the current imports/search coverage have not identified the instructor; it does not prove the section is unassigned. Discovery covers CSE and the candidates available to this pipeline, not every university instructor. Rating pages open externally; ratings and reviews are not imported. See [data coverage and evidence](docs/data-and-coverage.md).

## Refresh the catalog

Run from the repository root:

```sh
python3 data/bootstrap/update_cse_roster.py
mvn -B -ntp -f backend/pom.xml verify
java -jar backend/target/osu-profs-0.1.0.jar \
  --spring.main.web-application-type=none \
  --app.import.enabled=true \
  --app.import.output=frontend/public/data/catalog.json \
  --app.import.term=1272 \
  --app.import.subjects=CSE,MATH,STAT,PHYSICS,ECE,ENGR \
  --app.import.campus=col \
  --app.discovery.enabled=true \
  --app.discovery.subject=CSE \
  --app.discovery.candidate-file=data/discovery/cse-surnames.txt \
  --app.discovery.identity-file=data/discovery/cse-instructor-identities.json \
  --app.discovery.include-catalog-candidates=true \
  --app.discovery.max-candidates=200
```

The roster refresh updates official CSE directory names and surname seeds while preserving curated identity/link overrides. It also loads checked-in historical Registrar course associations; runtime collection needs no PDF parser. The importer then follows course pagination, checks surnames from the full available CSE history/roster, joins official-record full-name candidates, and validates the combined result before replacing the output. A roster, catalog, discovery, or registry failure prevents deployment. Other terms and subjects remain in the snapshot. Evidence and identity-source reviews keep separate `checkedAt` values; an API refresh does not make older evidence current. Review coverage and the frontend after changing import scope or candidate limits.

## Verify and build

```sh
cd frontend
npm test
npm run build
npm run preview
```

Run `mvn -B -ntp -f backend/pom.xml verify` from the repository root for Java tests and packaging, and `python3 -m unittest discover -s data/bootstrap -p test_update_cse_roster.py` for the roster collector. `.github/workflows/ci.yml` runs these checks and the frontend checks on pushes and pull requests. [Manual checks](docs/operations.md) cover interactions and source comparisons that automated tests cannot establish.

## Structure and deployment

```text
frontend/              React UI and public catalog
backend/               Java domain, ports, adapters, Spring Boot entry point
data/                  Data contract and source bootstrap support
.github/workflows/     Build verification and optional scheduled refresh/deploy
docs/                  Architecture, data scope, deployment, operations
render.yaml            Optional free API service blueprint
```

The backend follows hexagonal architecture: its domain and use cases are separated from OSU HTTP, JSON storage, REST, and PostgreSQL adapters. See [architecture](docs/architecture.md).

Start with Cloudflare Pages on a free `pages.dev` address and GitHub's free standard public-repository runners. Render and Neon are optional. **The $0/month target depends on service eligibility, quotas, and staying on free plans.** No hosting account, domain, paid plan, deployment, or external publication is created by running this project locally. See [deployment and costs](docs/deployment.md) for exact setup and limits.

Saved sections live in this browser's local storage. They are not synced or backed up to a user account. Do not commit credentials or private student information. Before public launch, put the repository and hosting under shared ownership and assign at least two maintainers; see [operations](docs/operations.md).

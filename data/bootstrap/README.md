# Verified starter data

The checked-in `frontend/public/data/catalog.json` contains public Ohio State
Class Search API results fetched on **2026-10-20**, not synthetic demo records.
The Java backend is the production importer; `fetch_catalog.py` is a small
standard-library-only bootstrap utility used to establish and inspect the API
contract while building the application.

The application now also includes independently verified PeopleSoft surname
discoveries, documented in `data/discovery/README.md`. This bootstrap utility
produces the **base API snapshot only**. Use a temporary `--output` path when
inspecting fresh base data so you do not replace those enrichment annotations;
use the Java importer for the normal refresh and discovery workflow.

| Term | Campus | Subjects | Courses | Sections | Sections with a published instructor |
| --- | --- | --- | ---: | ---: | ---: |
| Spring 2027 (`1272`) | Columbus | CSE, MATH, STAT, PHYSICS, ECE, ENGR | 492 | 3,727 | 2,276 |
| Autumn 2026 (`1268`) | Columbus | CSE | 131 | 1,066 | 1,033 |

All 27 source pages were downloaded. Each subject's unique section count was
checked against the API's reported `totalItems`. `coverage.complete` means that
the **listed subjects and campus** passed those checks, not that all of OSU is
included. Source assignments can change and TBA records remain unresolved.

## Reproduce the bootstrap

From the repository root with Python 3.10 or newer:

```sh
python3 data/bootstrap/fetch_catalog.py --include-autumn-cse --output /tmp/osuprofs-base-catalog.json
```

The utility fetches public HTTPS JSON, respects TLS validation, retries transient
failures, pauses between requests, and caches raw responses in
`/tmp/osuprofs-bootstrap-cache`. It atomically replaces the specified output only
after every requested subject passes completeness checks. It requires no
account, API key, or other credentials.

For a smaller development import:

```sh
python3 data/bootstrap/fetch_catalog.py --term 1272 --subject CSE --output /tmp/cse-catalog.json
```

After a successful fetch, rebuild the same selection from its raw cache:

```sh
python3 data/bootstrap/fetch_catalog.py --include-autumn-cse --offline --output /tmp/osuprofs-base-catalog.json
```

Offline rebuilds retain the source retrieval times from the raw cache files'
modification times. A cache copied by another tool must preserve those times.

## Source behavior observed

- Endpoint: `https://content.osu.edu/v2/classes/search` with `q`, `term`, `campus`,
  `subject`, and one-based `p` parameters.
- `data.totalItems` counts **sections**, not courses. Each page returns up to 200
  sections grouped into `data.courses[].course` and `sections` records. A course
  can span several pages and have more than one offering number.
- Instructors are nested under `sections[].meetings[].instructors[]`. Null-name
  entries do not identify an instructor. Names, roles, and identities are
  retained only when published. Stable instructor IDs hash the normalized
  upstream email, or the normalized name when email is unavailable.
- Enrollment status, total enrollment, and waitlist count are provided for these
  records. They are historical snapshots as of `enrollment.checkedAt`.
  **Section capacities and available-seat counts are not provided.**
  `facilityCapacity` is a room capacity and must never be used as enrollment
  capacity. The normalized `capacity` and `available` fields remain `null`.
- A few records lack full catalog metadata. The importer retains the published
  short course title, shows credits as `Not published`, and retains a coverage
  warning rather than inventing missing data.
- The official description may contain prerequisites. The structured
  `prerequisites` field remains `null` because no separate verified structured
  prerequisite field was supplied.

## Real API fixtures

- `osu-api-fixture.json`: two small source records showing a named instructor
  (CSE 4193) and an unpublished instructor (CSE 5023).
- `osu-api-missing-course-metadata-fixture.json`: MATH 5194 offering 2, whose
  course metadata lacks `title`, `campusCode`, credit units, and `offeringNumber`.
  The sections provide campus and offering identifiers. This guards against
  silently dropping records or merging distinct offerings.

These fixtures are reduced envelopes of actual public API responses. Their
pagination counts describe the fixture contents, not the live subject totals.

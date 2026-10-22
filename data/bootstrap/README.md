# Public class collection and publication

The Java backend performs source normalization, scope validation and instructor enrichment. These standard-library Python tools coordinate university collection, maintain official roster inputs and package the normalized output for static hosting. They require Python 3 and curl; Java imports also require the packaged backend JAR.

## Normal schoolwide refresh

`refresh_university.py` discovers campuses from OSU’s public term results and invokes the Java importer with `ALL` subjects for each selected campus. It checks collected section totals against source totals before/after collection. The default upcoming term is Spring 2027 (`1272`) and the build-only history term is Autumn 2026 (`1268`). Only the upcoming term is published; historical classes are excluded from the website. Use actual manifest coverage and the collection receipt for current counts.

Prepare a local working catalog once, then retain it between refreshes:

```sh
python3 data/bootstrap/publish_catalog.py \
  --input frontend/public/data/catalog-index.json \
  --flatten artifacts/university/catalog.json
python3 data/bootstrap/update_cse_roster.py \
  --catalog artifacts/university/catalog.json
mvn -B -ntp -f backend/pom.xml verify
python3 data/bootstrap/refresh_university.py \
  --term 1272 --history-term 1268 --campuses ALL \
  --discover --discovery-minutes 20
```

The default working directory is `artifacts/university/`, which is gitignored. It contains the flat working catalog, cached build-only instructor history, discovery query state, collection receipt and recent Java logs. The GitHub workflow restores and saves that directory between successful runs.

Build-only history is collected when missing or when `--refresh-history` is set. The scheduled workflow sets this flag on Sundays. `--campuses ALL` includes every campus returned by the official term; a comma-separated campus list can restrict a diagnostic import.

To continue instructor work without recollecting base classes:

```sh
python3 data/bootstrap/refresh_university.py \
  --term 1272 --history-term 1268 --campuses ALL \
  --skip-base --discover --discovery-minutes 20
```

Use `--skip-base` only with an existing validated working catalog. The search queue uses published names from upcoming and historical records for each subject, plus reviewed CSE seeds. It checks at most 40 surnames per Java batch and records successful queries with their scope’s section-ID fingerprint. Checks are reused for seven days unless that fingerprint changes. Previously unsearched queries run before changed scopes and expired queries; expired queries run oldest first, so every pending scope can advance. The time budget is checked between batches; `0` runs the whole pending queue. Source pacing remains enabled.

Failed base collection stops the refresh. Failed surname batches keep prior data, remain pending and appear in `collection.json`; they do not become negative assignment evidence. Published names, current surname evidence and inferred full-name candidates remain distinct.

## Static publication

`refresh_university.py` projects the working catalog to the upcoming term before publication. `publish_catalog.py` accepts either a flat catalog or a manifest with files; pass only the intended public-term catalog when using it directly. It verifies unique IDs, disjoint scopes and declared totals before publishing. Whole subjects are grouped into files by term/campus with a 4 MiB target; an individual file over 24 MiB fails publication. Content-hashed files are written first and the index is replaced last.

```sh
python3 data/bootstrap/publish_catalog.py \
  --input artifacts/university/catalog.json \
  --output-dir frontend/public/data
```

The website and optional Java file adapter read `frontend/public/data/catalog-index.json` and every referenced file. The combined legacy `catalog.json` is removed by publication because a university-wide file can exceed static-hosting limits. Retain the flat copy in the working directory for imports. Publish or restore an index together with all its referenced files.

## Official CSE roster and reviewed evidence

`update_cse_roster.py --catalog artifacts/university/catalog.json` follows the official CSE faculty/lecturer directory pages, merges published catalog names and preserves curated identity/rating-link overrides. Reviewed Registrar course associations load from checked-in JSON; runtime refreshes need no PDF parser. Directory entries and past teaching records create search/identity candidates, not confirmed future assignments.

The roster utility has a 2,000-surname sanity bound for its candidate pool. Search request limits are separate: schoolwide discovery splits its candidates into 40-name batches. Review unexpected roster growth before changing either bound.

## Original base-data bootstrap utility

`fetch_catalog.py` remains a small inspection utility used to establish the source contract. Its defaults cover the original limited subject set, so use the university orchestrator for full collection. It produces only base API data and cannot reproduce discovery annotations. Always use a temporary output when inspecting it:

```sh
python3 data/bootstrap/fetch_catalog.py \
  --include-autumn-cse --output /tmp/osuprofs-base-catalog.json
python3 data/bootstrap/fetch_catalog.py \
  --term 1272 --subject CSE --output /tmp/cse-catalog.json
```

It fetches public HTTPS JSON, checks TLS, retries transient failures, pauses between requests and caches raw responses in `/tmp/osuprofs-bootstrap-cache`. `--offline` rebuilds from that cache and retains retrieval timestamps from file modification times. Preserve those times when copying cache files.

## Source behavior and fixtures

- `https://content.osu.edu/v2/classes/search` returns sections grouped by course. `data.totalItems` counts sections. Courses may span pages and distinct offering numbers; section IDs and pagination totals must both be checked.
- Published instructor names/roles are nested in meeting records. Null-name entries do not identify a person. Stable instructor IDs derive from normalized upstream email or, when unavailable, normalized name.
- Base enrollment status, enrolled totals and waitlists are snapshots. A room’s `facilityCapacity` is not enrollment capacity. Stored seat capacity/availability remain unknown when the base feed omits them.
- The separate public `/v2/classes/availability` endpoint supplies current enrollment capacity, available seats and waitlist totals for a specified term/session/course/offering/section. The frontend requests it on demand through the validated `section.details.availabilityUrl`; it does not issue a seat request for every catalog row.
- Session dates, associated/automatic enrollment sections, enrollment consent, location and section attributes are retained when supplied. Missing values stay missing.
- Missing full course metadata falls back to published short titles and unknown credits, with a coverage warning. Prerequisites can remain in the official description when no verified structured field is available.

`osu-api-fixture.json` contains reduced real named/unpublished instructor records. `osu-api-missing-course-metadata-fixture.json` guards a real MATH offering with missing catalog metadata against lost records or incorrectly merged offerings. Fixture pagination totals describe fixture contents, not current university totals.

Run all collection, publisher and resume tests with:

```sh
python3 -m unittest discover -s data/bootstrap -p 'test_*.py'
```

## Durable instructor results and progress

The scheduled workflow saves verified catalog data and completed query state back to GitHub each day. `data/discovery/refresh-state/` is durable; `artifacts/university/` is a disposable working cache. Recover locally with `python3 data/bootstrap/durable_state.py restore`. After collection, publication and all required tests pass, run `python3 data/bootstrap/durable_state.py save` and commit the generated data together. The save command rejects working results that differ from the validated public catalog and strips private diagnostics from its public status file. Historical classes remain build-only inputs.

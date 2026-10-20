# Public instructor-surname discovery

The purpose of this pilot is to identify current, upcoming-semester instructor
associations that OSU's public class-search JSON feed displays as TBA. It uses
the public PeopleSoft **Instructor Last Name** search, without signing in.

## Verified result

On 2026-10-20, the public PeopleSoft form returned Spring 2027 / Columbus /
CSE 3421 classes **6248** and **36012** both without an instructor filter and
with **Instructor Last Name is exactly Lee**. An otherwise identical query
using a nonexistent surname returned no results. The two result rows, and the
public detail page for class 6248, still displayed **To be Announced**.

This establishes a current-term association with the surname **Lee**. It does
not establish a given name or the instructor's role. No identity is inferred
from an earlier semester or from a department directory.

`people-soft-1272-cse3421/` contains the baseline, positive, negative-control,
and detail evidence. `fixtures/` contains reduced HTML parser fixtures. Public
session tokens in those fixtures are replaced with a fixed test value; scripts,
cookies, and unrelated application markup are excluded.

## Expanded CSE pilot

`cse-surnames-pilot.txt` is a repeatable seed file containing 16 surnames from
actual published CSE lecture instructors in the Autumn 2026 snapshot. Historical
names are **query inputs only**. Every discovery annotation comes from a fresh
Spring 2027 exact-surname query.

The bounded pilot matched 138 current-term classes and enriched 131 sections
whose full instructors were unpublished, across 33 courses:

- 125 sections have one matched surname (`SURNAME_MATCH`).
- 6 sections have multiple matched surnames (`AMBIGUOUS`).
- 106 are lecture sections and 25 are laboratory sections.

The discovery source may match an associated instructor or coordinator. It does
not identify a verified primary professor, and multiple matches must remain
visible as ambiguous. The bounded candidate list is incomplete, so a class
without a match may still have an assignment.

`cse-surname-pilot/evidence.json` records the exact query scope, retrieval time,
returned class numbers, token-free response text, and receipt hash for each raw
response. Each positive response passed these checks before publication:

1. The server echoed Spring 2027, Columbus, CSE, and the exact requested surname.
2. The declared result count equaled the number of unique returned class IDs.
3. Every returned ID matched a section in the corresponding current-term,
   campus, and subject snapshot.
4. A broad exact-surname negative control returned no results, with its returned
   form retaining the expected semester, campus, subject, and surname operator.

The `instructors` arrays and full-name coverage totals remain unchanged.
`instructorDiscovery.checkedAt` is independent of the base section's
`lastUpdated` timestamp and the catalog's base API retrieval time.

## Reviewed full-name candidates

`cse-instructor-identities.json` maps the 16 pilot surnames to reviewed CSE
instructor identities, using the same IDs and published full names already
present in the catalog. Each identity includes an official OSU profile, source
URLs, a review timestamp, and a RateMyProfessors link. No ratings are copied or
inferred. The snapshot now includes these people in
`instructorDiscovery.fullNameMatches`, explicitly classified as **LIKELY**.

For CSE 3421 classes 6248 and 36012, **Rubao Lee** is the reviewed likely
candidate. His official profile verifies his identity, and an official
2026–27 faculty announcement says that he teaches Computer Architecture this
academic year. The public current-term surname search independently verifies
Lee for those classes. These sources support a useful candidate without
establishing a directly published full-name section assignment.

The reviewed registry is curated and incomplete. It does not establish that a
surname uniquely identifies one person at OSU. In particular, Yoonkyung Lee is
another official CSE-affiliated person, with a statistics appointment, and is
documented as an alternative in `full-name-identity-review.json`. No comparable
current architecture association was found for her. The research review keeps
that distinction explicit rather than treating her identity as disproven.

The `instructors` arrays continue to contain only directly published names.
Consumers must display **Likely** alongside reviewed full-name matches and
retain all candidate matches for sections with multiple discovered surnames.

## Public form procedure

Entry point:

```text
https://courses.erppub.osu.edu/psc/ps_1/EMPLOYEE/CAMP/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL?PAGE=SSR_CLSRCH_ENTRY
```

Use one HTTP client, cookie jar, and consistent User-Agent for the entire
anonymous session. Preserve the form's hidden fields and selected options,
including the current `ICSID` and `ICStateNum`, across normal form actions.
Session tokens must not be checked into source control.

1. GET the public entry form.
2. POST its successful controls to the form action, setting:

   ```text
   ICAction=DERIVED_CLSRCH_SSR_EXPAND_COLLAPS$149$$2
   CLASS_SRCH_WRK2_STRM$35$=1272
   SSR_CLSRCH_WRK_CAMPUS$0=COL
   ```

3. Parse the newly returned expanded form. POST its current successful controls,
   setting:

   ```text
   ICAction=CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH
   SSR_CLSRCH_WRK_SUBJECT_SRCH$1=CSE
   SSR_CLSRCH_WRK_SSR_EXACT_MATCH1$2=E
   SSR_CLSRCH_WRK_CATALOG_NBR$2=
   SSR_CLSRCH_WRK_SSR_OPEN_ONLY$chk$4=N
   SSR_CLSRCH_WRK_SSR_EXACT_MATCH2$8=E
   SSR_CLSRCH_WRK_LAST_NAME$8=Lee
   ```

   Omit the unchecked checkbox `SSR_CLSRCH_WRK_SSR_OPEN_ONLY$4`. Leave the course
   number empty to search all CSE, or supply `3421` for the narrow proof.

4. Validate the server's echoed criteria, result count, and returned class
   numbers. Class-number links have IDs such as `MTG_CLASS_NBR$0`. A valid empty
   result contains `The search returns no results that match the criteria
   specified.` and a returned search form retaining the selected criteria.

Treat login pages, token errors, warnings about result limits, unexpected
markup, and mismatched echoed criteria as failures. They are not empty results
and must not erase previously verified discoveries.

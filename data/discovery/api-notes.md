# Public OSU class-search API discovery

Checked October 20, 2026. This research does **not** establish a hidden instructor assignment for Spring 2027 CSE 3421.

## Supported public search behavior

The public [class-search JavaScript](https://classes.osu.edu/osu-mobile.js) calls `https://content.osu.edu/v2/classes/search`. Its UI exposes `q`, term, campus, subject, academic-program, academic-career, class-attribute, class-attribute-value, catalog-number, component, evening, and instruction-mode. The bundle does not expose an instructor-specific filter. The API response's filter list also has no instructor filter.

All controls below used `term=1272&campus=col&subject=cse&pagenum=200` and the stated `q` value. Subject filter values are lowercase.

| Query | Observed result |
| --- | --- |
| `3421` | Three sections: CSE 3421 class numbers **6248**, **36012**, and CSE 5421 class number 6249; all have null instructor names. |
| `Rubao` or `Lee` or `"Rubao Lee"` | Zero sections. This is only a candidate tested from the prior term, not proof of a future assignment. |
| `Rubao 3421` | The same three sections as `3421`. |
| `zzzxNoSuchInstructorControl 3421` | The same three sections as `3421`; this disproves treating the previous combined query as an instructor match. |
| `+Rubao +3421` | Zero sections. |
| `Julia Armstrong` | One section, class **6874**, with Julia Armstrong explicitly published in `meetings[].instructors[]`. |
| `+Julia +Armstrong +6874` | Only the published Julia Armstrong section 6874. |
| `+zzzxNoSuchInstructorControl +6874` | Zero sections. |

`q` indexes at least some published instructor names. Plain multiword queries use OR-like matching; a course number plus a surname is **not** sufficient evidence. The tested leading `+` syntax requires the words, as established by the positive/negative controls.

Example reproducible positive control:

```text
https://content.osu.edu/v2/classes/search?term=1272&campus=col&subject=cse&pagenum=200&q=%2BJulia+%2BArmstrong+%2B6874
```

Adding `instructor=Lee` or the negative-control name returned HTTP 500 for both; it is not a verified supported search filter. `catalog-number=3421` returned no sections, so it must not be treated as the exact course-number filter used by our own API.

## Conclusion and implementation boundary

No reliable hidden-assignment mechanism has been verified through this endpoint. Preserve the current TBA values. A separate public instructor-search result must identify the exact term and class number, exclude negative controls, and have recorded provenance before it can become an additional discovery adapter. Historical Rubao Lee assignments alone cannot identify who teaches class 6248 or 36012 in Spring 2027.

Raw public responses and the fetched frontend bundle used for this investigation are temporary research artifacts under `/private/tmp/osuprofs-api-discovery/`, not required application inputs. No authentication, credentials, or access controls were bypassed.

A subsequent bounded check queried 105 official CSE-directory candidates using required given-name and surname tokens. Three candidates matched 32 sections, all with already-published instructor names; no null-instructor section matched and neither target class number appeared. This check does not establish exhaustive faculty coverage or prove an unassigned section. The supplied directory list omitted the historical Rubao Lee name, illustrating why directory candidates cannot establish a full identity from a surname.

Separate normal public PeopleSoft form searches subsequently verified surname evidence; see `people-soft-1272-cse3421/` and `cse-surname-pilot/`. That mechanism uses a different search system and does not change the API conclusions above.

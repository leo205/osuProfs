# Expanded CSE 3521 verification

The original 16-surname pilot missed genuine current assignments. It covered
Joe Barker's two CSE 3521 sections but omitted Thomas Torku, Simon Zhang,
Rob LaTour, and Zhu. The expanded verification now has **current Spring 2027
surname evidence for all seven CSE 3521 sections**.

| Class number | Exact current-term surname match | Reviewed likely full-name candidate |
| --- | --- | --- |
| 6254 | Torku | Thomas Torku |
| 6605 | Torku | Thomas Torku |
| 10483 | Zhang | Simon Zhang |
| 10933 | Barker | Joe Barker |
| 11751 | LaTour | Rob LaTour |
| 12303 | Zhu | Zhihui Zhu |
| 36014 | Barker | Joe Barker |

Every match uses the public PeopleSoft form with term 1272, campus COL,
subject CSE, exact course number 3521, exact surname, and open-only disabled.
Returned criteria, unique class numbers, and declared result counts were
validated. The no-surname baseline returns exactly the seven classes above;
the nonsense-surname control returns none. An A–Z surname-prefix sweep also
returns all seven and led to the final Zhu match rather than relying on a
curated name list.

`ready-annotations.json` contains the seven annotations ready for the publishing
process to merge. `identity-overrides.json` supplies the four new identity
records and course-family affinities. The shared application snapshot and
identity registry were deliberately not changed by this research task.

Full given names remain reviewed **LIKELY** candidates. Public result rows
still display TBA, and a surname association can match an associated instructor
without establishing a primary teaching role. Same-course historical records
help rank identities; they do not confirm future assignments. Known same-surname
alternatives are preserved in the identity-review notes, including Ting Zhu.

The API's available Summer 2026 records supplied the LaTour search seed that
Autumn-only seeding missed. Earlier API term queries returned no matching data;
that is an availability limit, not evidence the class was absent. The official
Registrar's Spring 2026 finals report supplies additional historical course
associations in `spring2026-cse-course-associations.json`. Its CSE 3521 page was
rendered and visually checked: class 36884, course 3521, instructor Zhu,Zhihui
are aligned on the same row. The extraction preserves blank instructor cells
and printed initials and must not be treated as current-term assignment proof.

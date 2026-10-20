import { describe, expect, it } from "vitest";
import {
  calendarExport,
  findConflicts,
  minutes,
  resolveSaved,
} from "./schedule";
import type {
  Catalog,
  Course,
  Meeting,
  PlannedSection,
  SavedReference,
} from "./types";

const peopleSoftSource =
  "https://courses.erppub.osu.edu/psc/ps_1/EMPLOYEE/CAMP/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL?PAGE=SSR_CLSRCH_ENTRY";

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    days: ["MO", "WE"],
    startTime: "09:10",
    endTime: "10:05",
    building: "Dreese Laboratories",
    room: "264",
    startDate: "2027-01-11",
    endDate: "2027-01-29",
    ...overrides,
  };
}

function item(
  id: string,
  meetings = [meeting()],
  overrides: Partial<Course> = {},
): PlannedSection {
  const course: Course = {
    id: `course-${id}`,
    termCode: "1272",
    campus: "col",
    subject: "CSE",
    catalogNumber: "2421",
    title: "Systems I",
    description: "",
    credits: "4",
    career: "Undergraduate",
    prerequisites: null,
    attributes: [],
    sections: [],
    ...overrides,
  };
  const section = {
    id,
    classNumber: id,
    section: "0010",
    component: "Lecture",
    instructionMode: "In Person",
    instructors: [
      { id: "osu-example", name: "Published Instructor", role: "PI" },
    ],
    meetings,
    enrollment: {
      status: "UNKNOWN" as const,
      enrolled: null,
      capacity: null,
      waitlist: null,
      available: null,
      checkedAt: null,
    },
    sourceUrl: "https://classes.osu.edu/",
    lastUpdated: "2026-10-20T15:50:39Z",
  };
  course.sections = [section];
  return { course, section };
}

function catalog(items: PlannedSection[]): Catalog {
  return {
    schemaVersion: 1,
    generatedAt: "2026-10-20T15:50:39Z",
    source: {
      name: "Ohio State",
      url: "https://classes.osu.edu/",
      endpoint: "https://content.osu.edu/v2/classes/search",
    },
    terms: [{ code: "1272", label: "Spring 2027" }],
    campuses: [{ code: "col", label: "Columbus" }],
    subjects: [{ code: "CSE", label: "Computer Science and Engineering" }],
    coverage: [],
    courses: items.map((item) => item.course),
  };
}

function reference(value: PlannedSection): SavedReference {
  return {
    termCode: value.course.termCode,
    courseId: value.course.id,
    sectionId: value.section.id,
  };
}

describe("saved schedule references", () => {
  it("resolves the current records and reports removed sections and courses", () => {
    const saved = item("1272-6274");
    const removedSection = { ...reference(saved), sectionId: "1272-removed" };
    const removedCourse = { ...reference(saved), courseId: "course-removed" };
    const result = resolveSaved(catalog([saved]), [
      reference(saved),
      removedSection,
      removedCourse,
    ]);
    expect(result.items).toEqual([saved]);
    expect(result.missing).toEqual([removedSection, removedCourse]);
  });

  it("requires an exact term and deduplicates persisted references", () => {
    const saved = item("1272-6274");
    const wrongTerm = { ...reference(saved), termCode: "1268" };
    const result = resolveSaved(catalog([saved]), [
      reference(saved),
      reference(saved),
      wrongTerm,
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.missing).toEqual([wrongTerm]);
  });
});

describe("schedule conflicts", () => {
  it("reports one pair and the overlapping weekdays across multiple meeting records", () => {
    const left = item("a", [meeting(), meeting({ days: ["FR"] })]);
    const right = item("b", [
      meeting({ startTime: "09:45", endTime: "11:00" }),
      meeting({ days: ["FR"] }),
    ]);
    expect(findConflicts([left, right])).toEqual([
      { leftId: "a", rightId: "b", days: ["MO", "WE", "FR"] },
    ]);
  });

  it("allows adjacent classes and different weekdays", () => {
    const left = item("a");
    expect(
      findConflicts([
        left,
        item("b", [meeting({ startTime: "10:05", endTime: "11:00" })]),
      ]),
    ).toEqual([]);
    expect(
      findConflicts([left, item("c", [meeting({ days: ["TU", "TH"] })])]),
    ).toEqual([]);
  });

  it("ignores different terms and nonoverlapping sessions", () => {
    const left = item("a");
    expect(
      findConflicts([left, item("b", [meeting()], { termCode: "1268" })]),
    ).toEqual([]);
    expect(
      findConflicts([
        left,
        item("c", [
          meeting({ startDate: "2027-02-01", endDate: "2027-02-19" }),
        ]),
      ]),
    ).toEqual([]);
  });

  it("requires an actual occurrence on a shared weekday inside the intersecting dates", () => {
    const left = item("a", [
      meeting({ days: ["MO"], startDate: "2027-01-11", endDate: "2027-01-14" }),
    ]);
    const right = item("b", [
      meeting({ days: ["MO"], startDate: "2027-01-12", endDate: "2027-01-18" }),
    ]);
    expect(findConflicts([left, right])).toEqual([]);
  });

  it("does not invent conflicts for unpublished times or dates", () => {
    const left = item("a");
    expect(
      findConflicts([left, item("b", [meeting({ startTime: null })])]),
    ).toEqual([]);
    expect(
      findConflicts([left, item("c", [meeting({ startDate: null })])]),
    ).toEqual([]);
    expect(findConflicts([left, item("d", [meeting({ days: [] })])])).toEqual(
      [],
    );
  });

  it("does not report a section against itself or duplicate an already reported pair", () => {
    const left = item("a"),
      right = item("b");
    expect(findConflicts([left, left, right, right])).toEqual([
      { leftId: "a", rightId: "b", days: ["MO", "WE"] },
    ]);
  });
});

describe("calendar export", () => {
  it("describes missing instructor coverage without claiming the section is unassigned", () => {
    const value = item("unknown-instructor");
    value.section.instructors = [];
    const content = calendarExport([value]).content.replace(/\r\n[ \t]/g, "");
    expect(content).toContain(
      "Instructor not resolved in current search coverage",
    );
    expect(content).toContain("does not prove the section is unassigned.");
  });

  it("includes a likely full name and official identity source without asserting the section assignment", () => {
    const value = item("1272-6248");
    value.section.instructors = [];
    value.section.instructorDiscovery = {
      status: "SURNAME_MATCH",
      surnames: ["Lee"],
      sourceUrl: peopleSoftSource,
      checkedAt: "2026-10-20T17:30:00Z",
      method: "PEOPLESOFT_EXACT_LAST_NAME",
      fullNameMatches: [
        {
          id: "rubao",
          name: "Rubao Lee",
          surname: "Lee",
          profileUrl: "https://cse.osu.edu/people/lee.11875",
          rateMyProfessorsUrl: null,
          sourceUrls: ["https://cse.osu.edu/people/lee.11875"],
          confidence: "LIKELY",
          checkedAt: "2026-10-20T17:30:00Z",
        },
      ],
    };
    const content = calendarExport([value]).content.replace(/\r\n[ \t]/g, "");
    expect(content).toContain("Likely instructor: Rubao Lee.");
    expect(content).toContain(
      "section assignment and primary role are not confirmed.",
    );
    expect(content).toContain("https://cse.osu.edu/people/lee.11875");
    expect(content).not.toContain("Instructor surname: Rubao Lee.");
  });

  it("exports verified surname evidence without inventing a full name or primary role", () => {
    const value = item("1272-6248");
    value.section.instructors = [];
    value.section.instructorDiscovery = {
      status: "SURNAME_MATCH",
      surnames: ["Lee"],
      sourceUrl: peopleSoftSource,
      checkedAt: "2026-10-20T17:30:00Z",
      method: "PEOPLESOFT_EXACT_LAST_NAME",
    };
    const content = calendarExport([value]).content.replace(/\r\n[ \t]/g, "");
    expect(content).toContain("Instructor surname: Lee.");
    expect(content).toContain("first name and primary role are not confirmed.");
    expect(content).toContain(`Instructor evidence: ${peopleSoftSource}`);
    expect(content).not.toContain("Instructors: To be announced.");
  });

  it("exports multiple surname candidates as unresolved instead of asserting multiple instructors", () => {
    const value = item("1272-6248");
    value.section.instructors = [];
    value.section.instructorDiscovery = {
      status: "AMBIGUOUS",
      surnames: ["Lee", "Smith"],
      sourceUrl: peopleSoftSource,
      checkedAt: "2026-10-20T17:30:00Z",
      method: "PEOPLESOFT_EXACT_LAST_NAME",
    };
    const content = calendarExport([value]).content.replace(/\r\n[ \t]/g, "");
    expect(content).toContain("Instructor surname candidates: Lee / Smith.");
    expect(content).toContain("full identity remains unresolved.");
    expect(content).not.toContain("Instructors: Lee / Smith.");
  });

  it("preserves local wall times across the DST boundary with complete timezone rules", () => {
    const value = item("1272-6274", [
      meeting({ days: ["MO"], startDate: "2027-03-08", endDate: "2027-03-15" }),
    ]);
    const result = calendarExport([value]);
    expect(result.eventCount).toBe(2);
    expect(result.skippedMeetings).toBe(0);
    expect(result.content).toContain(
      "BEGIN:VTIMEZONE\r\nTZID:America/New_York",
    );
    expect(result.content).toContain("TZOFFSETFROM:-0500\r\nTZOFFSETTO:-0400");
    expect(result.content).toContain("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU");
    expect(result.content).toContain("RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU");
    expect(result.content).toContain(
      "DTSTART;TZID=America/New_York:20270308T091000",
    );
    expect(result.content).toContain(
      "DTSTART;TZID=America/New_York:20270315T091000",
    );
    expect(result.content).toContain(
      "DTEND;TZID=America/New_York:20270315T100500",
    );
    expect(result.content).toMatch(/DTSTAMP:\d{8}T\d{6}Z\r\n/);
    expect(result.content).toContain(
      "UID:1272-6274-0-20270308@buckeye-course-guide.local",
    );
    expect(result.content).toMatch(/END:VCALENDAR\r\n$/);
  });

  it("includes only meeting weekdays inside the inclusive published date range", () => {
    const result = calendarExport([
      item("a", [
        meeting({
          days: ["MO"],
          startDate: "2027-01-12",
          endDate: "2027-01-25",
        }),
      ]),
    ]);
    expect(result.eventCount).toBe(2);
    expect(result.content).not.toContain(
      "DTSTART;TZID=America/New_York:20270111",
    );
    expect(result.content).toContain(
      "DTSTART;TZID=America/New_York:20270118T091000",
    );
    expect(result.content).toContain(
      "DTSTART;TZID=America/New_York:20270125T091000",
    );
  });

  it("escapes text and folds every physical line to 75 UTF-8 octets without corrupting Unicode", () => {
    const title = "Systems, I; path\\notes\n" + "学🙂".repeat(40);
    const value = item("a", [meeting({ building: "Lab, east; wing\\A\n2" })], {
      title,
    });
    const result = calendarExport([value]);
    const unfolded = result.content.replace(/\r\n[ \t]/g, "");
    expect(unfolded).toContain(
      "SUMMARY:CSE 2421 — Systems\\, I\\; path\\\\notes\\n" + "学🙂".repeat(40),
    );
    expect(unfolded).toContain("LOCATION:Lab\\, east\\; wing\\\\A\\n2 264");
    expect(unfolded).toContain(
      "Holidays and schedule exceptions are not included",
    );
    expect(unfolded).not.toContain("\uFFFD");
    expect(
      result.content
        .split("\r\n")
        .every((line) => new TextEncoder().encode(line).length <= 75),
    ).toBe(true);
    expect(result.content.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("skips and counts unknown, invalid, and unbounded meetings while retaining valid ones", () => {
    const value = item("a", [
      meeting(),
      meeting({ startTime: null }),
      meeting({ days: [] }),
      meeting({ startDate: "2027-02-29" }),
      meeting({ endTime: "08:00" }),
      meeting({ endDate: "2030-01-01" }),
      meeting({ days: ["XX"] }),
      meeting({ startDate: "2000-01-01", endDate: "2000-01-30" }),
    ]);
    const result = calendarExport([value]);
    expect(result.eventCount).toBe(6);
    expect(result.skippedMeetings).toBe(7);
    expect((result.content.match(/BEGIN:VEVENT/g) || []).length).toBe(6);
  });

  it("exports no duplicate occurrences for repeated saved sections", () => {
    const saved = item("a");
    expect(calendarExport([saved, saved]).eventCount).toBe(6);
    expect(calendarExport([])).toMatchObject({
      eventCount: 0,
      skippedMeetings: 0,
    });
  });
});

describe("time parsing", () => {
  it("accepts only valid zero-padded 24-hour times", () => {
    expect(minutes("00:00")).toBe(0);
    expect(minutes("23:59")).toBe(1439);
    expect(minutes(null)).toBeNull();
    for (const invalid of ["9:10", "24:00", "12:60", "09:10 am", " 09:10", ""])
      expect(minutes(invalid)).toBeNull();
  });
});

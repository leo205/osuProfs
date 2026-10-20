import { describe, expect, it } from "vitest";
import {
  defaultFilters,
  emptySectionFilters,
  filterCourses,
  filtersUrl,
  hasSurnameMatch,
  instructorIndex,
  instructorLabel,
  isInstructorIdentified,
  readFilters,
  sectionMatches,
  sortSections,
} from "./catalog";
import type {
  Catalog,
  Course,
  Filters,
  Instructor,
  InstructorDiscovery,
  InstructorIdentityMatch,
  Section,
} from "./types";

const collectedAt = "2026-10-20T15:50:39Z";
const peopleSoftSource =
  "https://courses.erppub.osu.edu/psc/ps_1/EMPLOYEE/CAMP/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL?PAGE=SSR_CLSRCH_ENTRY";
const instructor = (id: string, name: string): Instructor => ({
  id,
  name,
  role: null,
});

function section(id: string, overrides: Partial<Section> = {}): Section {
  return {
    id: `1272-${id}`,
    classNumber: id,
    section: id,
    component: "Lecture",
    instructionMode: "In Person",
    instructors: [],
    meetings: [
      {
        days: ["MO"],
        startTime: "09:10",
        endTime: "10:05",
        building: "Dreese Laboratories",
        room: "0264",
        startDate: "2027-01-11",
        endDate: "2027-04-26",
      },
    ],
    enrollment: {
      status: "UNKNOWN",
      enrolled: null,
      capacity: null,
      waitlist: null,
      available: null,
      checkedAt: collectedAt,
    },
    sourceUrl: "https://classes.osu.edu/",
    lastUpdated: collectedAt,
    ...overrides,
  };
}

function course(number: string, overrides: Partial<Course> = {}): Course {
  return {
    id: `1272-col-CSE-${number}`,
    termCode: "1272",
    campus: "col",
    subject: "CSE",
    catalogNumber: number,
    title: "Introduction to programming",
    description: "",
    credits: "3",
    career: "Undergraduate",
    prerequisites: null,
    attributes: [],
    sections: [section(number)],
    ...overrides,
  };
}

function catalog(courses: Course[]): Catalog {
  return {
    schemaVersion: 1,
    generatedAt: collectedAt,
    source: {
      name: "Ohio State Class Search",
      url: "https://classes.osu.edu/",
      endpoint: "https://content.osu.edu/v2/classes/search",
    },
    terms: [
      { code: "1272", label: "Spring 2027" },
      { code: "1268", label: "Autumn 2026" },
    ],
    campuses: [{ code: "col", label: "Columbus" }],
    subjects: [
      { code: "CSE", label: "Computer Science and Engineering" },
      { code: "MATH", label: "Mathematics" },
    ],
    coverage: [],
    courses,
  };
}

const filters = (overrides: Partial<Filters> = {}): Filters => ({
  termCode: "1272",
  campus: "col",
  subject: "",
  number: "",
  instructor: "",
  query: "",
  ...overrides,
});

function discovery(
  surnames = ["Lee"],
  status: InstructorDiscovery["status"] = "SURNAME_MATCH",
): InstructorDiscovery {
  return {
    status,
    surnames,
    sourceUrl: peopleSoftSource,
    checkedAt: collectedAt,
    method: "PEOPLESOFT_EXACT_LAST_NAME",
  };
}

describe("surname discovery evidence", () => {
  it("searches likely full names and joins them to published instructor history by stable identity", () => {
    const identity: InstructorIdentityMatch = {
      id: "rubao",
      name: "Rubao Lee",
      surname: "Lee",
      profileUrl: "https://cse.osu.edu/people/lee.11875",
      rateMyProfessorsUrl: null,
      sourceUrls: ["https://cse.osu.edu/people/lee.11875"],
      confidence: "LIKELY",
      checkedAt: collectedAt,
    };
    const found = section("6248", {
      instructorDiscovery: { ...discovery(), fullNameMatches: [identity] },
    });
    const data = catalog([
      course("3421", { sections: [found] }),
      course("2431", {
        sections: [
          section("2", { instructors: [instructor("rubao", "Rubao Lee")] }),
        ],
      }),
    ]);
    expect(instructorLabel(found)).toBe("Rubao Lee");
    expect(filterCourses(data, filters({ instructor: "rubao" }))).toHaveLength(
      2,
    );
    expect(
      filterCourses(data, filters({ query: "Rubao cse3421" })).map(
        (c) => c.catalogNumber,
      ),
    ).toEqual(["3421"]);
    const indexed = instructorIndex(data, "1272", "rubao");
    expect(indexed).toHaveLength(1);
    expect(indexed[0]).toMatchObject({
      sections: 2,
      publishedSections: 1,
      likelySections: 1,
    });
  });

  it("finds a unique surname through both search fields without counting it as a full identity", () => {
    const found = section("6248", { instructorDiscovery: discovery() });
    const data = catalog([
      course("3421", { sections: [found, section("36012")] }),
    ]);
    expect(hasSurnameMatch(found)).toBe(true);
    expect(instructorLabel(found)).toBe("Lee");
    expect(
      filterCourses(data, filters({ instructor: "lee" }), {
        ...emptySectionFilters,
        namedOnly: true,
      }),
    ).toEqual([]);
    expect(isInstructorIdentified(found)).toBe(false);
    expect(
      filterCourses(data, filters({ instructor: "lee" }))[0].sections.map(
        (s) => s.classNumber,
      ),
    ).toEqual(["6248"]);
    expect(
      filterCourses(data, filters({ query: "LEE cse3421" })).map(
        (c) => c.catalogNumber,
      ),
    ).toEqual(["3421"]);
    expect(instructorIndex(data, "1272")).toEqual([]);
  });

  it("keeps ambiguous surnames searchable without declaring an identified instructor", () => {
    const ambiguous = section("6248", {
      instructorDiscovery: discovery(["Lee", "Smith"], "AMBIGUOUS"),
    });
    const data = catalog([course("3421", { sections: [ambiguous] })]);
    expect(instructorLabel(ambiguous)).toBe("Lee / Smith");
    expect(isInstructorIdentified(ambiguous)).toBe(false);
    expect(filterCourses(data, filters({ instructor: "smith" }))).toHaveLength(
      1,
    );
    expect(
      filterCourses(data, filters(), {
        ...emptySectionFilters,
        namedOnly: true,
      }),
    ).toEqual([]);
  });

  it("requires one distinct nonempty surname for a unique match and preserves a published full name", () => {
    expect(
      hasSurnameMatch(
        section("1", { instructorDiscovery: discovery(["Lee", "Smith"]) }),
      ),
    ).toBe(false);
    expect(
      hasSurnameMatch(section("1", { instructorDiscovery: discovery([" "]) })),
    ).toBe(false);
    expect(
      hasSurnameMatch(
        section("1", { instructorDiscovery: discovery(["Lee", " lee "]) }),
      ),
    ).toBe(true);
    const published = section("1", {
      instructors: [instructor("lee", "Jordan Lee")],
      instructorDiscovery: discovery(),
    });
    expect(instructorLabel(published)).toBe("Jordan Lee");
    expect(isInstructorIdentified(published)).toBe(true);
  });
});

describe("course and section search", () => {
  it("matches a catalog-number prefix without treating a prerequisite mention as that course", () => {
    const data = catalog([
      course("3901", { description: "Prereq: CSE 2221 and 2231." }),
      course("2221"),
      course("2221.01"),
      course("12221"),
    ]);

    expect(
      filterCourses(data, filters({ subject: "CSE", number: "2221" })).map(
        (item) => item.catalogNumber,
      ),
    ).toEqual(["2221", "2221.01"]);
  });

  it("requires instructor and meeting/component filters to match the same section", () => {
    const alice = instructor("alice", "Alice Adams");
    const bob = instructor("bob", "Bob Brown");
    const tuesday = [
      {
        days: ["TU"],
        startTime: "09:10",
        endTime: "10:05",
        building: null,
        room: null,
        startDate: "2027-01-11",
        endDate: "2027-04-26",
      },
    ];
    const splitMatch = course("2421", {
      sections: [
        section("10", { instructors: [alice] }),
        section("11", { instructors: [bob], meetings: tuesday }),
        section("12", {
          instructors: [alice],
          meetings: tuesday,
          component: "Laboratory",
        }),
      ],
    });
    const exactMatch = course("2431", {
      sections: [
        section("20", { instructors: [alice], meetings: tuesday }),
        section("21", { instructors: [bob], meetings: tuesday }),
      ],
    });

    const result = filterCourses(
      catalog([splitMatch, exactMatch]),
      filters({ instructor: "Alice" }),
      { ...emptySectionFilters, day: "TU", component: "Lecture" },
    );

    expect(result.map((item) => item.catalogNumber)).toEqual(["2431"]);
    expect(result[0].sections.map((item) => item.classNumber)).toEqual(["20"]);
    expect(exactMatch.sections).toHaveLength(2);
  });

  it("matches all free-text tokens regardless of order, case, whitespace, or accents", () => {
    const data = catalog([
      course("2221", {
        title: "Introduction to software",
        sections: [
          section("1", { instructors: [instructor("garcia", "María García")] }),
        ],
      }),
      course("2231", {
        title: "Introduction to software",
        sections: [
          section("2", { instructors: [instructor("smith", "John Smith")] }),
        ],
      }),
    ]);

    expect(
      filterCourses(
        data,
        filters({ query: "  GARCIA   cse2221 INTRODUCTION " }),
      ).map((item) => item.catalogNumber),
    ).toEqual(["2221"]);
    expect(
      filterCourses(data, filters({ query: "García missing-token" })),
    ).toEqual([]);
    expect(
      filterCourses(data, filters({ instructor: "  MARIA garcia " })).map(
        (item) => item.catalogNumber,
      ),
    ).toEqual(["2221"]);
  });

  it("keeps unknown status visible when hiding closed sections", () => {
    const unknown = section("1");
    const closed = section("2", {
      enrollment: { ...unknown.enrollment, status: "CLOSED" },
    });
    const waiting = section("3", {
      enrollment: { ...unknown.enrollment, status: "WAITLIST" },
    });
    const hiddenClosed = { ...emptySectionFilters, hideClosed: true };

    expect(sectionMatches(unknown, hiddenClosed)).toBe(true);
    expect(sectionMatches(waiting, hiddenClosed)).toBe(true);
    expect(sectionMatches(closed, hiddenClosed)).toBe(false);
    expect(
      filterCourses(
        catalog([course("2421", { sections: [unknown, closed, waiting] })]),
        filters(),
        hiddenClosed,
      )[0].sections.map((item) => item.classNumber),
    ).toEqual(["1", "3"]);
  });

  it("indexes a published instructor once and counts distinct sections across courses", () => {
    const person = instructor("garcia", "María García");
    const shared = section("1", { instructors: [person] });
    const data = catalog([
      course("2221", {
        sections: [shared, section("2", { instructors: [person] })],
      }),
      course("2231", { sections: [shared] }),
      course("2421"),
      course("2221", {
        id: "1268-col-CSE-2221",
        termCode: "1268",
        sections: [section("old", { instructors: [person] })],
      }),
    ]);

    const result = instructorIndex(data, "1272", "garcia");

    expect(result).toHaveLength(1);
    expect(result[0].instructor).toEqual(person);
    expect(result[0].sections).toBe(2);
    expect(result[0].courses.map((item) => item.catalogNumber)).toEqual([
      "2221",
      "2231",
    ]);
  });
});

describe("section ordering", () => {
  it("places missing instructors last, keeps their relative order, and leaves the input unchanged", () => {
    const rows = [
      section("9"),
      section("2", { instructors: [instructor("zoe", "Zoe Zhang")] }),
      section("3"),
      section("1", { instructors: [instructor("ada", "Ada Adams")] }),
    ];

    expect(
      sortSections(rows, "instructor").map((item) => item.classNumber),
    ).toEqual(["1", "2", "9", "3"]);
    expect(rows.map((item) => item.classNumber)).toEqual(["9", "2", "3", "1"]);
  });

  it("ranks unknown availability between waitlisted and closed and sorts tied section numbers numerically", () => {
    const unknown = section("10");
    const rows = [
      section("1", { enrollment: { ...unknown.enrollment, status: "CLOSED" } }),
      unknown,
      section("2"),
      section("3", {
        enrollment: { ...unknown.enrollment, status: "WAITLIST" },
      }),
      section("4", { enrollment: { ...unknown.enrollment, status: "OPEN" } }),
    ];

    expect(
      sortSections(rows, "status").map((item) => item.classNumber),
    ).toEqual(["4", "3", "2", "10", "1"]);
  });
});

describe("shareable filters", () => {
  it("preserves explicit empty filters instead of restoring the default CSE course", () => {
    const defaults = defaultFilters(catalog([course("2421")]));
    expect(defaults.subject).toBe("CSE");
    expect(defaults.number).toBe("2421");
    const allSubjects = filters({
      campus: "",
      subject: "",
      number: "",
      instructor: "",
      query: "",
    });
    const url = filtersUrl(allSubjects, "search");

    expect(new URLSearchParams(url).has("subject")).toBe(true);
    expect(new URLSearchParams(url).has("number")).toBe(true);
    expect(readFilters(url, defaults)).toEqual({
      view: "search",
      filters: allSubjects,
    });
  });

  it("round-trips encoded instructor and query characters along with term and view", () => {
    const selected = filters({
      termCode: "1268",
      subject: "MATH",
      number: "2",
      instructor: "María García & Lee",
      query: "C++ / matrices?",
    });

    expect(readFilters(filtersUrl(selected, "instructors"), filters())).toEqual(
      { view: "instructors", filters: selected },
    );
  });
});

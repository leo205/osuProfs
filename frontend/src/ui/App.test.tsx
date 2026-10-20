// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  Catalog,
  Course,
  Instructor,
  InstructorIdentityMatch,
  InstructorDiscovery,
  Section,
} from "../domain/types";
import App from "./App";

const collectedAt = "2026-10-20T15:50:39Z";
const peopleSoftSource =
  "https://courses.erppub.osu.edu/psc/ps_1/EMPLOYEE/CAMP/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL?PAGE=SSR_CLSRCH_ENTRY";
const storageKey = "buckeye-course-guide.schedule.v1";
const publishedInstructor: Instructor = {
  id: "sample-garcia",
  name: "María García",
  role: null,
};
const autumnInstructor: Instructor = {
  id: "sample-autumn",
  name: "Autumn Instructor",
  role: null,
};
const likelyLee: InstructorIdentityMatch = {
  id: "osu-15e89628d1decde0",
  name: "Rubao Lee",
  surname: "Lee",
  profileUrl: "https://cse.osu.edu/people/lee.11875",
  rateMyProfessorsUrl: "https://www.ratemyprofessors.com/professor/3154645",
  sourceUrls: ["https://cse.osu.edu/people/lee.11875"],
  confidence: "LIKELY",
  checkedAt: collectedAt,
};
const likelyBarker: InstructorIdentityMatch = {
  id: "osu-93474027e7972049",
  name: "Joe Barker",
  surname: "Barker",
  profileUrl: "https://cse.osu.edu/people/barker.348",
  rateMyProfessorsUrl: "https://www.ratemyprofessors.com/professor/1628244",
  sourceUrls: ["https://cse.osu.edu/people/barker.348"],
  confidence: "LIKELY",
  checkedAt: collectedAt,
};

function section(
  classNumber: string,
  sectionNumber: string,
  instructors: Instructor[] = [],
  term = "1272",
): Section {
  return {
    id: `${term}-${classNumber}`,
    classNumber,
    section: sectionNumber,
    component: "Lecture",
    instructionMode: "In Person",
    instructors,
    meetings: [
      {
        days: ["MO", "WE"],
        startTime: "09:10",
        endTime: "10:05",
        building: "Dreese Laboratories",
        room: "0264",
        startDate: term === "1272" ? "2027-01-11" : "2026-08-25",
        endDate: term === "1272" ? "2027-04-26" : "2026-12-09",
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
  };
}

function course(
  number: string,
  title: string,
  sections: Section[],
  term = "1272",
  description = "",
): Course {
  return {
    id: `${term}-col-CSE-${number}`,
    termCode: term,
    campus: "col",
    subject: "CSE",
    catalogNumber: number,
    title,
    description,
    credits: "4",
    career: "Undergraduate",
    prerequisites: null,
    attributes: [],
    sections,
  };
}

// Deliberately small synthetic records exercise the same public catalog contract.
const pilot: Catalog = {
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
  subjects: [{ code: "CSE", label: "Computer Science and Engineering" }],
  campuses: [{ code: "col", label: "Columbus" }],
  coverage: [
    {
      termCode: "1272",
      campus: "col",
      subjects: ["CSE"],
      courseCount: 3,
      sectionCount: 4,
      namedInstructorSections: 2,
      complete: true,
      warnings: [],
    },
    {
      termCode: "1268",
      campus: "col",
      subjects: ["CSE"],
      courseCount: 1,
      sectionCount: 1,
      namedInstructorSections: 1,
      complete: true,
      warnings: [],
    },
  ],
  courses: [
    course("2421", "Systems I", [
      section("6274", "0001"),
      section("6275", "0002"),
    ]),
    course("2221", "Software I", [
      section("22210", "0003", [publishedInstructor]),
    ]),
    course(
      "3901",
      "Project Design",
      [section("39010", "0004", [publishedInstructor])],
      "1272",
      "Prereq: CSE 2221 and CSE 2421.",
    ),
    course(
      "2421",
      "Systems I",
      [section("8274", "0101", [autumnInstructor], "1268")],
      "1268",
    ),
  ],
};

function snapshotResponse(data: Catalog = pilot): Response {
  return {
    ok: true,
    status: 200,
    json: async () => structuredClone(data),
  } as Response;
}

function discoveredPilot(
  status: InstructorDiscovery["status"] = "SURNAME_MATCH",
  surnames = ["Lee"],
): Catalog {
  const data = structuredClone(pilot);
  const evidence: InstructorDiscovery = {
    status,
    surnames,
    sourceUrl: peopleSoftSource,
    checkedAt: collectedAt,
    method: "PEOPLESOFT_EXACT_LAST_NAME",
  };
  data.courses.push(
    course("3421", "Database Systems", [
      { ...section("6248", "0001"), instructorDiscovery: evidence },
      { ...section("36012", "0002"), instructorDiscovery: evidence },
    ]),
  );
  data.coverage[0].courseCount += 1;
  data.coverage[0].sectionCount += 2;
  return data;
}

function fullNamePilot(ambiguous = false): Catalog {
  const data = discoveredPilot(
    ambiguous ? "AMBIGUOUS" : "SURNAME_MATCH",
    ambiguous ? ["Lee", "Barker"] : ["Lee"],
  );
  data.courses
    .find((c) => c.catalogNumber === "3421")!
    .sections.forEach((s) => {
      s.instructorDiscovery!.fullNameMatches = ambiguous
        ? [likelyLee, likelyBarker]
        : [likelyLee];
    });
  return data;
}

const fetchMock = vi.fn();

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  localStorage.clear();
  vi.stubEnv("VITE_API_BASE_URL", "");
  fetchMock.mockReset().mockImplementation(async () => snapshotResponse());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  localStorage.clear();
});

async function openInitialSearch() {
  const user = userEvent.setup();
  const result = render(<App />);
  await screen.findByRole("heading", { name: "Systems I" });
  return { user, ...result };
}

describe("course planning user flows", () => {
  it("uses a likely full name consistently across rows, profiles, search, comparison, saved plans, and rating links", async () => {
    fetchMock.mockImplementation(async () => snapshotResponse(fullNamePilot()));
    window.history.replaceState(
      null,
      "",
      "?view=search&term=1272&campus=col&subject=CSE&number=3421",
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Database Systems" });
    expect(screen.getAllByRole("button", { name: "Rubao Lee" })).toHaveLength(
      2,
    );
    expect(screen.getAllByText("Likely match")).toHaveLength(2);
    expect(
      screen
        .getAllByRole("link", {
          name: "Look up Rubao Lee on RateMyProfessors",
        })[0]
        .getAttribute("href"),
    ).toBe(likelyLee.rateMyProfessorsUrl);
    await user.click(screen.getAllByRole("button", { name: "Rubao Lee" })[0]);
    let dialog = screen.getByRole("dialog", { name: "Rubao Lee" });
    expect(
      within(dialog).getByText(/identity and teaching role remain inferred/),
    ).toBeTruthy();
    expect(
      within(dialog)
        .getByRole("link", { name: "Official OSU records" })
        .getAttribute("href"),
    ).toBe(likelyLee.profileUrl);
    expect(
      within(dialog)
        .getByRole("link", { name: "RateMyProfessors" })
        .getAttribute("href"),
    ).toBe(likelyLee.rateMyProfessorsUrl);
    await user.click(
      within(dialog).getByRole("button", { name: "View sections" }),
    );
    expect(
      (screen.getByRole("textbox", { name: "Instructor" }) as HTMLInputElement)
        .value,
    ).toBe("Rubao Lee");
    expect(
      screen.getByRole("heading", { name: "Database Systems" }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Add section 0001 to comparison" }),
    );
    await user.click(screen.getByRole("button", { name: "Compare sections" }));
    dialog = screen.getByRole("dialog", {
      name: "A closer look at your options",
    });
    expect(within(dialog).getByText("Rubao Lee")).toBeTruthy();
    expect(within(dialog).getByText("Likely match")).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("button", {
        name: "Add CSE 3421 section 0001 to schedule",
      }),
    );
    await user.click(screen.getByRole("link", { name: /^My schedule/ }));
    expect(screen.getByText(/Rubao Lee · Likely match/)).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "Instructors" }));
    expect(screen.getByRole("heading", { name: "Rubao Lee" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Rubao Lee/ }));
    expect(screen.getByRole("dialog", { name: "Rubao Lee" })).toBeTruthy();
  });

  it("shows all full-name candidates for ambiguous evidence without selecting a single winner", async () => {
    fetchMock.mockImplementation(async () =>
      snapshotResponse(fullNamePilot(true)),
    );
    window.history.replaceState(
      null,
      "",
      "?view=search&term=1272&campus=col&subject=CSE&number=3421",
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Database Systems" });
    expect(screen.getAllByRole("button", { name: "Rubao Lee" })).toHaveLength(
      2,
    );
    expect(screen.getAllByRole("button", { name: "Joe Barker" })).toHaveLength(
      2,
    );
    expect(screen.getAllByText("Multiple possible matches")).toHaveLength(2);
    expect(screen.queryByText("Likely match")).toBeNull();
    expect(
      screen.getByText("0 of 2 sections with an identified instructor"),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Show details for section 0001" }),
    );
    expect(
      screen.getByText(/No single instructor identity is confirmed/),
    ).toBeTruthy();
  });

  it("shows verified surnames for CSE 3421 without a false TBA notice and exposes search provenance in details", async () => {
    fetchMock.mockImplementation(async () =>
      snapshotResponse(discoveredPilot()),
    );
    window.history.replaceState(
      null,
      "",
      "?view=search&term=1272&campus=col&subject=CSE&number=3421",
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Database Systems" });

    expect(screen.getAllByText("Lee")).toHaveLength(2);
    expect(screen.getAllByText("Surname matched in OSU search")).toHaveLength(
      2,
    );
    expect(
      screen.getByText("2 of 2 sections with an identified instructor"),
    ).toBeTruthy();
    expect(screen.queryByText("Instructor not resolved")).toBeNull();
    expect(screen.queryByText(/Assignments\s+remain TBA/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Lee" })).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Show details for section 0001" }),
    );
    expect(
      screen.getByText(/First name and teaching role not exposed\./),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Open OSU instructor search" })
        .getAttribute("href"),
    ).toBe(peopleSoftSource);
    await user.click(screen.getByRole("link", { name: "Data & sources" }));
    expect(screen.getByText("66.7%")).toBeTruthy();
    expect(
      screen.getByText("2 published names · 2 surname matches"),
    ).toBeTruthy();
  });

  it("finds discovered surnames through instructor search and includes them in identified-only results", async () => {
    fetchMock.mockImplementation(async () =>
      snapshotResponse(discoveredPilot()),
    );
    const { user } = await openInitialSearch();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await user.type(screen.getByRole("textbox", { name: "Instructor" }), "lee");
    await user.click(screen.getByRole("button", { name: "Search courses" }));
    expect(
      screen.getByRole("heading", { name: "Database Systems" }),
    ).toBeTruthy();
    expect(screen.getByText("1 course · 2 matching sections")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "More filters" }));
    await user.click(
      screen.getByRole("checkbox", { name: "Identified instructors only" }),
    );
    expect(screen.getAllByText("Lee")).toHaveLength(2);
  });

  it("displays ambiguous surname candidates without claiming a full identity or counting them as identified", async () => {
    fetchMock.mockImplementation(async () =>
      snapshotResponse(discoveredPilot("AMBIGUOUS", ["Lee", "Smith"])),
    );
    window.history.replaceState(
      null,
      "",
      "?view=search&term=1272&campus=col&subject=CSE&number=3421",
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Database Systems" });
    expect(screen.getAllByText("Lee / Smith")).toHaveLength(2);
    expect(screen.getAllByText("Multiple surname matches")).toHaveLength(2);
    expect(
      screen.getByText("0 of 2 sections with an identified instructor"),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Show details for section 0001" }),
    );
    expect(
      screen.getByText(/Full instructor identity remains unresolved\./),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Lee / Smith" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "More filters" }));
    await user.click(
      screen.getByRole("checkbox", { name: "Identified instructors only" }),
    );
    expect(
      screen.getByRole("heading", { name: "No sections match this search." }),
    ).toBeTruthy();
  });

  it("labels missing instructors as unresolved coverage instead of claiming they are unassigned", async () => {
    const { user } = await openInitialSearch();

    expect(fetchMock).toHaveBeenCalledWith(
      "/data/catalog.json",
      expect.any(Object),
    );
    expect(
      (screen.getByRole("combobox", { name: "Subject" }) as HTMLSelectElement)
        .value,
    ).toBe("CSE");
    expect(
      (
        screen.getByRole("textbox", {
          name: /^Course number/,
        }) as HTMLInputElement
      ).value,
    ).toBe("2421");
    expect(screen.getByText("1 course · 2 matching sections")).toBeTruthy();
    expect(screen.getAllByText("Instructor not resolved")).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: "Software I" })).toBeNull();
    expect(screen.queryByText(/Your next semester,/)).toBeNull();
    expect(screen.queryByText(/a little clearer\./)).toBeNull();
    expect(
      screen.queryByText(/Find your courses\. Get to know your instructors\./),
    ).toBeNull();
    expect(
      screen.queryByText("A clearer picture. An honest source."),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "About our data" })).toBeNull();
    expect(
      screen.getByRole("combobox", { name: /PLANNING FOR/i }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Show details for section 0001" }),
    );
    expect(
      screen.getByText(
        /No name found in current search coverage; this does not prove the section is unassigned\./,
      ),
    ).toBeTruthy();
    expect(screen.queryByText("No published assignment")).toBeNull();
  });

  it("labels catalog-backed identity evidence as official records instead of promising a biography profile", async () => {
    const data = structuredClone(fullNamePilot());
    const recordUrl =
      "https://content.osu.edu/v2/classes/search?term=1268&campus=col&subject=cse&q=4863";
    for (const identity of data.courses
      .flatMap((c) => c.sections)
      .flatMap((s) => s.instructorDiscovery?.fullNameMatches ?? [])) {
      identity.profileUrl = recordUrl;
      identity.sourceUrls = [recordUrl];
    }
    fetchMock.mockImplementation(async () => snapshotResponse(data));
    window.history.replaceState(
      null,
      "",
      "?view=search&term=1272&campus=col&subject=CSE&number=3421",
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Database Systems" });
    await user.click(screen.getAllByRole("button", { name: "Rubao Lee" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Rubao Lee" });
    expect(
      within(dialog)
        .getByRole("link", { name: "Official OSU records" })
        .getAttribute("href"),
    ).toBe(recordUrl);
    expect(
      within(dialog).queryByRole("link", { name: "Official OSU profile" }),
    ).toBeNull();
  });

  it("applies the course-number field without matching prerequisite mentions and clears to all subjects", async () => {
    const { user } = await openInitialSearch();
    const number = screen.getByRole("textbox", { name: /^Course number/ });
    await user.clear(number);
    await user.type(number, "2221");
    await user.click(screen.getByRole("button", { name: "Search courses" }));

    expect(screen.getByRole("heading", { name: "Software I" })).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Project Design" }),
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: "Systems I" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(screen.getByRole("heading", { name: "Systems I" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Software I" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Project Design" }),
    ).toBeTruthy();
    expect(
      (screen.getByRole("combobox", { name: "Subject" }) as HTMLSelectElement)
        .value,
    ).toBe("");
    expect((number as HTMLInputElement).value).toBe("");
    expect(new URLSearchParams(window.location.search).get("subject")).toBe("");
  });

  it("shows an empty state when identified-instructor filtering excludes TBA sections and restores them when cleared", async () => {
    const { user } = await openInitialSearch();
    await user.click(screen.getByRole("button", { name: "More filters" }));
    const namedOnly = screen.getByRole("checkbox", {
      name: "Identified instructors only",
    });
    await user.click(namedOnly);

    expect(
      screen.getByRole("heading", { name: "No sections match this search." }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Systems I" })).toBeNull();

    await user.click(namedOnly);

    expect(screen.getByRole("heading", { name: "Systems I" })).toBeTruthy();
    expect(screen.getAllByText("Instructor not resolved")).toHaveLength(2);
  });

  it("persists a saved section across remounting and removes it through My schedule", async () => {
    const { user, unmount } = await openInitialSearch();
    await user.click(
      screen.getByRole("button", {
        name: "Add CSE 2421 section 0001 to schedule",
      }),
    );
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(storageKey) ?? "[]")).toEqual([
        {
          termCode: "1272",
          courseId: "1272-col-CSE-2421",
          sectionId: "1272-6274",
        },
      ]),
    );
    await user.click(screen.getByRole("link", { name: /^My schedule/ }));
    expect(
      screen.getByRole("button", { name: "Remove CSE 2421 section 0001" }),
    ).toBeTruthy();

    unmount();
    render(<App />);
    const remove = await screen.findByRole("button", {
      name: "Remove CSE 2421 section 0001",
    });
    await user.click(remove);

    expect(
      screen.getByRole("heading", { name: "A fresh semester starts here." }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(storageKey) ?? "[]")).toEqual([]),
    );
  });

  it("compares two sections and closes the dialog with Escape while restoring focus", async () => {
    const { user } = await openInitialSearch();
    await user.click(
      screen.getByRole("button", { name: "Add section 0001 to comparison" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Add section 0002 to comparison" }),
    );
    const compare = screen.getByRole("button", { name: "Compare sections" });
    await user.click(compare);
    const dialog = screen.getByRole("dialog", {
      name: "A closer look at your options",
    });

    expect(
      within(dialog).getByRole("heading", { name: "Section 0001" }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("heading", { name: "Section 0002" }),
    ).toBeTruthy();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(compare);
    expect(document.body.style.overflow).toBe("");
  });

  it("changes semester without presenting a past instructor as the upcoming assignment", async () => {
    const { user } = await openInitialSearch();
    expect(
      screen.queryByRole("button", { name: autumnInstructor.name }),
    ).toBeNull();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /PLANNING FOR/i }),
      "1268",
    );

    expect(screen.getByRole("heading", { name: "Systems I" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: autumnInstructor.name }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Add CSE 2421 section 0101 to schedule",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("Instructor not resolved")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("term")).toBe(
      "1268",
    );
  });

  it("opens an instructor profile from the browser and follows it to that instructor’s sections", async () => {
    const { user } = await openInitialSearch();
    await user.click(screen.getByRole("link", { name: "Instructors" }));
    await user.type(
      screen.getByRole("textbox", { name: "Filter instructors by name" }),
      "garcia",
    );
    await user.click(screen.getByRole("button", { name: /María García/ }));
    const dialog = screen.getByRole("dialog", {
      name: publishedInstructor.name,
    });

    expect(
      within(dialog).getByRole("heading", { name: "Software I" }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("heading", { name: "Project Design" }),
    ).toBeTruthy();
    await user.click(
      within(dialog).getByRole("button", { name: "View sections" }),
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      (screen.getByRole("textbox", { name: "Instructor" }) as HTMLInputElement)
        .value,
    ).toBe(publishedInstructor.name);
    expect(screen.getByRole("heading", { name: "Software I" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Project Design" }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Systems I" })).toBeNull();
    expect(new URLSearchParams(window.location.search).get("instructor")).toBe(
      publishedInstructor.name,
    );
  });

  it("falls back to the published static snapshot when the optional API fails", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    fetchMock.mockRejectedValueOnce(new Error("API unavailable"));

    await openInitialSearch();

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.example.test/api/catalog",
      "/data/catalog.json",
    ]);
    expect(
      screen.getByText(
        "The API is unavailable. You’re browsing the last published snapshot.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Add CSE 2421 section 0001 to schedule",
      }),
    ).toBeTruthy();
  });
});

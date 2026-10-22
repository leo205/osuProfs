// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
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
import { clearSnapshotCache } from "../adapters/catalog";

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
  clearSnapshotCache();
  window.history.replaceState(null, "", "/");
  localStorage.clear();
  vi.stubEnv("VITE_API_BASE_URL", "");
  vi.stubEnv("VITE_CATALOG_BASE_URL", "");
  fetchMock.mockReset().mockImplementation(async () => snapshotResponse());
  vi.stubGlobal("fetch", (url: string, options: unknown) =>
    url === "/data/catalog-index.json"
      ? Promise.resolve({ ok: false, status: 404 })
      : fetchMock(url, options),
  );
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
  it("refreshes instructor names automatically when returning to an older tab without losing the saved plan", async () => {
    const { user } = await openInitialSearch();
    await user.click(
      screen.getByRole("button", {
        name: "Add CSE 2421 section 0001 to schedule",
      }),
    );
    const searchBefore = window.location.search;
    const updated = structuredClone(pilot);
    updated.courses.find(
      (course) => course.catalogNumber === "2421" && course.termCode === "1272",
    )!.sections[0].instructors = [publishedInstructor];
    fetchMock.mockImplementation(async () => snapshotResponse(updated));
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16 * 60 * 1000);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await screen.findByRole("button", {
      name: publishedInstructor.name,
      exact: true,
    });
    expect(window.location.search).toBe(searchBefore);
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toHaveLength(1);
    expect(
      screen.getByRole("button", {
        name: "Remove CSE 2421 section 0001 from schedule",
      }),
    ).toBeTruthy();
  });

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
      screen.getByText("0 of 2 sections with an identified instructor"),
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
    expect(screen.getByText("33.3%")).toBeTruthy();
    expect(
      screen.getByText("2 published · 0 likely full-name matches"),
    ).toBeTruthy();
  });

  it("finds discovered surnames through instructor search and keeps surname-only results outside full identity filtering", async () => {
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
    expect(
      screen.getByRole("heading", { name: "No sections match this search." }),
    ).toBeTruthy();
    expect(screen.queryAllByText("Lee")).toHaveLength(0);
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

describe("schoolwide browsing and section information", () => {
  it("recovers an archived-semester URL and browser history to the published upcoming term", async () => {
    const data = structuredClone(pilot);
    data.terms = data.terms.filter((term) => term.code === "1272");
    data.courses = data.courses.filter((course) => course.termCode === "1272");
    data.coverage = data.coverage.filter((scope) => scope.termCode === "1272");
    fetchMock.mockImplementation(async () => snapshotResponse(data));
    window.history.replaceState(
      null,
      "",
      "?view=search&term=1268&campus=col&subject=CSE&number=2421",
    );
    await openInitialSearch();
    expect(
      screen.getByRole("combobox", { name: "PLANNING FOR" }),
    ).toHaveProperty("value", "1272");
    expect(screen.queryByRole("option", { name: "Autumn 2026" })).toBeNull();
    expect(screen.queryByRole("button", { name: "See past term" })).toBeNull();
    expect(new URLSearchParams(window.location.search).get("term")).toBe(
      "1272",
    );
    await act(async () => {
      window.history.pushState(
        null,
        "",
        "?view=instructors&term=1268&campus=col",
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(
      screen.getByRole("combobox", { name: "PLANNING FOR" }),
    ).toHaveProperty("value", "1272");
    expect(screen.queryByRole("option", { name: "Autumn 2026" })).toBeNull();
    expect(new URLSearchParams(window.location.search).get("term")).toBe(
      "1272",
    );
  });

  it("shows all course attributes and section details, then checks live seats only on request", async () => {
    const data = structuredClone(pilot);
    const course = data.courses[0];
    course.attributes = ["Writing", "Honors", "Service learning"];
    const target = course.sections[0];
    target.instructors = [
      { id: "teacher", name: "Alex Rivera", role: "Primary instructor" },
      { id: "assistant", name: "Jordan Chen", role: "Teaching assistant" },
    ];
    const availabilityUrl =
      "https://content.osu.edu/v2/classes/availability?termCode=1272&sessionCode=7W1&courseOfferingNumber=1&courseId=1234&classSection=0001";
    target.details = {
      sessionCode: "7W1",
      sessionDescription: "First 7 weeks",
      startDate: "2027-01-11",
      endDate: "2027-03-05",
      associatedClass: "101",
      consent: "Department consent",
      primaryInstructorSection: "0001",
      location: "Columbus",
      availabilityUrl,
      autoEnrollSections: ["0002"],
      attributes: ["Honors section"],
    };
    fetchMock.mockImplementation(async (url: string) =>
      url === availabilityUrl
        ? {
            ok: true,
            json: async () => ({
              status: "success",
              data: {
                availability: {
                  enrollmentStatus: "Open",
                  enrollmentCapacity: 25,
                  enrollmentTotal: 12,
                  availableSeats: 13,
                  waitlistCapacity: 999,
                  waitlistTotal: 0,
                },
              },
            }),
          }
        : snapshotResponse(data),
    );
    const { user } = await openInitialSearch();
    expect(screen.getByText("Service learning")).toBeTruthy();
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain(
      availabilityUrl,
    );
    await user.click(
      screen.getByRole("button", { name: "Show details for section 0001" }),
    );
    expect(screen.getByText("First 7 weeks")).toBeTruthy();
    expect(screen.getByText("Department consent")).toBeTruthy();
    expect(screen.getByText("Jordan Chen · Teaching assistant")).toBeTruthy();
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain(
      availabilityUrl,
    );
    await user.click(
      screen.getByRole("button", { name: "Check current seats" }),
    );
    await screen.findByText("12 / 25");
    expect(screen.getByText("13")).toBeTruthy();
    expect(screen.getByText("0 / 999")).toBeTruthy();
    expect(
      screen.getByText(/Checked .*Verify in BuckeyeLink before enrolling/),
    ).toBeTruthy();
    expect(data.courses[0].sections[0].enrollment.capacity).toBeNull();
    fetchMock.mockImplementation(async () => {
      throw new Error("Seat service unavailable");
    });
    await user.click(
      screen.getByRole("button", { name: "Check current seats" }),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Seat service unavailable",
    );
    expect(screen.getByText("12 / 25")).toBeTruthy();
  });

  it("offers every campus, shows campus names, and preserves an all-campus shared search", async () => {
    const data = structuredClone(pilot);
    const lima = structuredClone(data.courses[0]);
    lima.id = "1272-lim-CSE-2421";
    lima.campus = "lim";
    lima.title = "Systems I at Lima";
    lima.sections = [
      section("90001", "0900", [
        { id: "lima-person", name: "Taylor Lima", role: "Instructor" },
      ]),
    ];
    data.courses.push(lima);
    data.campuses.push({ code: "lim", label: "Lima" });
    data.coverage.push({
      ...data.coverage[0],
      campus: "lim",
      courseCount: 1,
      sectionCount: 1,
      namedInstructorSections: 1,
    });
    fetchMock.mockImplementation(async () => snapshotResponse(data));
    window.history.replaceState(
      null,
      "",
      "?view=search&term=1272&campus=&subject=CSE&number=2421",
    );
    const { user } = await openInitialSearch();
    expect(screen.getByRole("combobox", { name: "Campus" })).toHaveProperty(
      "value",
      "",
    );
    expect(
      screen.getByRole("heading", { name: "Systems I at Lima" }),
    ).toBeTruthy();
    expect(screen.getAllByText("Lima").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("link", { name: "Instructors" }));
    expect(screen.getByRole("button", { name: /Taylor Lima/ })).toBeTruthy();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Instructor campus" }),
      "col",
    );
    expect(screen.queryByRole("button", { name: /Taylor Lima/ })).toBeNull();
    expect(screen.getByRole("button", { name: /María García/ })).toBeTruthy();
  });

  it("keeps the instructor directory bounded to 24 profiles per page and resets pagination for a search", async () => {
    const data = structuredClone(pilot);
    const section = data.courses[0].sections[0];
    section.instructors = Array.from({ length: 30 }, (_, i) => ({
      id: `person-${i}`,
      name: `Professor ${String(i).padStart(2, "0")}`,
      role: null,
    }));
    fetchMock.mockImplementation(async () => snapshotResponse(data));
    const { user } = await openInitialSearch();
    await user.click(screen.getByRole("link", { name: "Instructors" }));
    expect(document.querySelectorAll(".instructor-card")).toHaveLength(24);
    expect(screen.queryByRole("button", { name: /Professor 29/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Next instructors" }));
    expect(document.querySelectorAll(".instructor-card")).toHaveLength(7);
    expect(screen.queryByRole("button", { name: /Professor 00/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Professor 29/ })).toBeTruthy();
    await user.type(
      screen.getByRole("textbox", { name: "Filter instructors by name" }),
      "Professor 00",
    );
    expect(document.querySelectorAll(".instructor-card")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Professor 00/ })).toBeTruthy();
    expect(
      screen.queryByRole("navigation", { name: "Instructor pages" }),
    ).toBeNull();
  });
});

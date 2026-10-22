import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  clearSnapshotCache,
  loadCatalog,
  validateCatalog,
  validateCatalogIndex,
} from "./catalog";
import { collectedAt } from "../domain/catalog";
import type { Catalog, CodeLabel } from "../domain/types";

function publishedCatalog(): Catalog {
  const indexUrl = new URL(
    "../../public/data/catalog-index.json",
    import.meta.url,
  );
  if (!existsSync(indexUrl))
    return JSON.parse(
      readFileSync(
        new URL("../../public/data/catalog.json", import.meta.url),
        "utf8",
      ),
    ) as Catalog;
  const index = validateCatalogIndex(
    JSON.parse(readFileSync(indexUrl, "utf8")),
  );
  const shards = index.catalogs.map(
    (shard) =>
      JSON.parse(
        readFileSync(
          new URL(`../../public${shard.url}`, import.meta.url),
          "utf8",
        ),
      ) as Catalog,
  );
  const labels = (kind: "terms" | "subjects" | "campuses"): CodeLabel[] => [
    ...new Map(
      shards.flatMap((shard) =>
        shard[kind].map((item) => [item.code, item] as const),
      ),
    ).values(),
  ];
  return {
    ...shards[0],
    generatedAt: index.generatedAt,
    terms: labels("terms"),
    subjects: labels("subjects"),
    campuses: labels("campuses"),
    coverage: shards.flatMap((shard) => shard.coverage),
    courses: shards.flatMap((shard) => shard.courses),
  };
}
const fullCatalog = publishedCatalog();
// Exercise transport/fallback behavior with a bounded real-data subset. The
// complete schoolwide files still receive integrity and manifest checks below.
function behaviorFixture(): Catalog {
  const courses = fullCatalog.courses.filter(
    (course) =>
      course.campus === "col" &&
      ((course.subject === "CSE" &&
        ["2421", "3421", "3521"].includes(course.catalogNumber)) ||
        (course.subject === "MATH" && course.catalogNumber === "1151")),
  );
  const grouped = new Map<string, typeof courses>();
  for (const course of courses) {
    const key = `${course.termCode}/${course.campus}`;
    grouped.set(key, [...(grouped.get(key) ?? []), course]);
  }
  return {
    ...fullCatalog,
    courses,
    coverage: [...grouped.values()].map((group) => ({
      termCode: group[0].termCode,
      campus: group[0].campus,
      subjects: [...new Set(group.map((course) => course.subject))],
      courseCount: group.length,
      sectionCount: group.reduce(
        (count, course) => count + course.sections.length,
        0,
      ),
      namedInstructorSections: group
        .flatMap((course) => course.sections)
        .filter((section) => section.instructors.length).length,
      complete: true,
      warnings: [],
    })),
  };
}
const behaviorCatalog = behaviorFixture();
function response(catalog: unknown) {
  return { ok: true, status: 200, json: async () => catalog };
}
const missingIndex = { ok: false, status: 404 };
function legacyFetch(handler: (url: string) => unknown) {
  return vi.fn(async (url: string) =>
    url === "/data/catalog-index.json" ? missingIndex : handler(url),
  );
}
beforeEach(() => {
  clearSnapshotCache();
  vi.stubEnv("VITE_CATALOG_BASE_URL", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("published catalog integrity", () => {
  it("loads the actual published manifest and every referenced file as one upcoming-semester catalog", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const file = new URL(`../../public${url}`, import.meta.url);
        if (!existsSync(file)) return { ok: false, status: 404 };
        return response(JSON.parse(readFileSync(file, "utf8")));
      }),
    );
    const result = await loadCatalog();
    expect(result.catalog.courses).toHaveLength(fullCatalog.courses.length);
    expect(result.catalog.coverage).toHaveLength(fullCatalog.coverage.length);
    expect(result.catalog.terms).toHaveLength(1);
    expect(
      result.catalog.courses.every(
        (course) => course.termCode === result.catalog.terms[0].code,
      ),
    ).toBe(true);
  });

  it("retains current instructor-search evidence for every reported CSE 3521 section", () => {
    const course = fullCatalog.courses.find(
      (c) =>
        c.termCode === "1272" &&
        c.campus === "col" &&
        c.subject === "CSE" &&
        c.catalogNumber === "3521",
    );
    const expected = new Map([
      ["6254", "Torku"],
      ["6605", "Torku"],
      ["10483", "Zhang"],
      ["10933", "Barker"],
      ["36014", "Barker"],
      ["11751", "LaTour"],
      ["12303", "Zhu"],
    ]);
    expect(course).toBeDefined();
    for (const [classNumber, surname] of expected) {
      const section = course!.sections.find(
        (s) => s.classNumber === classNumber,
      );
      expect(section, `CSE 3521 class ${classNumber}`).toBeDefined();
      expect(
        section!.instructorDiscovery?.surnames,
        `evidence for CSE 3521 class ${classNumber}`,
      ).toContain(surname);
      expect(
        section!.instructorDiscovery?.fullNameMatches?.length,
      ).toBeGreaterThan(0);
    }
    const zhu = course!.sections.find((s) => s.classNumber === "12303")!;
    expect(
      zhu.instructorDiscovery!.fullNameMatches!.map(
        (candidate) => candidate.name,
      ),
    ).toContain("Zhihui Zhu");
    expect(zhu.instructors).toEqual([]);
  });

  it("validates the real published snapshot and every declared scope total", () => {
    expect(validateCatalog(fullCatalog)).toBe(fullCatalog);
    for (const scope of fullCatalog.coverage) {
      const courses = fullCatalog.courses.filter(
        (c) =>
          c.termCode === scope.termCode &&
          c.campus === scope.campus &&
          scope.subjects.includes(c.subject),
      );
      expect(courses.length).toBe(scope.courseCount);
      const sections = courses.flatMap((c) => c.sections);
      expect(sections.length).toBe(scope.sectionCount);
      expect(sections.filter((s) => s.instructors.length > 0).length).toBe(
        scope.namedInstructorSections,
      );
      expect(
        sections.every(
          (s) =>
            s.enrollment.available === null && s.enrollment.capacity === null,
        ),
      ).toBe(true);
    }
  });
  it("rejects an invalid schema instead of rendering unreliable records", () => {
    expect(() =>
      validateCatalog({ ...fullCatalog, schemaVersion: 99 }),
    ).toThrow();
    expect(() =>
      validateCatalog({ ...fullCatalog, generatedAt: "not a timestamp" }),
    ).toThrow();
    expect(() =>
      validateCatalog({ ...fullCatalog, courses: [{ id: "broken" }] }),
    ).toThrow();
  });
  it("does not relabel an untouched semester as fresh after a partial import", () => {
    const catalog = {
      ...fullCatalog,
      generatedAt: new Date(
        Date.parse(fullCatalog.generatedAt) + 86400000,
      ).toISOString(),
    };
    expect(
      Date.parse(collectedAt(catalog, fullCatalog.terms[0].code)),
    ).toBeLessThan(Date.parse(catalog.generatedAt));
  });
  it("contains verified Lee evidence for both requested CSE 3421 sections", () => {
    const course = fullCatalog.courses.find(
      (c) =>
        c.termCode === "1272" &&
        c.campus === "col" &&
        c.subject === "CSE" &&
        c.catalogNumber === "3421",
    );
    expect(course?.sections.map((s) => s.classNumber).sort()).toEqual([
      "36012",
      "6248",
    ]);
    for (const section of course!.sections) {
      expect(section.instructors).toEqual([]);
      expect(section.instructorDiscovery?.surnames).toEqual(["Lee"]);
      expect(section.instructorDiscovery?.status).toBe("SURNAME_MATCH");
      expect(
        section.instructorDiscovery?.fullNameMatches?.map(
          (candidate) => candidate.name,
        ),
      ).toEqual(["Rubao Lee"]);
      expect(section.instructorDiscovery?.fullNameMatches?.[0].confidence).toBe(
        "LIKELY",
      );
    }
  });
  it("rejects malformed or unsafe discovery evidence", () => {
    const copy = structuredClone(behaviorCatalog);
    const section = copy.courses
      .flatMap((c) => c.sections)
      .find((s) => s.instructorDiscovery)!;
    section.instructorDiscovery!.sourceUrl = "javascript:alert(1)";
    expect(() => validateCatalog(copy)).toThrow();
    section.instructorDiscovery!.sourceUrl = "https://courses.erppub.osu.edu/";
    section.instructorDiscovery!.surnames = [];
    expect(() => validateCatalog(copy)).toThrow();
  });
  it("rejects unsafe full-name profile or rating links instead of displaying untrusted identity claims", () => {
    const copy = structuredClone(behaviorCatalog);
    const identity = copy.courses
      .flatMap((c) => c.sections)
      .flatMap((s) => s.instructorDiscovery?.fullNameMatches ?? [])[0];
    const original = identity.profileUrl;
    identity.profileUrl = "https://unrelated.example/profile";
    expect(() => validateCatalog(copy)).toThrow();
    identity.profileUrl = original;
    identity.rateMyProfessorsUrl = "javascript:alert(1)";
    expect(() => validateCatalog(copy)).toThrow();
  });
});

describe("static-first catalog access", () => {
  it("keeps published instructors when an equally fresh API omits their names", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const snapshot = shardFixture("CSE");
    snapshot.courses[0].sections[0].instructors = [
      { id: "person", name: "Published Person", role: "Instructor" },
    ];
    const api = structuredClone(snapshot);
    api.courses[0].sections[0].instructors = [];
    vi.stubGlobal(
      "fetch",
      legacyFetch((url) => response(url.startsWith("https:") ? api : snapshot)),
    );
    expect((await loadCatalog()).fallbackReason).toBe("older-or-partial");
  });
  it("retains section dates, linked components and availability links when an API omits section details", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const snapshot = shardFixture("CSE");
    snapshot.courses[0].sections[0].details = {
      sessionCode: "1",
      sessionDescription: "Regular session",
      startDate: "2027-01-11",
      endDate: "2027-04-26",
      associatedClass: "1",
      autoEnrollSections: [],
      consent: null,
      primaryInstructorSection: "0010",
      location: "Columbus",
      attributes: [],
      availabilityUrl:
        "https://content.osu.edu/v2/classes/availability?termCode=1272&sessionCode=1&courseOfferingNumber=1&courseId=123&classSection=0010",
    };
    const api = structuredClone(snapshot);
    delete api.courses[0].sections[0].details;
    vi.stubGlobal(
      "fetch",
      legacyFetch((url) => response(url.startsWith("https:") ? api : snapshot)),
    );
    expect((await loadCatalog()).fallbackReason).toBe("older-or-partial");
  });
  it("retains full-name evidence when the API has equally fresh surnames but omits identity candidates", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const api = structuredClone(behaviorCatalog);
    api.courses.forEach((c) =>
      c.sections.forEach((s) => {
        if (s.instructorDiscovery) delete s.instructorDiscovery.fullNameMatches;
      }),
    );
    vi.stubGlobal(
      "fetch",
      legacyFetch(async (url: string) =>
        response(url.startsWith("https:") ? api : behaviorCatalog),
      ),
    );
    expect((await loadCatalog()).fallbackReason).toBe("older-or-partial");
  });

  it("rejects older identity metadata even when the source surname checks are equally recent", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const api = structuredClone(behaviorCatalog);
    api.courses
      .flatMap((c) => c.sections)
      .flatMap((s) => s.instructorDiscovery?.fullNameMatches ?? [])
      .forEach((identity) => {
        identity.checkedAt = "2026-01-01T00:00:00Z";
      });
    vi.stubGlobal(
      "fetch",
      legacyFetch(async (url: string) =>
        response(url.startsWith("https:") ? api : behaviorCatalog),
      ),
    );
    expect((await loadCatalog()).fallbackReason).toBe("older-or-partial");
  });
  it("does not contact an optional API unless explicitly configured", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    const fetch = legacyFetch(() => response(behaviorCatalog));
    vi.stubGlobal("fetch", fetch);
    expect((await loadCatalog()).via).toBe("snapshot");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/data/catalog-index.json",
      "/data/catalog.json",
    ]);
  });
  it("retains the broader snapshot when a newer API only contains one subject", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const partial: Catalog = {
      ...behaviorCatalog,
      generatedAt: new Date(
        Date.parse(behaviorCatalog.generatedAt) + 86400000,
      ).toISOString(),
      courses: behaviorCatalog.courses.filter(
        (c) => c.subject === "CSE" && c.termCode === "1272",
      ),
      coverage: [{ ...behaviorCatalog.coverage[0], subjects: ["CSE"] }],
    };
    vi.stubGlobal(
      "fetch",
      legacyFetch(async (url: string) =>
        response(url.startsWith("https:") ? partial : behaviorCatalog),
      ),
    );
    const result = await loadCatalog();
    expect(result.catalog.courses.length).toBe(behaviorCatalog.courses.length);
    expect(result.fallbackReason).toBe("older-or-partial");
  });
  it("uses a complete, equally fresh API response when configured", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test/");
    vi.stubGlobal(
      "fetch",
      legacyFetch(() => response(behaviorCatalog)),
    );
    expect((await loadCatalog()).via).toBe("api");
  });
  it("keeps archived API semesters out of the published upcoming-semester catalog", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const snapshot = shardFixture("CSE");
    const api = structuredClone(snapshot);
    const past = structuredClone(api.courses[0]);
    past.id = "1268-col-CSE-1000";
    past.termCode = "1268";
    api.courses.push(past);
    api.terms.push({ code: "1268", label: "Autumn 2026" });
    api.coverage.push({ ...api.coverage[0], termCode: "1268" });
    vi.stubGlobal(
      "fetch",
      legacyFetch((url) => response(url.startsWith("https:") ? api : snapshot)),
    );
    const loaded = await loadCatalog();
    expect(loaded.via).toBe("api");
    expect(loaded.catalog.terms.map((term) => term.code)).toEqual(["1272"]);
    expect(
      loaded.catalog.courses.every((course) => course.termCode === "1272"),
    ).toBe(true);
    expect(
      loaded.catalog.coverage.every((scope) => scope.termCode === "1272"),
    ).toBe(true);
  });
  it("keeps surname discoveries when an API has equally fresh classes but lacks evidence", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const api = structuredClone(behaviorCatalog);
    api.courses.forEach((c) =>
      c.sections.forEach((s) => delete s.instructorDiscovery),
    );
    vi.stubGlobal(
      "fetch",
      legacyFetch(async (url: string) =>
        response(url.startsWith("https:") ? api : behaviorCatalog),
      ),
    );
    expect((await loadCatalog()).fallbackReason).toBe("older-or-partial");
  });
  it("rejects an equally fresh API that drops a section with surname evidence", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const api = structuredClone(behaviorCatalog);
    const course = api.courses.find((c) =>
      c.sections.some((s) => s.instructorDiscovery),
    )!;
    const removed = course.sections.find((s) => s.instructorDiscovery)!;
    course.sections = course.sections.filter((s) => s !== removed);
    vi.stubGlobal(
      "fetch",
      legacyFetch(async (url: string) =>
        response(url.startsWith("https:") ? api : behaviorCatalog),
      ),
    );
    expect((await loadCatalog()).fallbackReason).toBe("older-or-partial");
  });
  it("falls back to the static snapshot if the API is unavailable", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    vi.stubGlobal(
      "fetch",
      legacyFetch(async (url: string) => {
        if (url.startsWith("https:")) throw new Error("offline");
        return response(behaviorCatalog);
      }),
    );
    expect((await loadCatalog()).fallbackReason).toBe("unavailable");
  });
  it("requires the published semester boundary even when an API is available", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    vi.stubGlobal(
      "fetch",
      legacyFetch(async (url: string) => {
        if (url.startsWith("/")) throw new Error("missing");
        return response(behaviorCatalog);
      }),
    );
    await expect(loadCatalog()).rejects.toThrow(/Reload the page or try again/);
  });
});

function shardFixture(subject: string, campus = "col"): Catalog {
  const course = structuredClone(fullCatalog.courses[0]);
  course.id = `1272-${campus}-${subject}-1000`;
  course.subject = subject;
  course.termCode = "1272";
  course.campus = campus;
  course.sections = course.sections.slice(0, 1);
  return {
    ...fullCatalog,
    terms: [{ code: "1272", label: "Spring 2027" }],
    subjects: [{ code: subject, label: subject }],
    campuses: [{ code: campus, label: campus === "col" ? "Columbus" : "Lima" }],
    courses: [course],
    coverage: [
      {
        termCode: "1272",
        campus,
        subjects: [subject],
        courseCount: 1,
        sectionCount: course.sections.length,
        namedInstructorSections: course.sections.filter(
          (section) => section.instructors.length,
        ).length,
        complete: true,
        warnings: [],
      },
    ],
  };
}
function shardIndex(catalogs: Catalog[]) {
  return {
    schemaVersion: 1,
    generatedAt: fullCatalog.generatedAt,
    catalogs: catalogs.map((catalog, i) => ({
      url: `/data/shards/part-${i}.json`,
      termCode: "1272",
      campus: catalog.courses[0].campus,
      subjects: catalog.subjects.map((subject) => subject.code),
      courseCount: catalog.courses.length,
      sectionCount: catalog.courses.reduce(
        (total, course) => total + course.sections.length,
        0,
      ),
    })),
  };
}

describe("schoolwide catalog shards", () => {
  it("loads newly saved instructor names without a new frontend build and reuses unchanged files", async () => {
    const base = "https://saved.example/catalog";
    vi.stubEnv("VITE_CATALOG_BASE_URL", base);
    vi.stubEnv("VITE_API_BASE_URL", "");
    const local = shardFixture("MATH");
    local.courses[0].sections[0].instructors = [];
    const updated = structuredClone(local);
    updated.generatedAt = new Date(
      Date.parse(local.generatedAt) + 86400000,
    ).toISOString();
    updated.courses[0].sections[0].lastUpdated = updated.generatedAt;
    updated.courses[0].sections[0].instructors = [
      { id: "new-teacher", name: "Newly Published Teacher", role: "PI" },
    ];
    updated.coverage[0].namedInstructorSections = 1;
    const localIndex = shardIndex([local]);
    const liveIndex = {
      ...shardIndex([updated]),
      generatedAt: updated.generatedAt,
    };
    const fetch = vi.fn(async (url: string) =>
      response(
        url === "/data/catalog-index.json"
          ? localIndex
          : url === `${base}/data/catalog-index.json`
            ? liveIndex
            : url.startsWith(base)
              ? updated
              : local,
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const first = await loadCatalog();
    expect(first.catalog.courses[0].sections[0].instructors[0].name).toBe(
      "Newly Published Teacher",
    );
    await loadCatalog();
    expect(
      fetch.mock.calls.filter(
        ([url]) => url === `${base}${liveIndex.catalogs[0].url}`,
      ),
    ).toHaveLength(1);
    expect(
      fetch.mock.calls.filter(
        ([url]) => url === `${base}/data/catalog-index.json`,
      ),
    ).toHaveLength(2);
    fetch.mockImplementation(async (url: string) => {
      if (url.startsWith(base)) throw new Error("Network unavailable");
      return response(url === "/data/catalog-index.json" ? localIndex : local);
    });
    expect(
      (await loadCatalog()).catalog.courses[0].sections[0].instructors[0].name,
    ).toBe("Newly Published Teacher");
  });

  it("keeps saved local instructors when the remote snapshot is partial or unavailable", async () => {
    const base = "https://saved.example/catalog";
    vi.stubEnv("VITE_CATALOG_BASE_URL", base);
    vi.stubEnv("VITE_API_BASE_URL", "");
    const local = shardFixture("MATH");
    const unrelated = shardFixture("OTHER");
    unrelated.generatedAt = new Date(
      Date.parse(local.generatedAt) + 86400000,
    ).toISOString();
    unrelated.courses[0].sections[0].lastUpdated = unrelated.generatedAt;
    const localIndex = shardIndex([local]);
    const liveIndex = {
      ...shardIndex([unrelated]),
      generatedAt: unrelated.generatedAt,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        response(
          url === "/data/catalog-index.json"
            ? localIndex
            : url === `${base}/data/catalog-index.json`
              ? liveIndex
              : url.startsWith(base)
                ? unrelated
                : local,
        ),
      ),
    );
    expect((await loadCatalog()).catalog.courses[0].subject).toBe("MATH");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith(base)) throw new Error("Network unavailable");
        return response(
          url === "/data/catalog-index.json" ? localIndex : local,
        );
      }),
    );
    expect((await loadCatalog()).catalog.courses[0].subject).toBe("MATH");
  });

  it("does not download remote course files when their saved snapshot is no newer", async () => {
    const base = "https://saved.example/catalog";
    vi.stubEnv("VITE_CATALOG_BASE_URL", base);
    vi.stubEnv("VITE_API_BASE_URL", "");
    const local = shardFixture("MATH");
    const index = shardIndex([local]);
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("catalog-index.json")) return response(index);
      if (url.startsWith(base))
        throw new Error("Should not download unchanged files");
      return response(local);
    });
    vi.stubGlobal("fetch", fetch);
    await loadCatalog();
    expect(
      fetch.mock.calls.filter(([url]) => url.startsWith(base)),
    ).toHaveLength(1);
  });

  it("loads every subject and campus, merges shared metadata, and preserves instructor evidence", async () => {
    const shards = [
      shardFixture("CSE"),
      shardFixture("MATH"),
      shardFixture("CSE", "lim"),
    ];
    const index = shardIndex(shards);
    const fetch = vi.fn(async (url: string) =>
      response(
        url === "/data/catalog-index.json"
          ? index
          : shards[index.catalogs.findIndex((shard) => shard.url === url)],
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const loaded = await loadCatalog();
    expect(loaded.catalog.courses).toHaveLength(3);
    expect(loaded.catalog.subjects.map((subject) => subject.code)).toEqual([
      "CSE",
      "MATH",
    ]);
    expect(loaded.catalog.campuses.map((campus) => campus.code)).toEqual([
      "col",
      "lim",
    ]);
    expect(loaded.catalog.terms).toHaveLength(1);
    expect(loaded.catalog.courses[0].sections).toEqual(
      shards[0].courses[0].sections,
    );
    expect(fetch.mock.calls.map(([url]) => url)).not.toContain(
      "/data/catalog.json",
    );
  });

  it("fetches at most four shards concurrently", async () => {
    const shards = Array.from({ length: 9 }, (_, i) =>
      shardFixture(`SUBJ${i}`),
    );
    const index = shardIndex(shards);
    let active = 0;
    let peak = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/data/catalog-index.json") return response(index);
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active--;
        return response(
          shards[index.catalogs.findIndex((shard) => shard.url === url)],
        );
      }),
    );
    expect((await loadCatalog()).catalog.courses).toHaveLength(9);
    expect(peak).toBe(4);
  });

  it.each([
    "https://other.example/data/catalog.json",
    "//other.example/data/catalog.json",
    "/data/../secret.json",
    "/data/%2e%2e/secret.json",
    "/data/part.json?token=abc",
    "/data//part.json",
  ])("rejects an unsafe manifest URL: %s", (url) => {
    const index = shardIndex([shardFixture("CSE")]);
    index.catalogs[0].url = url;
    expect(() => validateCatalogIndex(index)).toThrow();
  });

  it("rejects overlapping subject coverage and duplicate files", () => {
    const index = shardIndex([shardFixture("CSE"), shardFixture("MATH")]);
    index.catalogs[1].subjects = ["CSE"];
    expect(() => validateCatalogIndex(index)).toThrow(/repeats/);
    index.catalogs[1].subjects = ["MATH"];
    index.catalogs[1].url = index.catalogs[0].url;
    expect(() => validateCatalogIndex(index)).toThrow(/repeats/);
  });

  it.each(["wrong-count", "wrong-campus", "wrong-subject", "duplicate-id"])(
    "rejects incomplete or inconsistent shard records: %s",
    async (failure) => {
      const shards = [shardFixture("CSE"), shardFixture("MATH")];
      const index = shardIndex(shards);
      if (failure === "wrong-count") index.catalogs[1].sectionCount++;
      if (failure === "wrong-campus") shards[1].courses[0].campus = "lim";
      if (failure === "wrong-subject") shards[1].courses[0].subject = "CHEM";
      if (failure === "duplicate-id")
        shards[1].courses[0].id = shards[0].courses[0].id;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) =>
          response(
            url === "/data/catalog-index.json"
              ? index
              : shards[index.catalogs.findIndex((shard) => shard.url === url)],
          ),
        ),
      );
      await expect(loadCatalog()).rejects.toThrow();
    },
  );

  it("fails the whole snapshot when one shard fails instead of presenting partial coverage", async () => {
    const shards = [shardFixture("CSE"), shardFixture("MATH")];
    const index = shardIndex(shards);
    const fetch = vi.fn(async (url: string) =>
      url === index.catalogs[1].url
        ? { ok: false, status: 503 }
        : response(url === "/data/catalog-index.json" ? index : shards[0]),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(loadCatalog()).rejects.toThrow(/503/);
    expect(fetch.mock.calls.map(([url]) => url)).not.toContain(
      "/data/catalog.json",
    );
  });

  it("only uses the legacy file when the index is absent, not on malformed data or a service failure", async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 503 }));
    vi.stubGlobal("fetch", fetch);
    await expect(loadCatalog()).rejects.toThrow(/503/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

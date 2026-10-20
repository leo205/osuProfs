import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { loadCatalog, validateCatalog } from "./catalog";
import { collectedAt } from "../domain/catalog";
import type { Catalog } from "../domain/types";

const fullCatalog = JSON.parse(
  readFileSync(
    new URL("../../public/data/catalog.json", import.meta.url),
    "utf8",
  ),
) as Catalog;
function response(catalog: unknown) {
  return { ok: true, json: async () => catalog };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("published catalog integrity", () => {
  it("retains current instructor-search evidence for every reported CSE 3521 section", () => {
    const course = fullCatalog.courses.find(
      (c) =>
        c.termCode === "1272" &&
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
    const catalog = { ...fullCatalog, generatedAt: "2027-01-01T00:00:00Z" };
    expect(Date.parse(collectedAt(catalog, "1268"))).toBeLessThan(
      Date.parse(catalog.generatedAt),
    );
  });
  it("contains verified Lee evidence for both requested CSE 3421 sections", () => {
    const course = fullCatalog.courses.find(
      (c) =>
        c.termCode === "1272" &&
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
    const copy = structuredClone(fullCatalog);
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
    const copy = structuredClone(fullCatalog);
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
  it("retains full-name evidence when the API has equally fresh surnames but omits identity candidates", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const api = structuredClone(fullCatalog);
    api.courses.forEach((c) =>
      c.sections.forEach((s) => {
        if (s.instructorDiscovery) delete s.instructorDiscovery.fullNameMatches;
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        response(url.startsWith("https:") ? api : fullCatalog),
      ),
    );
    expect((await loadCatalog()).fallbackReason).toBe("older-or-partial");
  });

  it("rejects older identity metadata even when the source surname checks are equally recent", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const api = structuredClone(fullCatalog);
    api.courses
      .flatMap((c) => c.sections)
      .flatMap((s) => s.instructorDiscovery?.fullNameMatches ?? [])
      .forEach((identity) => {
        identity.checkedAt = "2026-01-01T00:00:00Z";
      });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        response(url.startsWith("https:") ? api : fullCatalog),
      ),
    );
    expect((await loadCatalog()).fallbackReason).toBe("older-or-partial");
  });
  it("does not contact an optional API unless explicitly configured", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    const fetch = vi.fn().mockResolvedValue(response(fullCatalog));
    vi.stubGlobal("fetch", fetch);
    expect((await loadCatalog()).via).toBe("snapshot");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("/data/catalog.json");
  });
  it("retains the broader snapshot when a newer API only contains one subject", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const partial: Catalog = {
      ...fullCatalog,
      generatedAt: "2027-01-01T00:00:00Z",
      courses: fullCatalog.courses.filter(
        (c) => c.subject === "CSE" && c.termCode === "1272",
      ),
      coverage: [{ ...fullCatalog.coverage[0], subjects: ["CSE"] }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        response(url.startsWith("https:") ? partial : fullCatalog),
      ),
    );
    const result = await loadCatalog();
    expect(result.catalog.courses.length).toBe(fullCatalog.courses.length);
    expect(result.fallbackReason).toBe("older-or-partial");
  });
  it("uses a complete, equally fresh API response when configured", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test/");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(fullCatalog)));
    expect((await loadCatalog()).via).toBe("api");
  });
  it("keeps surname discoveries when an API has equally fresh classes but lacks evidence", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const api = structuredClone(fullCatalog);
    api.courses.forEach((c) =>
      c.sections.forEach((s) => delete s.instructorDiscovery),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        response(url.startsWith("https:") ? api : fullCatalog),
      ),
    );
    expect((await loadCatalog()).fallbackReason).toBe("older-or-partial");
  });
  it("rejects an equally fresh API that drops a section with surname evidence", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    const api = structuredClone(fullCatalog);
    const course = api.courses.find((c) =>
      c.sections.some((s) => s.instructorDiscovery),
    )!;
    const removed = course.sections.find((s) => s.instructorDiscovery)!;
    course.sections = course.sections.filter((s) => s !== removed);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        response(url.startsWith("https:") ? api : fullCatalog),
      ),
    );
    expect((await loadCatalog()).fallbackReason).toBe("older-or-partial");
  });
  it("falls back to the static snapshot if the API is unavailable", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("https:")) throw new Error("offline");
        return response(fullCatalog);
      }),
    );
    expect((await loadCatalog()).fallbackReason).toBe("unavailable");
  });
  it("can use the API if the bundled static file cannot load", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/")) throw new Error("missing");
        return response(fullCatalog);
      }),
    );
    expect((await loadCatalog()).via).toBe("api");
  });
});

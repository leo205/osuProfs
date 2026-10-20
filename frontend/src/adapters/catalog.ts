import type { Catalog, InstructorIdentityMatch } from "../domain/types";
import { collectedAt } from "../domain/catalog";

export interface LoadedCatalog {
  catalog: Catalog;
  via: "snapshot" | "api";
  fallback: boolean;
  fallbackReason?: "unavailable" | "older-or-partial";
}

function officialUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "osu.edu" ||
        url.hostname.endsWith(".osu.edu") ||
        url.hostname === "ohio-state.edu" ||
        url.hostname.endsWith(".ohio-state.edu"))
    );
  } catch {
    return false;
  }
}

function validRatingUrl(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "www.ratemyprofessors.com" &&
      (/^\/professor\/\d+\/?$/.test(url.pathname) ||
        /^\/search\/professors\/724\/?$/.test(url.pathname))
    );
  } catch {
    return false;
  }
}

function validIdentity(value: unknown): value is InstructorIdentityMatch {
  if (!value || typeof value !== "object") return false;
  const candidate = value as InstructorIdentityMatch;
  return (
    [candidate.id, candidate.name, candidate.surname].every(
      (v) => typeof v === "string" && !!v.trim(),
    ) &&
    candidate.confidence === "LIKELY" &&
    typeof candidate.checkedAt === "string" &&
    Number.isFinite(Date.parse(candidate.checkedAt)) &&
    officialUrl(candidate.profileUrl) &&
    validRatingUrl(candidate.rateMyProfessorsUrl) &&
    Array.isArray(candidate.sourceUrls) &&
    candidate.sourceUrls.length > 0 &&
    candidate.sourceUrls.every(officialUrl)
  );
}

function validDiscovery(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== "object") return false;
  const d = value as NonNullable<
    Catalog["courses"][number]["sections"][number]["instructorDiscovery"]
  >;
  if (
    d.method !== "PEOPLESOFT_EXACT_LAST_NAME" ||
    !["SURNAME_MATCH", "AMBIGUOUS"].includes(d.status) ||
    !Array.isArray(d.surnames) ||
    d.surnames.some((s) => typeof s !== "string" || !s.trim()) ||
    new Set(d.surnames.map((s) => s.trim().toLowerCase())).size !==
      d.surnames.length ||
    (d.status === "SURNAME_MATCH"
      ? d.surnames.length !== 1
      : d.surnames.length < 2) ||
    !Number.isFinite(Date.parse(d.checkedAt))
  )
    return false;
  if (
    d.fullNameMatches !== undefined &&
    d.fullNameMatches !== null &&
    (!Array.isArray(d.fullNameMatches) ||
      d.fullNameMatches.some(
        (candidate) =>
          !validIdentity(candidate) ||
          !d.surnames.some(
            (surname) =>
              surname.toLowerCase() === candidate.surname.toLowerCase(),
          ),
      ) ||
      new Set(d.fullNameMatches.map((candidate) => candidate.id)).size !==
        d.fullNameMatches.length)
  )
    return false;
  try {
    const source = new URL(d.sourceUrl);
    return (
      source.protocol === "https:" &&
      source.hostname === "courses.erppub.osu.edu"
    );
  } catch {
    return false;
  }
}

export function validateCatalog(value: unknown): Catalog {
  if (!value || typeof value !== "object")
    throw new Error("The catalog response is not an object.");
  const c = value as Catalog;
  if (
    c.schemaVersion !== 1 ||
    !Number.isFinite(Date.parse(c.generatedAt)) ||
    !Array.isArray(c.courses) ||
    !Array.isArray(c.terms) ||
    !Array.isArray(c.subjects) ||
    !Array.isArray(c.campuses) ||
    !Array.isArray(c.coverage) ||
    !c.source?.url
  ) {
    throw new Error("The catalog has an unsupported or incomplete format.");
  }
  if (
    c.courses.some(
      (course) =>
        !course.id ||
        !course.termCode ||
        !course.subject ||
        !course.catalogNumber ||
        !Array.isArray(course.sections) ||
        course.sections.some(
          (s) =>
            !s.id ||
            !Array.isArray(s.instructors) ||
            !Array.isArray(s.meetings) ||
            !s.enrollment ||
            !validDiscovery(s.instructorDiscovery),
        ),
    )
  ) {
    throw new Error("Some course or section records are incomplete.");
  }
  return c;
}

async function fetchCatalog(url: string, timeout = 6500): Promise<Catalog> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    cache: "no-cache",
  });
  if (!response.ok)
    throw new Error(`The catalog request returned ${response.status}.`);
  return validateCatalog(await response.json());
}

export async function loadCatalog(): Promise<LoadedCatalog> {
  const apiBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "");
  if (apiBase) {
    const [api, snapshot] = await Promise.allSettled([
      fetchCatalog(`${apiBase}/api/catalog`, 2500),
      fetchCatalog("/data/catalog.json"),
    ]);
    if (api.status === "fulfilled" && snapshot.status === "fulfilled") {
      // Prefer the API only when it preserves every published scope and is no older in any scope.
      const apiSections = new Map(
        api.value.courses.flatMap((course) =>
          course.sections.map(
            (section) => [`${course.id}/${section.id}`, section] as const,
          ),
        ),
      );
      const preservesDiscovery = snapshot.value.courses.every((course) =>
        course.sections.every((section) => {
          if (!section.instructorDiscovery) return true;
          const candidate = apiSections.get(`${course.id}/${section.id}`);
          if (!candidate) {
            // A genuinely newer collection may remove a cancelled section. An equally
            // fresh response missing an evidenced section is incomplete for our purpose.
            return (
              Date.parse(
                collectedAt(
                  api.value,
                  course.termCode,
                  course.campus,
                  course.subject,
                ),
              ) > Date.parse(section.lastUpdated)
            );
          }
          if (candidate.instructors.length > 0) return true;
          const apiIdentities = new Map(
            (candidate.instructorDiscovery?.fullNameMatches ?? []).map(
              (identity) => [identity.id, identity],
            ),
          );
          const preservesIdentities = (
            section.instructorDiscovery.fullNameMatches ?? []
          ).every((identity) => {
            const updated = apiIdentities.get(identity.id);
            return (
              !!updated &&
              Date.parse(updated.checkedAt) >= Date.parse(identity.checkedAt)
            );
          });
          return (
            preservesIdentities &&
            !!candidate.instructorDiscovery &&
            Date.parse(candidate.instructorDiscovery.checkedAt) >=
              Date.parse(section.instructorDiscovery.checkedAt)
          );
        }),
      );
      const usable =
        preservesDiscovery &&
        snapshot.value.coverage.every((scope) =>
          scope.subjects.every(
            (subject) =>
              api.value.coverage.some(
                (candidate) =>
                  candidate.complete &&
                  candidate.termCode === scope.termCode &&
                  candidate.campus === scope.campus &&
                  candidate.subjects.includes(subject),
              ) &&
              Date.parse(
                collectedAt(api.value, scope.termCode, scope.campus, subject),
              ) >=
                Date.parse(
                  collectedAt(
                    snapshot.value,
                    scope.termCode,
                    scope.campus,
                    subject,
                  ),
                ),
          ),
        );
      return usable
        ? { catalog: api.value, via: "api", fallback: false }
        : {
            catalog: snapshot.value,
            via: "snapshot",
            fallback: true,
            fallbackReason: "older-or-partial",
          };
    }
    if (api.status === "fulfilled")
      return { catalog: api.value, via: "api", fallback: false };
    if (snapshot.status === "fulfilled")
      return {
        catalog: snapshot.value,
        via: "snapshot",
        fallback: true,
        fallbackReason: "unavailable",
      };
    throw new Error(
      "Neither the API nor the published catalog could be loaded. Please try again.",
    );
  }
  return {
    catalog: await fetchCatalog("/data/catalog.json"),
    via: "snapshot",
    fallback: false,
  };
}

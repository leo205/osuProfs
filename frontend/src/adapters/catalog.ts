import type {
  Catalog,
  CodeLabel,
  InstructorIdentityMatch,
} from "../domain/types";
import { isAvailabilityUrl } from "./availability";

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

function validDetails(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== "object") return false;
  const details = value as NonNullable<
    Catalog["courses"][number]["sections"][number]["details"]
  >;
  return (
    [
      details.sessionCode,
      details.sessionDescription,
      details.startDate,
      details.endDate,
      details.associatedClass,
      details.consent,
      details.primaryInstructorSection,
      details.location,
    ].every((field) => field === null || typeof field === "string") &&
    Array.isArray(details.autoEnrollSections) &&
    details.autoEnrollSections.every((field) => typeof field === "string") &&
    Array.isArray(details.attributes) &&
    details.attributes.every((field) => typeof field === "string") &&
    (details.availabilityUrl === null ||
      isAvailabilityUrl(details.availabilityUrl))
  );
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
  const invalidCourse = c.courses.find(
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
          !validDiscovery(s.instructorDiscovery) ||
          !validDetails(s.details),
      ),
  );
  if (invalidCourse) {
    throw new Error(
      `Some course or section records are incomplete (${invalidCourse.id ?? "unknown course"}).`,
    );
  }
  return c;
}

async function fetchCatalog(
  url: string,
  timeout = 6500,
  cache: RequestCache = "no-cache",
): Promise<Catalog> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    cache,
  });
  if (!response.ok)
    throw new Error(`The catalog request returned ${response.status}.`);
  return validateCatalog(await response.json());
}

interface CatalogShard {
  url: string;
  termCode: string;
  campus: string;
  subjects: string[];
  courseCount: number;
  sectionCount: number;
}

export interface CatalogIndex {
  schemaVersion: 1;
  generatedAt: string;
  catalogs: CatalogShard[];
}

export function validateCatalogIndex(value: unknown): CatalogIndex {
  if (!value || typeof value !== "object")
    throw new Error("The catalog index is not an object.");
  const index = value as CatalogIndex;
  if (
    index.schemaVersion !== 1 ||
    !Number.isFinite(Date.parse(index.generatedAt)) ||
    !Array.isArray(index.catalogs) ||
    !index.catalogs.length ||
    index.catalogs.length > 1000
  )
    throw new Error(
      "The catalog index has an unsupported or incomplete format.",
    );
  const paths = new Set<string>();
  const scopes = new Set<string>();
  for (const shard of index.catalogs) {
    if (
      !shard ||
      typeof shard.url !== "string" ||
      !/^\/data\/[a-zA-Z0-9_/-]+\.json$/.test(shard.url) ||
      shard.url.includes("//") ||
      typeof shard.termCode !== "string" ||
      !shard.termCode.trim() ||
      typeof shard.campus !== "string" ||
      !shard.campus.trim() ||
      !Array.isArray(shard.subjects) ||
      !shard.subjects.length ||
      shard.subjects.some(
        (subject) => typeof subject !== "string" || !subject.trim(),
      ) ||
      new Set(shard.subjects).size !== shard.subjects.length ||
      !Number.isSafeInteger(shard.courseCount) ||
      shard.courseCount < 0 ||
      !Number.isSafeInteger(shard.sectionCount) ||
      shard.sectionCount < 0
    )
      throw new Error("The catalog index contains an invalid shard.");
    if (paths.has(shard.url))
      throw new Error("The catalog index repeats a file.");
    paths.add(shard.url);
    for (const subject of shard.subjects) {
      const scope = `${shard.termCode}/${shard.campus}/${subject}`;
      if (scopes.has(scope))
        throw new Error(
          "The catalog index repeats a semester/campus/subject scope.",
        );
      scopes.add(scope);
    }
  }
  return index;
}

function validateShard(catalog: Catalog, shard: CatalogShard): Catalog {
  if (
    catalog.courses.length !== shard.courseCount ||
    catalog.courses.reduce(
      (total, course) => total + course.sections.length,
      0,
    ) !== shard.sectionCount ||
    !catalog.coverage.length ||
    catalog.courses.some(
      (course) =>
        course.termCode !== shard.termCode ||
        course.campus !== shard.campus ||
        !shard.subjects.includes(course.subject),
    ) ||
    catalog.coverage.some(
      (scope) =>
        scope.termCode !== shard.termCode ||
        scope.campus !== shard.campus ||
        scope.subjects.some((subject) => !shard.subjects.includes(subject)),
    ) ||
    shard.subjects.some(
      (subject) =>
        !catalog.coverage.some((scope) => scope.subjects.includes(subject)),
    )
  )
    throw new Error(
      `The catalog file ${shard.url} does not match its declared coverage.`,
    );
  return catalog;
}

function mergeCatalogs(index: CatalogIndex, catalogs: Catalog[]): Catalog {
  function labels(kind: "terms" | "subjects" | "campuses"): CodeLabel[] {
    const items = new Map<string, CodeLabel>();
    for (const catalog of catalogs)
      for (const item of catalog[kind]) {
        if (
          !item ||
          typeof item.code !== "string" ||
          typeof item.label !== "string"
        )
          throw new Error(`The catalog has invalid ${kind} metadata.`);
        const existing = items.get(item.code);
        if (existing && existing.label !== item.label)
          throw new Error(
            `Catalog files disagree about ${kind} label ${item.code}.`,
          );
        items.set(item.code, item);
      }
    return [...items.values()].sort((a, b) =>
      kind === "terms"
        ? b.code.localeCompare(a.code)
        : a.code.localeCompare(b.code),
    );
  }
  const courses = new Map<string, Catalog["courses"][number]>();
  const coverage = new Map<string, Catalog["coverage"][number]>();
  for (const catalog of catalogs) {
    for (const course of catalog.courses) {
      if (courses.has(course.id))
        throw new Error(`Catalog files repeat course ${course.id}.`);
      courses.set(course.id, course);
    }
    for (const scope of catalog.coverage) {
      const key = `${scope.termCode}/${scope.campus}/${[...scope.subjects].sort().join(",")}`;
      const previous = coverage.get(key);
      if (previous && JSON.stringify(previous) !== JSON.stringify(scope))
        throw new Error(`Catalog files disagree about coverage ${key}.`);
      coverage.set(key, scope);
    }
  }
  return {
    schemaVersion: 1,
    generatedAt: index.generatedAt,
    source: catalogs[0].source,
    terms: labels("terms"),
    subjects: labels("subjects"),
    campuses: labels("campuses"),
    coverage: [...coverage.values()],
    courses: [...courses.values()],
  };
}

/** Load all scopes atomically: a failed shard must never look like complete coverage. */
const snapshotCache = new Map<string, { index: string; catalog: Catalog }>();
const acceptedSnapshots = new Map<string, Catalog>();
export function clearSnapshotCache() {
  snapshotCache.clear();
  acceptedSnapshots.clear();
}

async function fetchSnapshot(base = "", baseline?: Catalog): Promise<Catalog> {
  const response = await fetch(`${base}/data/catalog-index.json`, {
    signal: AbortSignal.timeout(base ? 5000 : 15000),
    cache: "no-cache",
  });
  if (response.status === 404 && !base)
    return fetchCatalog("/data/catalog.json", 30000);
  if (!response.ok)
    throw new Error(`The catalog index request returned ${response.status}.`);
  const index = validateCatalogIndex(await response.json());
  if (
    baseline &&
    Date.parse(index.generatedAt) <= Date.parse(baseline.generatedAt)
  )
    return baseline;
  const key = JSON.stringify(index);
  const cached = snapshotCache.get(base);
  if (cached?.index === key) return cached.catalog;
  const catalogs = new Array<Catalog>(index.catalogs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, index.catalogs.length) }, async () => {
      while (next < index.catalogs.length) {
        const position = next++;
        const shard = index.catalogs[position];
        catalogs[position] = validateShard(
          await fetchCatalog(
            `${base}${shard.url}`,
            30000,
            /-[a-f0-9]{16}\.json$/.test(shard.url) ? "force-cache" : "no-cache",
          ),
          shard,
        );
      }
    }),
  );
  const catalog = mergeCatalogs(index, catalogs);
  snapshotCache.set(base, { index: key, catalog });
  return catalog;
}

async function fetchCurrentSnapshot(): Promise<Catalog> {
  let bundled: Catalog | undefined;
  let bundleError: unknown;
  try {
    bundled = await fetchSnapshot();
  } catch (error) {
    bundleError = error;
  }
  const configured =
    import.meta.env.VITE_CATALOG_BASE_URL ??
    "https://raw.githubusercontent.com/leo205/osuProfs/main/frontend/public";
  if (!configured) {
    if (bundled) return bundled;
    throw bundleError;
  }
  try {
    const url = new URL(configured);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Live catalog must use a public HTTPS base URL.");
    const base = url.href.replace(/\/$/, "");
    const previous = acceptedSnapshots.get(base);
    if (
      previous &&
      (!bundled ||
        (previous.terms.length === bundled.terms.length &&
          previous.terms.every((term) =>
            bundled!.terms.some((current) => current.code === term.code),
          ) &&
          Date.parse(previous.generatedAt) >= Date.parse(bundled.generatedAt)))
    )
      bundled = previous;
    const remote = await fetchSnapshot(base, bundled);
    if (!bundled) {
      acceptedSnapshots.set(base, remote);
      return remote;
    }
    const candidate = restrictApiTerms(remote, bundled);
    const complete = new Set(
      candidate.coverage
        .filter((scope) => scope.complete)
        .flatMap((scope) =>
          scope.subjects.map(
            (subject) => `${scope.termCode}/${scope.campus}/${subject}`,
          ),
        ),
    );
    const remoteTimes = scopeTimestamps(candidate),
      localTimes = scopeTimestamps(bundled);
    const baselineGeneratedAt = Date.parse(bundled.generatedAt);
    const preservesCoverage = bundled.coverage.every((scope) =>
      scope.subjects.every((subject) => {
        const key = `${scope.termCode}/${scope.campus}/${subject}`;
        return (
          complete.has(key) &&
          (remoteTimes.get(key) ?? Date.parse(candidate.generatedAt)) >=
            (localTimes.get(key) ?? baselineGeneratedAt)
        );
      }),
    );
    const selected = preservesCoverage ? candidate : bundled;
    acceptedSnapshots.set(base, selected);
    return selected;
  } catch {
    if (bundled) return bundled;
    throw new Error(
      "The saved course catalog could not be loaded. Try again shortly.",
    );
  }
}

function scopeTimestamps(catalog: Catalog): Map<string, number> {
  const times = new Map<string, number>();
  for (const course of catalog.courses) {
    const key = `${course.termCode}/${course.campus}/${course.subject}`;
    for (const section of course.sections) {
      const timestamp = Date.parse(section.lastUpdated);
      if (Number.isFinite(timestamp))
        times.set(key, Math.min(times.get(key) ?? Infinity, timestamp));
    }
  }
  return times;
}

/** The published snapshot defines which upcoming semesters this site exposes. */
function restrictApiTerms(api: Catalog, snapshot: Catalog): Catalog {
  const terms = new Set(snapshot.terms.map((term) => term.code));
  const courses = api.courses.filter((course) => terms.has(course.termCode));
  const coverage = api.coverage.filter((scope) => terms.has(scope.termCode));
  const subjects = new Set(coverage.flatMap((scope) => scope.subjects));
  const campuses = new Set(coverage.map((scope) => scope.campus));
  return {
    ...api,
    courses,
    coverage,
    terms: api.terms.filter((term) => terms.has(term.code)),
    subjects: api.subjects.filter((subject) => subjects.has(subject.code)),
    campuses: api.campuses.filter((campus) => campuses.has(campus.code)),
  };
}

export async function loadCatalog(): Promise<LoadedCatalog> {
  const apiBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "");
  if (apiBase) {
    const [api, snapshot] = await Promise.allSettled([
      fetchCatalog(`${apiBase}/api/catalog`, 2500),
      fetchCurrentSnapshot(),
    ]);
    if (api.status === "fulfilled" && snapshot.status === "fulfilled") {
      const apiCatalog = restrictApiTerms(api.value, snapshot.value);
      // Prefer the API only when it preserves every published scope and is no older in any scope.
      const apiTimes = scopeTimestamps(apiCatalog);
      const snapshotTimes = scopeTimestamps(snapshot.value);
      const completeApiScopes = new Set(
        apiCatalog.coverage
          .filter((scope) => scope.complete)
          .flatMap((scope) =>
            scope.subjects.map(
              (subject) => `${scope.termCode}/${scope.campus}/${subject}`,
            ),
          ),
      );
      const apiSections = new Map(
        apiCatalog.courses.flatMap((course) =>
          course.sections.map(
            (section) => [`${course.id}/${section.id}`, section] as const,
          ),
        ),
      );
      const preservesSectionInfo = snapshot.value.courses.every((course) =>
        course.sections.every((section) => {
          const candidate = apiSections.get(`${course.id}/${section.id}`);
          if (!candidate) {
            // A genuinely newer collection may remove a cancelled section. An equally
            // fresh response missing a published section is incomplete for our purpose.
            return (
              (apiTimes.get(
                `${course.termCode}/${course.campus}/${course.subject}`,
              ) ?? Date.parse(apiCatalog.generatedAt)) >
              Date.parse(section.lastUpdated)
            );
          }
          if (section.details && !candidate.details) return false;
          if (
            Date.parse(candidate.lastUpdated) <=
              Date.parse(section.lastUpdated) &&
            section.instructors.some(
              (instructor) =>
                !candidate.instructors.some(
                  (updated) => updated.id === instructor.id,
                ),
            )
          )
            return false;
          if (!section.instructorDiscovery || candidate.instructors.length > 0)
            return true;
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
        preservesSectionInfo &&
        snapshot.value.coverage.every((scope) =>
          scope.subjects.every((subject) => {
            const key = `${scope.termCode}/${scope.campus}/${subject}`;
            return (
              completeApiScopes.has(key) &&
              (apiTimes.get(key) ?? Date.parse(apiCatalog.generatedAt)) >=
                (snapshotTimes.get(key) ??
                  Date.parse(snapshot.value.generatedAt))
            );
          }),
        );
      return usable
        ? { catalog: apiCatalog, via: "api", fallback: false }
        : {
            catalog: snapshot.value,
            via: "snapshot",
            fallback: true,
            fallbackReason: "older-or-partial",
          };
    }
    if (snapshot.status === "fulfilled")
      return {
        catalog: snapshot.value,
        via: "snapshot",
        fallback: true,
        fallbackReason: "unavailable",
      };
    throw new Error(
      "The published upcoming-semester catalog could not be loaded. Reload the page or try again shortly.",
    );
  }
  return {
    catalog: await fetchCurrentSnapshot(),
    via: "snapshot",
    fallback: false,
  };
}

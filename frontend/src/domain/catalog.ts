import type {
  Catalog,
  Course,
  Filters,
  InstructorIdentityMatch,
  InstructorProfile,
  Section,
  SectionFilters,
} from "./types";

export const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
export const courseCode = (course: Course) =>
  `${course.subject} ${course.catalogNumber}`;
export const DAY_LABELS: Record<string, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};
export const DAYS = Object.keys(DAY_LABELS);
export const emptySectionFilters: SectionFilters = {
  component: "",
  delivery: "",
  day: "",
  namedOnly: false,
  hideClosed: false,
};

export function matchedSurnames(section: Section): string[] {
  const unique = new Map<string, string>();
  for (const surname of section.instructorDiscovery?.surnames ?? []) {
    const trimmed = surname.trim();
    if (trimmed) unique.set(normalize(trimmed), trimmed);
  }
  return [...unique.values()];
}

export function hasSurnameMatch(section: Section): boolean {
  return (
    section.instructorDiscovery?.status === "SURNAME_MATCH" &&
    matchedSurnames(section).length === 1
  );
}

export function isInstructorIdentified(section: Section): boolean {
  return (
    section.instructors.length > 0 ||
    (hasSurnameMatch(section) && fullNameMatches(section).length === 1)
  );
}

export function fullNameMatches(section: Section): InstructorIdentityMatch[] {
  return section.instructorDiscovery?.fullNameMatches ?? [];
}

export function hasSingleFullNameMatch(section: Section): boolean {
  return hasSurnameMatch(section) && fullNameMatches(section).length === 1;
}

export function instructorEvidenceLabel(section: Section): string {
  if (section.instructors.length) return "Published assignment";
  if (hasSingleFullNameMatch(section)) return "Likely match";
  if (fullNameMatches(section).length) return "Multiple possible matches";
  if (hasSurnameMatch(section)) return "Surname matched in OSU search";
  return matchedSurnames(section).length
    ? "Multiple surname matches"
    : "No name found in current coverage";
}

export function instructorRatingUrl(instructor: InstructorProfile): string {
  return (
    ("rateMyProfessorsUrl" in instructor && instructor.rateMyProfessorsUrl) ||
    `https://www.ratemyprofessors.com/search/professors/724?q=${encodeURIComponent(instructor.name)}`
  );
}

export function sectionInstructorNames(section: Section): string[] {
  return [
    ...section.instructors.map((instructor) => instructor.name),
    ...fullNameMatches(section).map((instructor) => instructor.name),
    ...matchedSurnames(section),
  ];
}

export function instructorLabel(section: Section): string {
  if (section.instructors.length)
    return section.instructors.map((instructor) => instructor.name).join(", ");
  const matches = fullNameMatches(section);
  const remaining = matchedSurnames(section).filter(
    (surname) =>
      !matches.some((match) => normalize(match.surname) === normalize(surname)),
  );
  return (
    [...matches.map((match) => match.name), ...remaining].join(" / ") ||
    "Instructor not resolved"
  );
}

/** A partial refresh must not make older, untouched scopes look freshly checked. */
export function collectedAt(
  catalog: Catalog,
  termCode: string,
  campus = "",
  subject = "",
): string {
  let oldest = Infinity;
  for (const course of catalog.courses) {
    if (
      course.termCode !== termCode ||
      (campus && course.campus !== campus) ||
      (subject && course.subject !== subject)
    )
      continue;
    for (const section of course.sections) {
      const timestamp = Date.parse(section.lastUpdated);
      if (Number.isFinite(timestamp)) oldest = Math.min(oldest, timestamp);
    }
  }
  return Number.isFinite(oldest)
    ? new Date(oldest).toISOString()
    : catalog.generatedAt;
}

export function defaultFilters(catalog: Catalog): Filters {
  const termCode =
    [...catalog.terms].sort((a, b) => b.code.localeCompare(a.code))[0]?.code ??
    "";
  const campus =
    catalog.campuses.find((c) => c.code === "col")?.code ??
    catalog.campuses[0]?.code ??
    "";
  const starter = catalog.courses.find(
    (c) =>
      c.termCode === termCode &&
      c.campus === campus &&
      c.subject === "CSE" &&
      c.catalogNumber === "2421",
  );
  return {
    termCode,
    campus,
    subject: starter ? "CSE" : "",
    number: starter ? "2421" : "",
    instructor: "",
    query: "",
  };
}

export function sectionMatches(
  section: Section,
  filters: SectionFilters,
  instructor = "",
): boolean {
  return (
    (!filters.component || section.component === filters.component) &&
    (!filters.delivery || section.instructionMode === filters.delivery) &&
    (!filters.day ||
      section.meetings.some((m) => m.days.includes(filters.day))) &&
    (!filters.namedOnly || isInstructorIdentified(section)) &&
    (!filters.hideClosed ||
      !["CLOSED", "CANCELLED"].includes(section.enrollment.status)) &&
    (!instructor ||
      sectionInstructorNames(section).some((name) =>
        normalize(name).includes(normalize(instructor)),
      ))
  );
}

export function filterCourses(
  catalog: Catalog,
  filters: Filters,
  sectionFilters: SectionFilters = emptySectionFilters,
): Course[] {
  const query = normalize(filters.query);
  const tokens = query.split(" ").filter(Boolean);
  const number = normalize(filters.number);
  return catalog.courses
    .filter((course) => {
      if (
        course.termCode !== filters.termCode ||
        (filters.campus && course.campus !== filters.campus)
      )
        return false;
      if (filters.subject && course.subject !== filters.subject) return false;
      if (number && !normalize(course.catalogNumber).startsWith(number))
        return false;
      if (!tokens.length) return true;
      const haystack = normalize(
        `${courseCode(course)} ${course.subject}${course.catalogNumber} ${course.title} ${course.description} ${course.sections.flatMap(sectionInstructorNames).join(" ")}`,
      );
      return tokens.every((token) => haystack.includes(token));
    })
    .map((course) => ({
      ...course,
      sections: course.sections.filter((section) =>
        sectionMatches(section, sectionFilters, filters.instructor),
      ),
    }))
    .filter((course) => course.sections.length > 0)
    .sort(
      (a, b) =>
        a.subject.localeCompare(b.subject) ||
        a.catalogNumber.localeCompare(b.catalogNumber, undefined, {
          numeric: true,
        }),
    );
}

export function sortSections(sections: Section[], sort: string): Section[] {
  return [...sections].sort((a, b) => {
    if (sort === "instructor")
      return (sectionInstructorNames(a)[0] ?? "\uffff").localeCompare(
        sectionInstructorNames(b)[0] ?? "\uffff",
      );
    if (sort === "time")
      return (
        a.meetings.find((m) => m.startTime)?.startTime ?? "99:99"
      ).localeCompare(
        b.meetings.find((m) => m.startTime)?.startTime ?? "99:99",
      );
    if (sort === "status") {
      const rank = {
        OPEN: 0,
        WAITLIST: 1,
        UNKNOWN: 2,
        CLOSED: 3,
        CANCELLED: 4,
      };
      return (
        rank[a.enrollment.status] - rank[b.enrollment.status] ||
        a.section.localeCompare(b.section, undefined, { numeric: true })
      );
    }
    return a.section.localeCompare(b.section, undefined, { numeric: true });
  });
}

export function instructorIndex(
  catalog: Catalog,
  termCode: string,
  query = "",
  campus = "",
): {
  instructor: InstructorProfile;
  courses: Course[];
  sections: number;
  publishedSections: number;
  likelySections: number;
}[] {
  const people = new Map<
    string,
    {
      instructor: InstructorProfile;
      courses: Map<string, Course>;
      sectionIds: Set<string>;
      publishedIds: Set<string>;
      likelyIds: Set<string>;
    }
  >();
  for (const course of catalog.courses.filter(
    (c) => c.termCode === termCode && (!campus || c.campus === campus),
  )) {
    for (const section of course.sections)
      for (const instructor of [
        ...section.instructors,
        ...fullNameMatches(section),
      ]) {
        const key = instructor.id || normalize(instructor.name);
        const person = people.get(key) ?? {
          instructor,
          courses: new Map(),
          sectionIds: new Set(),
          publishedIds: new Set(),
          likelyIds: new Set(),
        };
        if ("confidence" in instructor) person.instructor = instructor;
        person.courses.set(course.id, course);
        person.sectionIds.add(section.id);
        if (
          section.instructors.some(
            (published) => published.id === instructor.id,
          )
        )
          person.publishedIds.add(section.id);
        else person.likelyIds.add(section.id);
        people.set(key, person);
      }
  }
  return [...people.values()]
    .filter((p) => normalize(p.instructor.name).includes(normalize(query)))
    .map((p) => ({
      instructor: p.instructor,
      courses: [...p.courses.values()],
      sections: p.sectionIds.size,
      publishedSections: p.publishedIds.size,
      likelySections: p.likelyIds.size,
    }))
    .sort((a, b) => a.instructor.name.localeCompare(b.instructor.name));
}

export function formatTime(time: string | null): string {
  if (!time) return "TBA";
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return "TBA";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

export function formatDate(
  date: string | null,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string {
  if (!date) return "Not provided";
  const parsed = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00Z` : date,
  );
  return Number.isNaN(parsed.getTime())
    ? "Not provided"
    : new Intl.DateTimeFormat("en-US", {
        ...options,
        timeZone: "America/New_York",
      }).format(parsed);
}

export function updatedLabel(date: string): string {
  const diff = Date.now() - Date.parse(date);
  if (!Number.isFinite(diff)) return "Update time unavailable";
  if (diff < -300_000) return "Check source timestamp";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function readFilters(
  search: string,
  defaults: Filters,
): { view: string; filters: Filters } {
  const p = new URLSearchParams(search);
  const filters = { ...defaults };
  for (const [key, param] of Object.entries({
    termCode: "term",
    campus: "campus",
    subject: "subject",
    number: "number",
    instructor: "instructor",
    query: "q",
  })) {
    if (p.has(param)) filters[key as keyof Filters] = p.get(param) ?? "";
  }
  return { view: p.get("view") ?? "search", filters };
}

export function filtersUrl(filters: Filters, view: string): string {
  const p = new URLSearchParams({
    view,
    term: filters.termCode,
    campus: filters.campus,
  });
  for (const [key, param] of Object.entries({
    subject: "subject",
    number: "number",
    instructor: "instructor",
    query: "q",
  })) {
    p.set(param, filters[key as keyof Filters]);
  }
  return `?${p.toString()}`;
}

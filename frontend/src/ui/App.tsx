import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { loadCatalog, type LoadedCatalog } from "../adapters/catalog";
import {
  collectedAt,
  courseCode,
  DAY_LABELS,
  defaultFilters,
  emptySectionFilters,
  filterCourses,
  filtersUrl,
  formatDate,
  formatTime,
  fullNameMatches,
  hasSurnameMatch,
  instructorIndex,
  instructorLabel,
  instructorEvidenceLabel,
  instructorRatingUrl,
  isInstructorIdentified,
  normalize,
  readFilters,
  updatedLabel,
} from "../domain/catalog";
import {
  calendarExport,
  findConflicts,
  minutes,
  resolveSaved,
} from "../domain/schedule";
import type {
  Catalog,
  Course,
  Filters,
  InstructorProfile,
  PlannedSection,
  SavedReference,
  Section,
  View,
} from "../domain/types";
import CourseCard, { EnrollmentBadge, MeetingSummary } from "./CourseCard";
import Icon from "./Icon";
import Modal from "./Modal";

const STORAGE_KEY = "buckeye-course-guide.schedule.v1";
const VIEW_LABELS: Record<View, string> = {
  search: "Course search",
  instructors: "Instructors",
  schedule: "My schedule",
  status: "Data & sources",
};
const VIEW_ICONS: Record<View, string> = {
  search: "search",
  instructors: "people",
  schedule: "calendar",
  status: "status",
};
type Dialog =
  | { type: "instructor"; instructor: InstructorProfile }
  | { type: "compare" | "privacy" | "report" }
  | null;

function readSaved(): SavedReference[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (v): v is SavedReference =>
          !!v &&
          typeof v === "object" &&
          typeof v.termCode === "string" &&
          typeof v.courseId === "string" &&
          typeof v.sectionId === "string",
      )
      .slice(0, 100);
  } catch {
    return [];
  }
}

function publishedSearch(catalog: Catalog) {
  const defaults = defaultFilters(catalog);
  const initial = readFilters(window.location.search, defaults);
  let corrected = false;
  if (!catalog.terms.some((term) => term.code === initial.filters.termCode)) {
    initial.filters.termCode = defaults.termCode;
    corrected = true;
  }
  if (
    initial.filters.campus &&
    !catalog.campuses.some((campus) => campus.code === initial.filters.campus)
  ) {
    initial.filters.campus = defaults.campus;
    corrected = true;
  }
  if (corrected)
    window.history.replaceState(
      null,
      "",
      filtersUrl(
        initial.filters,
        Object.hasOwn(VIEW_LABELS, initial.view) ? initial.view : "search",
      ),
    );
  return initial;
}

export default function App() {
  const [loaded, setLoaded] = useState<LoadedCatalog | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [saved, setSaved] = useState<SavedReference[]>(readSaved);
  const [storageError, setStorageError] = useState(false);
  const [notice, setNotice] = useState("");
  const initialized = useRef(false);
  const refreshInFlight = useRef(false);
  const lastRefresh = useRef(0);
  const noticeTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [view, setView] = useState<View>("search");
  const [filters, setFilters] = useState<Filters>({
    termCode: "",
    campus: "",
    subject: "",
    number: "",
    instructor: "",
    query: "",
  });
  const [draft, setDraft] = useState<Filters>(filters);
  const [sectionFilters, setSectionFilters] = useState(emptySectionFilters);
  const [moreFilters, setMoreFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [compared, setCompared] = useState<PlannedSection[]>([]);
  const [instructorSearch, setInstructorSearch] = useState("");
  const [instructorPage, setInstructorPage] = useState(1);
  const searchInput = useRef<HTMLInputElement>(null);
  const catalog = loaded?.catalog;
  const identityProfiles = useMemo(
    () =>
      new Map(
        catalog?.courses
          .flatMap((course) => course.sections.flatMap(fullNameMatches))
          .map((identity) => [identity.id, identity] as const) ?? [],
      ),
    [catalog],
  );
  const selectedIdentity =
    dialog?.type === "instructor"
      ? identityProfiles.get(dialog.instructor.id)
      : undefined;

  const notify = useCallback((message: string) => {
    setNotice(message);
    clearTimeout(noticeTimeout.current);
    noticeTimeout.current = setTimeout(() => setNotice(""), 5000);
  }, []);

  const refresh = useCallback(async (background = false) => {
    if (refreshInFlight.current) return false;
    refreshInFlight.current = true;
    if (!background) setRefreshing(true);
    try {
      setLoaded(await loadCatalog());
      setError("");
      return true;
    } catch (e) {
      if (!background)
        setError(
          e instanceof Error ? e.message : "Unable to load the catalog.",
        );
      return false;
    } finally {
      setRefreshing(false);
      refreshInFlight.current = false;
      lastRefresh.current = Date.now();
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = 15 * 60 * 1000;
    const check = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastRefresh.current >= interval
      )
        void refresh(true);
    };
    const timer = setInterval(check, interval);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
      clearTimeout(noticeTimeout.current);
    };
  }, [refresh]);

  useEffect(() => {
    if (!catalog || initialized.current) return;
    const initial = publishedSearch(catalog);
    setFilters(initial.filters);
    setDraft(initial.filters);
    if (Object.hasOwn(VIEW_LABELS, initial.view)) setView(initial.view as View);
    initialized.current = true;
  }, [catalog]);

  useEffect(() => {
    if (!catalog) return;
    const popstate = () => {
      const parsed = publishedSearch(catalog);
      setView(
        Object.hasOwn(VIEW_LABELS, parsed.view)
          ? (parsed.view as View)
          : "search",
      );
      setFilters(parsed.filters);
      setDraft(parsed.filters);
      setPage(1);
      setSectionFilters(emptySectionFilters);
    };
    window.addEventListener("popstate", popstate);
    return () => window.removeEventListener("popstate", popstate);
  }, [catalog]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [saved]);

  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      const element = e.target as HTMLElement;
      if (
        e.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) &&
        !element.isContentEditable &&
        view === "search" &&
        !dialog
      ) {
        e.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [view, dialog]);

  const navigate = (nextView: View, nextFilters = filters) => {
    setView(nextView);
    setFilters(nextFilters);
    setDraft(nextFilters);
    setPage(1);
    setMenuOpen(false);
    window.history.pushState(null, "", filtersUrl(nextFilters, nextView));
  };
  const applyFilters = (next: Filters) => {
    setSectionFilters(emptySectionFilters);
    navigate("search", next);
  };
  const reset = () =>
    applyFilters({
      ...filters,
      subject: "",
      number: "",
      instructor: "",
      query: "",
    });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    applyFilters(draft);
  };

  const resolved = useMemo(
    () => (catalog ? resolveSaved(catalog, saved) : { items: [], missing: [] }),
    [catalog, saved],
  );
  const planned = useMemo(
    () =>
      resolved.items.filter(
        (item) => item.course.termCode === filters.termCode,
      ),
    [resolved, filters.termCode],
  );
  const savedIds = useMemo(
    () => new Set(saved.map((s) => s.sectionId)),
    [saved],
  );
  const comparedIds = new Set(compared.map((p) => p.section.id));
  const conflicts = useMemo(() => findConflicts(planned), [planned]);
  const results = useMemo(
    () => (catalog ? filterCourses(catalog, filters, sectionFilters) : []),
    [catalog, filters, sectionFilters],
  );
  const allPeople = useMemo(
    () =>
      catalog
        ? instructorIndex(catalog, filters.termCode, "", filters.campus)
        : [],
    [catalog, filters.termCode, filters.campus],
  );
  const people = useMemo(() => {
    const query = normalize(instructorSearch);
    return allPeople.filter((person) =>
      normalize(person.instructor.name).includes(query),
    );
  }, [allPeople, instructorSearch]);
  const matchingSections = useMemo(
    () => results.reduce((total, c) => total + c.sections.length, 0),
    [results],
  );
  const resultPages = Math.max(1, Math.ceil(results.length / 8));
  const currentPage = Math.min(page, resultPages);
  const instructorPages = Math.max(1, Math.ceil(people.length / 24));
  const currentInstructorPage = Math.min(instructorPage, instructorPages);
  const termLabel =
    catalog?.terms.find((t) => t.code === filters.termCode)?.label ??
    "Semester";
  const campusLabels = useMemo(
    () => new Map(catalog?.campuses.map((c) => [c.code, c.label]) ?? []),
    [catalog],
  );
  const termCollectedAt = useMemo(
    () =>
      catalog ? collectedAt(catalog, filters.termCode, filters.campus) : "",
    [catalog, filters.termCode, filters.campus],
  );
  const coverage = useMemo(
    () =>
      catalog?.coverage.filter(
        (c) =>
          c.termCode === filters.termCode &&
          (!filters.campus || c.campus === filters.campus),
      ) ?? [],
    [catalog, filters.termCode, filters.campus],
  );
  const coveredSubjects = useMemo(
    () => [...new Set(coverage.flatMap((c) => c.subjects))],
    [coverage],
  );
  const draftSubjects = useMemo(
    () =>
      new Set(
        catalog?.coverage
          .filter(
            (c) =>
              c.termCode === draft.termCode &&
              (!draft.campus || c.campus === draft.campus),
          )
          .flatMap((c) => c.subjects) ?? [],
      ),
    [catalog, draft.termCode, draft.campus],
  );
  const termSections = coverage.reduce((n, c) => n + c.sectionCount, 0);
  const termNamed = coverage.reduce((n, c) => n + c.namedInstructorSections, 0);
  const { termIdentified, termSurnameMatches } = useMemo(() => {
    let identified = 0;
    let surnameMatches = 0;
    for (const course of catalog?.courses ?? []) {
      if (
        course.termCode !== filters.termCode ||
        (filters.campus && course.campus !== filters.campus)
      )
        continue;
      for (const section of course.sections) {
        if (isInstructorIdentified(section)) identified++;
        if (!section.instructors.length && hasSurnameMatch(section))
          surnameMatches++;
      }
    }
    return { termIdentified: identified, termSurnameMatches: surnameMatches };
  }, [catalog, filters.termCode, filters.campus]);
  const advancedCount = Object.values(sectionFilters).filter(Boolean).length;

  function saveSection(course: Course, section: Section) {
    const exists = saved.some((s) => s.sectionId === section.id);
    if (exists) {
      setSaved((previous) =>
        previous.filter((s) => s.sectionId !== section.id),
      );
      notify(
        `${courseCode(course)} section ${section.section} removed from your plan.`,
      );
    } else {
      if (saved.length >= 100) {
        notify(
          "Your plan has reached its 100-section limit. Remove a section to add another.",
        );
        return;
      }
      setSaved((previous) => [
        ...previous,
        {
          termCode: course.termCode,
          courseId: course.id,
          sectionId: section.id,
        },
      ]);
      notify(
        `${courseCode(course)} section ${section.section} added to your plan.`,
      );
    }
  }

  function compareSection(course: Course, section: Section) {
    if (comparedIds.has(section.id))
      setCompared((previous) =>
        previous.filter((p) => p.section.id !== section.id),
      );
    else if (compared.length >= 3)
      notify(
        "Compare up to three sections at a time. Remove one to add another.",
      );
    else setCompared((previous) => [...previous, { course, section }]);
  }

  async function shareSearch() {
    const url = `${window.location.origin}${window.location.pathname}${filtersUrl(filters, view)}`;
    try {
      await navigator.clipboard.writeText(url);
      notify("Search link copied.");
    } catch {
      window.history.replaceState(null, "", filtersUrl(filters, view));
      notify("Your address bar now contains a shareable search link.");
    }
  }

  function exportCalendar() {
    const { content, eventCount, skippedMeetings } = calendarExport(planned);
    if (!eventCount) {
      notify("These sections have no complete dated meetings to export.");
      return;
    }
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/calendar;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `buckeye-schedule-${filters.termCode}.ics`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(
      `Calendar exported.${skippedMeetings ? ` ${skippedMeetings} incomplete meeting(s) were skipped.` : ""} Check university breaks separately.`,
    );
  }

  if (!catalog || !initialized.current)
    return (
      <div className="loading-page">
        <div className="brand-mark">
          <Icon name="book" size={25} />
        </div>
        <h1>Buckeye Course Guide</h1>
        {error ? (
          <>
            <p>{error}</p>
            <button
              className="button button-primary"
              onClick={() => void refresh()}
            >
              Try again
            </button>
            <p className="muted">
              The catalog must be generated before the site can display courses.
            </p>
          </>
        ) : (
          <>
            <span className="loading-spinner" />
            <p>Getting your semester ready…</p>
          </>
        )}
      </div>
    );

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a
            className="brand"
            href="?view=search"
            onClick={(e) => {
              e.preventDefault();
              navigate("search");
            }}
            aria-label="Buckeye Course Guide home"
          >
            <span className="brand-mark">
              <Icon name="book" size={23} />
            </span>
            <span className="brand-name">
              Buckeye<span>COURSE GUIDE</span>
            </span>
          </a>
          <nav
            className={`main-nav ${menuOpen ? "nav-open" : ""}`}
            aria-label="Main navigation"
          >
            {(Object.keys(VIEW_LABELS) as View[]).map((v) => (
              <a
                key={v}
                className={view === v ? "nav-link active" : "nav-link"}
                href={filtersUrl(filters, v)}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(v);
                }}
                aria-current={view === v ? "page" : undefined}
              >
                <Icon name={VIEW_ICONS[v]} size={17} />
                {VIEW_LABELS[v]}
                {v === "schedule" && (
                  <span className="nav-count">{saved.length}</span>
                )}
              </a>
            ))}
          </nav>
          <a
            className="official-link"
            href="https://buckeyelink.osu.edu/"
            target="_blank"
            rel="noreferrer"
          >
            BuckeyeLink <Icon name="external" size={14} />
          </a>
          <button
            className="icon-button mobile-menu"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label="Toggle navigation"
          >
            <Icon name={menuOpen ? "close" : "menu"} size={23} />
          </button>
        </div>
      </header>

      <main id="main-content" className="main-shell">
        <section
          className={view === "search" ? "search-toolbar" : "page-intro"}
        >
          {view === "search" ? (
            <h1 className="sr-only">Course search</h1>
          ) : (
            <div className="intro-copy">
              <div className="eyebrow">
                <span className="eyebrow-line" />
                OHIO STATE · INDEPENDENT STUDENT TOOL
              </div>
              <h1>
                {view === "instructors"
                  ? "Put a name to your next class."
                  : view === "schedule"
                    ? "Make room for a good semester."
                    : "Good decisions start with good data."}
              </h1>
              <p>
                {view === "instructors"
                  ? "Explore instructors and likely teaching matches in the subjects we’ve imported."
                  : view === "schedule"
                    ? "Your saved sections, together. A plan on this device—not an enrollment."
                    : "See exactly what’s covered, where it came from, and what’s still unknown."}
              </p>
            </div>
          )}
          <div className="semester-card">
            <span className="semester-icon">
              <Icon name="calendar" size={22} />
            </span>
            <label htmlFor="global-term">
              <span>PLANNING FOR</span>
              <select
                id="global-term"
                value={filters.termCode}
                onChange={(e) => {
                  setSectionFilters(emptySectionFilters);
                  setInstructorPage(1);
                  navigate(view, { ...filters, termCode: e.target.value });
                }}
              >
                {catalog.terms.map((term) => (
                  <option key={term.code} value={term.code}>
                    {term.label}
                  </option>
                ))}
              </select>
            </label>
            <Icon name="down" size={15} />
          </div>
        </section>

        <div className="catalog-context">
          <div className="context-left">
            <span className="snapshot-dot" />
            <strong>Official OSU data</strong>
            <span className="context-divider" />
            <span>
              {filters.campus
                ? `${campusLabels.get(filters.campus) ?? filters.campus} campus`
                : "All campuses"}
            </span>
            <span className="context-divider" />
            <span>{coveredSubjects.length} imported subjects</span>
          </div>
          <button
            className="refresh-control"
            onClick={() =>
              void refresh().then((success) => {
                if (success)
                  notify(
                    "Checked the published catalog. Updates follow the importer schedule.",
                  );
              })
            }
            disabled={refreshing}
            title={`Collected ${formatDate(termCollectedAt, { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}`}
          >
            <Icon
              name="refresh"
              size={13}
              className={refreshing ? "spinning" : ""}
            />
            {refreshing
              ? "Checking…"
              : `Updated ${updatedLabel(termCollectedAt)}`}
          </button>
        </div>
        {Date.now() - Date.parse(termCollectedAt) > 172_800_000 && (
          <div className="inline-alert warning">
            <Icon name="warning" size={17} />
            <span>
              This snapshot is more than two days old. Check official sources
              before choosing a section.
            </span>
            <button className="text-button" onClick={() => navigate("status")}>
              Data status
            </button>
          </div>
        )}
        {loaded.fallback && (
          <div className="inline-alert">
            <Icon name="info" size={17} />
            <span>
              {loaded.fallbackReason === "older-or-partial"
                ? "The published snapshot is newer or has wider coverage than the API. You’re browsing that snapshot."
                : "The API is unavailable. You’re browsing the last published snapshot."}
            </span>
          </div>
        )}
        {error && (
          <div className="inline-alert warning" role="alert">
            <Icon name="warning" size={17} />
            <span>
              Refresh failed. The current catalog remains available. {error}
            </span>
          </div>
        )}
        {storageError && (
          <div className="inline-alert warning" role="alert">
            <Icon name="warning" size={17} />
            <span>
              This browser couldn’t save your plan. Your selections will last
              only for this visit.
            </span>
          </div>
        )}

        {view === "search" && (
          <>
            <section className="search-card" aria-label="Course search filters">
              <form onSubmit={submit}>
                <div className="search-primary">
                  <label className="main-search">
                    <Icon name="search" size={21} />
                    <input
                      ref={searchInput}
                      value={draft.query}
                      onChange={(e) =>
                        setDraft({ ...draft, query: e.target.value })
                      }
                      placeholder="Search a course title, number, or instructor…"
                      aria-label="Search course titles, numbers, or instructors"
                    />
                    <kbd>/</kbd>
                  </label>
                  <button
                    className="button button-primary search-submit"
                    type="submit"
                  >
                    Search courses <Icon name="arrow" size={17} />
                  </button>
                </div>
                <div className="filter-grid">
                  <label className="field">
                    <span>Subject</span>
                    <span className="select-wrap">
                      <select
                        value={draft.subject}
                        onChange={(e) =>
                          setDraft({ ...draft, subject: e.target.value })
                        }
                      >
                        <option value="">All imported subjects</option>
                        {catalog.subjects
                          .filter((s) => draftSubjects.has(s.code))
                          .map((s) => (
                            <option key={s.code} value={s.code}>
                              {s.code} · {s.label}
                            </option>
                          ))}
                      </select>
                      <Icon name="down" size={14} />
                    </span>
                  </label>
                  <label className="field">
                    <span>
                      Course number{" "}
                      <span className="field-hint">exact or prefix</span>
                    </span>
                    <input
                      value={draft.number}
                      onChange={(e) =>
                        setDraft({ ...draft, number: e.target.value })
                      }
                      placeholder="e.g. 2421"
                      inputMode="decimal"
                    />
                  </label>
                  <label className="field">
                    <span>Instructor</span>
                    <input
                      value={draft.instructor}
                      onChange={(e) =>
                        setDraft({ ...draft, instructor: e.target.value })
                      }
                      placeholder="First or last name"
                    />
                  </label>
                  <label className="field">
                    <span>Campus</span>
                    <span className="select-wrap">
                      <select
                        value={draft.campus}
                        onChange={(e) =>
                          setDraft({ ...draft, campus: e.target.value })
                        }
                      >
                        <option value="">All campuses</option>
                        {catalog.campuses.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                      <Icon name="down" size={14} />
                    </span>
                  </label>
                </div>
              </form>
              <div className="filter-card-footer">
                <div className="active-filters">
                  <span className="filter-label">YOUR SEARCH</span>
                  <span className="filter-chip term-chip">
                    <Icon name="calendar" size={12} />
                    {termLabel}
                  </span>
                  {(["subject", "number", "instructor", "query"] as const)
                    .filter((key) => filters[key])
                    .map((key) => (
                      <span className="filter-chip" key={key}>
                        {key === "number" ? `# ${filters[key]}` : filters[key]}
                        <button
                          aria-label={`Remove ${key} filter`}
                          onClick={() =>
                            applyFilters({ ...filters, [key]: "" })
                          }
                        >
                          <Icon name="close" size={12} />
                        </button>
                      </span>
                    ))}
                  {[
                    filters.subject,
                    filters.number,
                    filters.instructor,
                    filters.query,
                  ].some(Boolean) && (
                    <button className="text-button reset-link" onClick={reset}>
                      Clear filters
                    </button>
                  )}
                </div>
                <button
                  className={`more-filters ${moreFilters ? "selected" : ""}`}
                  onClick={() => setMoreFilters((v) => !v)}
                  aria-expanded={moreFilters}
                >
                  <Icon name="filter" size={15} />
                  More filters
                  {advancedCount > 0 && (
                    <span className="count-badge">{advancedCount}</span>
                  )}
                  <Icon name="down" size={13} />
                </button>
              </div>
              {moreFilters && (
                <div className="advanced-filters">
                  <label className="field">
                    <span>Component</span>
                    <select
                      value={sectionFilters.component}
                      onChange={(e) => {
                        setSectionFilters({
                          ...sectionFilters,
                          component: e.target.value,
                        });
                        setPage(1);
                      }}
                    >
                      <option value="">Any component</option>
                      {[
                        ...new Set(
                          catalog.courses
                            .filter((c) => c.termCode === filters.termCode)
                            .flatMap((c) => c.sections.map((s) => s.component)),
                        ),
                      ]
                        .sort()
                        .map((component) => (
                          <option key={component}>{component}</option>
                        ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Delivery</span>
                    <select
                      value={sectionFilters.delivery}
                      onChange={(e) => {
                        setSectionFilters({
                          ...sectionFilters,
                          delivery: e.target.value,
                        });
                        setPage(1);
                      }}
                    >
                      <option value="">Any delivery</option>
                      {[
                        ...new Set(
                          catalog.courses
                            .filter((c) => c.termCode === filters.termCode)
                            .flatMap((c) =>
                              c.sections.map((s) => s.instructionMode),
                            ),
                        ),
                      ]
                        .filter(Boolean)
                        .sort()
                        .map((mode) => (
                          <option key={mode}>{mode}</option>
                        ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Meeting day</span>
                    <select
                      value={sectionFilters.day}
                      onChange={(e) => {
                        setSectionFilters({
                          ...sectionFilters,
                          day: e.target.value,
                        });
                        setPage(1);
                      }}
                    >
                      <option value="">Any day</option>
                      {Object.entries(DAY_LABELS).map(([code, label]) => (
                        <option key={code} value={code}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={sectionFilters.namedOnly}
                      onChange={(e) => {
                        setSectionFilters({
                          ...sectionFilters,
                          namedOnly: e.target.checked,
                        });
                        setPage(1);
                      }}
                    />
                    Identified instructors only
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={sectionFilters.hideClosed}
                      onChange={(e) => {
                        setSectionFilters({
                          ...sectionFilters,
                          hideClosed: e.target.checked,
                        });
                        setPage(1);
                      }}
                    />
                    Hide closed sections
                  </label>
                </div>
              )}
            </section>
            <div className="results-heading">
              <div>
                <h2>
                  {results.length === 1
                    ? "One course. Your options."
                    : "Find your fit."}
                </h2>
                <span>
                  {results.length.toLocaleString()}{" "}
                  {results.length === 1 ? "course" : "courses"} ·{" "}
                  {matchingSections.toLocaleString()} matching sections
                </span>
              </div>
              <button
                className="text-button share-button"
                onClick={() => void shareSearch()}
              >
                <Icon name="share" size={15} />
                Share search
              </button>
            </div>
            <div className="results-list">
              {results
                .slice((currentPage - 1) * 8, currentPage * 8)
                .map((course) => (
                  <CourseCard
                    key={course.id}
                    course={course}
                    identityProfiles={identityProfiles}
                    termLabel={termLabel}
                    campusLabel={
                      campusLabels.get(course.campus) ?? course.campus
                    }
                    saved={savedIds}
                    compared={comparedIds}
                    onSave={saveSection}
                    onCompare={compareSection}
                    onInstructor={(instructor) =>
                      setDialog({ type: "instructor", instructor })
                    }
                    notify={notify}
                    onPreviousTerm={
                      catalog.courses.some(
                        (c) =>
                          c.termCode < course.termCode &&
                          c.subject === course.subject &&
                          c.catalogNumber === course.catalogNumber,
                      )
                        ? () =>
                            applyFilters({
                              ...filters,
                              termCode:
                                catalog.courses
                                  .filter(
                                    (c) =>
                                      c.termCode < course.termCode &&
                                      c.subject === course.subject &&
                                      c.catalogNumber === course.catalogNumber,
                                  )
                                  .sort((a, b) =>
                                    b.termCode.localeCompare(a.termCode),
                                  )[0]?.termCode ?? filters.termCode,
                              subject: course.subject,
                              number: course.catalogNumber,
                              query: "",
                              instructor: "",
                            })
                        : undefined
                    }
                  />
                ))}
            </div>
            {!results.length && (
              <div className="empty-state">
                <span className="empty-icon">
                  <Icon name="search" size={27} />
                </span>
                <h2>No sections match this search.</h2>
                <p>
                  Try a broader course number or remove a filter. The selected
                  coverage includes {coveredSubjects.length} subjects for{" "}
                  {termLabel}.
                </p>
                <button
                  className="button button-secondary"
                  onClick={() => {
                    setSectionFilters(emptySectionFilters);
                    reset();
                  }}
                >
                  Show all imported courses
                </button>
              </div>
            )}
            {results.length > 8 && (
              <div className="pagination">
                <span>
                  Page {currentPage} of {resultPages}
                </span>
                <div>
                  <button
                    className="button button-secondary small"
                    disabled={currentPage <= 1}
                    onClick={() => {
                      setPage(currentPage - 1);
                      window.scrollTo({ top: 300, behavior: "smooth" });
                    }}
                  >
                    Previous
                  </button>
                  <button
                    className="button button-secondary small"
                    disabled={currentPage >= resultPages}
                    onClick={() => {
                      setPage(currentPage + 1);
                      window.scrollTo({ top: 300, behavior: "smooth" });
                    }}
                  >
                    Next <Icon name="arrow" size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {view === "instructors" && (
          <section className="instructors-page">
            <div className="panel-toolbar">
              <label className="main-search compact">
                <Icon name="search" size={20} />
                <input
                  value={instructorSearch}
                  onChange={(e) => {
                    setInstructorSearch(e.target.value);
                    setInstructorPage(1);
                  }}
                  placeholder="Find an instructor by name…"
                  aria-label="Filter instructors by name"
                />
              </label>
              <label className="field">
                <span>Instructor campus</span>
                <select
                  value={filters.campus}
                  onChange={(e) => {
                    setInstructorPage(1);
                    navigate("instructors", {
                      ...filters,
                      campus: e.target.value,
                    });
                  }}
                >
                  <option value="">All campuses</option>
                  {catalog.campuses.map((campus) => (
                    <option value={campus.code} key={campus.code}>
                      {campus.label}
                    </option>
                  ))}
                </select>
              </label>
              <span className="muted">
                {people.length.toLocaleString()} instructor profiles ·{" "}
                {termLabel}
              </span>
            </div>
            <div className="instructors-grid">
              {people
                .slice(
                  (currentInstructorPage - 1) * 24,
                  currentInstructorPage * 24,
                )
                .map((person) => (
                  <button
                    className="instructor-card"
                    key={person.instructor.id}
                    onClick={() =>
                      setDialog({
                        type: "instructor",
                        instructor: person.instructor,
                      })
                    }
                  >
                    <div className="instructor-card-top">
                      <span className="avatar">
                        {person.instructor.name
                          .split(" ")
                          .filter(Boolean)
                          .map((w) => w[0])
                          .slice(0, 2)
                          .join("")}
                      </span>
                      <Icon name="arrow" size={17} />
                    </div>
                    <h2>{person.instructor.name}</h2>
                    {person.likelySections > 0 && (
                      <span className="tag">
                        {person.likelySections} likely{" "}
                        {person.likelySections === 1 ? "match" : "matches"}
                      </span>
                    )}
                    <p>
                      {[...new Set(person.courses.map((c) => c.subject))].join(
                        " · ",
                      )}
                    </p>
                    <div className="instructor-course-codes">
                      {person.courses.slice(0, 3).map((c) => (
                        <span className="tag" key={c.id}>
                          {courseCode(c)}
                        </span>
                      ))}
                      {person.courses.length > 3 && (
                        <span className="muted">
                          +{person.courses.length - 3}
                        </span>
                      )}
                    </div>
                    <span className="instructor-card-footer">
                      {person.sections}{" "}
                      {person.sections === 1 ? "section" : "sections"} in{" "}
                      {termLabel}
                    </span>
                  </button>
                ))}
            </div>
            {!people.length && (
              <div className="empty-state">
                <Icon name="people" size={30} />
                <h2>No matching instructors.</h2>
                <p>
                  Try another spelling. Only published names and reviewed
                  identity candidates are listed here.
                </p>
              </div>
            )}
            {instructorPages > 1 && (
              <nav className="pagination" aria-label="Instructor pages">
                <span>
                  Page {currentInstructorPage} of {instructorPages}
                </span>
                <div>
                  <button
                    className="button button-secondary small"
                    disabled={currentInstructorPage <= 1}
                    onClick={() => setInstructorPage(currentInstructorPage - 1)}
                  >
                    Previous instructors
                  </button>
                  <button
                    className="button button-secondary small"
                    disabled={currentInstructorPage >= instructorPages}
                    onClick={() => setInstructorPage(currentInstructorPage + 1)}
                  >
                    Next instructors <Icon name="arrow" size={14} />
                  </button>
                </div>
              </nav>
            )}
          </section>
        )}

        {view === "schedule" && (
          <SchedulePage
            items={planned}
            missingCount={
              resolved.missing.filter((r) => r.termCode === filters.termCode)
                .length
            }
            conflicts={conflicts}
            termLabel={termLabel}
            onSave={saveSection}
            onSearch={() => navigate("search")}
            onExport={exportCalendar}
            onClear={() => {
              setSaved((s) =>
                s.filter((ref) => ref.termCode !== filters.termCode),
              );
              notify(`${termLabel} plan cleared.`);
            }}
          />
        )}
        {view === "status" && (
          <DataStatus
            catalog={catalog}
            termCode={filters.termCode}
            campus={filters.campus}
            termLabel={termLabel}
            via={loaded.via}
            sections={termSections}
            named={termNamed}
            identified={termIdentified}
            surnameMatches={termSurnameMatches}
            onReport={() => setDialog({ type: "report" })}
          />
        )}
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <Icon name="book" size={18} />
            <span>Buckeye Course Guide</span>
            <span className="footer-unofficial">
              Independent. Student built.
            </span>
          </div>
          <div className="footer-links">
            <button onClick={() => setDialog({ type: "report" })}>
              Report a data issue
            </button>
            <button onClick={() => setDialog({ type: "privacy" })}>
              Privacy
            </button>
            <a href="https://classes.osu.edu/" target="_blank" rel="noreferrer">
              Official class search <Icon name="external" size={12} />
            </a>
          </div>
        </div>
        <p className="footer-disclaimer">
          Not affiliated with The Ohio State University. Planning does not
          enroll you in a course.
        </p>
      </footer>
      {compared.length > 0 && (
        <div className="compare-tray">
          <span>
            <Icon name="compare" size={18} />
            <strong>{compared.length} sections selected</strong>
            <span className="tray-hint">Compare up to 3</span>
          </span>
          <div>
            <button className="text-button" onClick={() => setCompared([])}>
              Clear
            </button>
            <button
              className="button button-primary small"
              onClick={() => setDialog({ type: "compare" })}
            >
              Compare sections <Icon name="arrow" size={15} />
            </button>
          </div>
        </div>
      )}
      <div
        className={`toast ${notice ? "visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        {notice && (
          <>
            <Icon name="check" size={16} />
            {notice}
          </>
        )}
      </div>

      {dialog?.type === "instructor" && (
        <Modal title={dialog.instructor.name} onClose={() => setDialog(null)}>
          <div className="profile-intro">
            <span className="profile-icon">
              <Icon name="people" size={24} />
            </span>
            <div>
              <span className="eyebrow">
                {"confidence" in dialog.instructor
                  ? "LIKELY INSTRUCTOR MATCH"
                  : "PUBLISHED TEACHING ASSIGNMENTS"}
              </span>
              <p>{termLabel} · Imported subjects only</p>
            </div>
          </div>
          {allPeople
            .find((p) => p.instructor.id === dialog.instructor.id)
            ?.courses.map((course) => (
              <div className="profile-course" key={course.id}>
                <span className="course-code">{courseCode(course)}</span>
                <h3>{course.title}</h3>
                <div className="profile-section-list">
                  {course.sections
                    .filter(
                      (s) =>
                        s.instructors.some(
                          (i) => i.id === dialog.instructor.id,
                        ) ||
                        fullNameMatches(s).some(
                          (i) => i.id === dialog.instructor.id,
                        ),
                    )
                    .map((section) => (
                      <div key={section.id}>
                        <span>
                          Section {section.section} · #{section.classNumber}
                        </span>
                        <span className="cell-secondary">
                          {instructorEvidenceLabel(section)}
                        </span>
                        <MeetingSummary section={section} compact />
                      </div>
                    ))}
                </div>
              </div>
            ))}
          <p className="fine-print">
            {"confidence" in dialog.instructor
              ? "This full name is a likely match based on official OSU records, published teaching history, and current surname-search evidence. The section’s identity and teaching role remain inferred."
              : "These assignments come from the source snapshot and may change. Check official department information when needed."}
          </p>
          {selectedIdentity && (
            <div className="profile-evidence-links">
              {selectedIdentity.sourceUrls.map((url, index) => (
                <a
                  key={url}
                  className="inline-link"
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {index === 0
                    ? "Official identity source"
                    : `Supporting source ${index + 1}`}{" "}
                  <Icon name="external" size={12} />
                </a>
              ))}
            </div>
          )}
          <div className="modal-actions">
            <a
              className="button button-secondary"
              href={
                selectedIdentity?.profileUrl ??
                ("profileUrl" in dialog.instructor
                  ? dialog.instructor.profileUrl
                  : `https://www.osu.edu/search/?query=${encodeURIComponent(dialog.instructor.name)}`)
              }
              target="_blank"
              rel="noreferrer"
            >
              {selectedIdentity || "profileUrl" in dialog.instructor
                ? "Official OSU records"
                : "Search OSU directory"}{" "}
              <Icon name="external" size={14} />
            </a>
            <a
              className="button button-secondary"
              href={instructorRatingUrl(selectedIdentity ?? dialog.instructor)}
              target="_blank"
              rel="noreferrer"
            >
              RateMyProfessors <Icon name="external" size={14} />
            </a>
            <button
              className="button button-primary"
              onClick={() => {
                applyFilters({
                  ...filters,
                  subject: "",
                  number: "",
                  query: "",
                  instructor: dialog.instructor.name,
                });
                setDialog(null);
              }}
            >
              View sections <Icon name="arrow" size={15} />
            </button>
          </div>
        </Modal>
      )}
      {dialog?.type === "compare" && (
        <Modal
          title="A closer look at your options"
          onClose={() => setDialog(null)}
          wide
        >
          {compared.length ? (
            <div className="comparison-grid">
              {compared.map(({ course, section }) => (
                <div className="comparison-card" key={section.id}>
                  <div className="comparison-heading">
                    <span className="course-code">{courseCode(course)}</span>
                    <button
                      className="icon-button"
                      aria-label={`Remove class ${section.classNumber} from comparison`}
                      onClick={() => compareSection(course, section)}
                    >
                      <Icon name="close" size={15} />
                    </button>
                  </div>
                  <h3>Section {section.section}</h3>
                  <p className="muted">
                    Class #{section.classNumber} ·{" "}
                    {
                      catalog.terms.find((t) => t.code === course.termCode)
                        ?.label
                    }
                  </p>
                  <dl>
                    <dt>Instructor</dt>
                    <dd>
                      {instructorLabel(section)}
                      {!section.instructors.length &&
                        section.instructorDiscovery && (
                          <span className="cell-secondary">
                            {instructorEvidenceLabel(section)}
                          </span>
                        )}
                    </dd>
                    <dt>Schedule</dt>
                    <dd>
                      <MeetingSummary section={section} />
                    </dd>
                    <dt>Delivery</dt>
                    <dd>{section.instructionMode}</dd>
                    <dt>Location</dt>
                    <dd>
                      {section.meetings
                        .map((m) =>
                          [m.building, m.room].filter(Boolean).join(" "),
                        )
                        .filter(Boolean)
                        .join("; ") || "Not provided"}
                    </dd>
                    <dt>Enrollment snapshot</dt>
                    <dd>
                      <EnrollmentBadge section={section} />
                    </dd>
                    <dt>Credits</dt>
                    <dd>{course.credits}</dd>
                  </dl>
                  <button
                    className={`button ${savedIds.has(section.id) ? "button-secondary" : "button-primary"}`}
                    onClick={() => saveSection(course, section)}
                  >
                    <Icon
                      name={savedIds.has(section.id) ? "check" : "plus"}
                      size={15}
                    />
                    {savedIds.has(section.id)
                      ? "Remove from plan"
                      : "Add to plan"}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p>
              No sections selected. Add sections to compare from course search.
            </p>
          )}
          <p className="fine-print">
            Meeting times are Eastern. Verify current assignments and linked
            components before enrolling.
          </p>
        </Modal>
      )}
      {dialog?.type === "privacy" && (
        <Modal title="Your plan stays with you" onClose={() => setDialog(null)}>
          <div className="prose">
            <p>
              Your saved section IDs are stored in this browser’s local storage.
              There is no account, and this version does not sync your plan
              across devices.
            </p>
            <p>
              Use “Clear this term” in My schedule to remove a semester’s saved
              selections. Clearing this site’s browser data removes the entire
              plan.
            </p>
            <p>
              Search filters appear in shareable URLs. Hosting providers may
              retain standard access logs. The app includes no advertising or
              analytics trackers.
            </p>
            <p>
              Official-source and directory links take you to other sites with
              their own policies. Checking current seats contacts OSU directly
              for the selected section. A calendar download is created in your
              browser.
            </p>
          </div>
        </Modal>
      )}
      {dialog?.type === "report" && (
        <Modal
          title="Help keep the catalog useful"
          onClose={() => setDialog(null)}
        >
          <div className="prose">
            <p>
              Before reporting a difference, compare the snapshot’s collection
              time with the current{" "}
              <a
                href="https://classes.osu.edu/"
                target="_blank"
                rel="noreferrer"
              >
                official class search
              </a>
              .
            </p>
            <p>
              Include the semester, subject and course number, class number,
              what looks incorrect, and an official source link. An unresolved
              instructor has not been identified by the current search coverage;
              this does not prove the section is unassigned.
            </p>
            <div className="report-template">
              <strong>Data issue checklist</strong>
              <p>
                Semester: {termLabel}
                <br />
                Course: {filters.subject} {filters.number}
                <br />
                Class number:
                <br />
                Expected information:
                <br />
                Official source:
                <br />
                Oldest source check: {termCollectedAt}
              </p>
            </div>
            <p className="fine-print">
              Report delivery hasn’t been configured for this local build. Copy
              these details to share with the project’s maintainers; this dialog
              sends nothing.
            </p>
            <button
              className="button button-secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    `Data issue\nSemester: ${termLabel}\nCourse: ${filters.subject} ${filters.number}\nClass number: \nExpected information: \nOfficial source: \nOldest source check: ${termCollectedAt}`,
                  );
                  notify("Issue template copied.");
                } catch {
                  notify(
                    "Clipboard unavailable. Select and copy the details above.",
                  );
                }
              }}
            >
              <Icon name="copy" size={15} />
              Copy issue template
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function SchedulePage({
  items,
  missingCount,
  conflicts,
  termLabel,
  onSave,
  onSearch,
  onExport,
  onClear,
}: {
  items: PlannedSection[];
  missingCount: number;
  conflicts: ReturnType<typeof findConflicts>;
  termLabel: string;
  onSave: (c: Course, s: Section) => void;
  onSearch: () => void;
  onExport: () => void;
  onClear: () => void;
}) {
  const [layout, setLayout] = useState<"week" | "list">("week");
  const conflictIds = new Set(conflicts.flatMap((c) => [c.leftId, c.rightId]));
  const uniqueCourses = new Map(
    items.map((item) => [item.course.id, item.course]),
  );
  const credits = [...uniqueCourses.values()].reduce(
    (sum, c) => sum + (Number(c.credits) || 0),
    0,
  );
  const scheduledMeetings = items.flatMap((item, color) =>
    item.section.meetings
      .filter((m) => m.startTime && m.endTime && m.days.length)
      .map((meeting) => ({ ...item, meeting, color })),
  );
  const visibleDays = [
    "MO",
    "TU",
    "WE",
    "TH",
    "FR",
    ...["SA", "SU"].filter((d) =>
      scheduledMeetings.some((m) => m.meeting.days.includes(d)),
    ),
  ];
  const starts = scheduledMeetings.map(
    (m) => minutes(m.meeting.startTime) ?? 480,
  );
  const ends = scheduledMeetings.map((m) => minutes(m.meeting.endTime) ?? 1080);
  const dayStart = Math.min(
    480,
    Math.floor(Math.min(...starts, 480) / 60) * 60,
  );
  const dayEnd = Math.max(1080, Math.ceil(Math.max(...ends, 1080) / 60) * 60);
  const hours = Array.from(
    { length: Math.ceil((dayEnd - dayStart) / 60) + 1 },
    (_, i) => dayStart + i * 60,
  );
  return (
    <section className="schedule-page">
      <div className="schedule-toolbar">
        <div>
          <h2>
            {termLabel} plan{" "}
            <span className="count-badge">{items.length} sections</span>
          </h2>
          <p>
            {uniqueCourses.size} courses · {credits} listed credits
            {items.some((i) => !/^\d+(\.\d+)?$/.test(i.course.credits))
              ? " + variable/unknown credits"
              : ""}
          </p>
        </div>
        <div className="schedule-controls">
          <button
            className="text-button"
            disabled={!items.length && !missingCount}
            onClick={() => {
              if (window.confirm(`Clear all saved sections for ${termLabel}?`))
                onClear();
            }}
          >
            Clear this term
          </button>
          <button
            className="button button-secondary small"
            disabled={!items.length}
            onClick={onExport}
          >
            <Icon name="download" size={15} />
            Export calendar
          </button>
          <div className="segmented-control">
            <button
              aria-pressed={layout === "week"}
              className={layout === "week" ? "active" : ""}
              onClick={() => setLayout("week")}
              aria-label="Weekly schedule view"
            >
              <Icon name="calendar" size={16} />
            </button>
            <button
              aria-pressed={layout === "list"}
              className={layout === "list" ? "active" : ""}
              onClick={() => setLayout("list")}
              aria-label="Saved sections list view"
            >
              <Icon name="menu" size={16} />
            </button>
          </div>
        </div>
      </div>
      {!!missingCount && (
        <div className="inline-alert warning">
          <Icon name="warning" size={17} />
          {missingCount} saved section(s) are no longer in this snapshot. They
          remain stored on this device until you clear this term.
        </div>
      )}
      {!!conflicts.length && (
        <div className="inline-alert warning">
          <Icon name="warning" size={17} />
          <span>
            <strong>
              {conflicts.length} meeting conflict
              {conflicts.length > 1 ? "s" : ""}.
            </strong>{" "}
            Highlighted sections overlap on at least one scheduled date. Choose
            alternatives before enrolling.
          </span>
        </div>
      )}
      {!items.length ? (
        <div className="empty-state schedule-empty">
          <span className="empty-icon">
            <Icon name="calendar" size={32} />
          </span>
          <h2>A fresh semester starts here.</h2>
          <p>
            Add sections from course search to see your week take shape.
            Everything stays on this device.
          </p>
          <button className="button button-primary" onClick={onSearch}>
            Find your first course <Icon name="arrow" size={16} />
          </button>
        </div>
      ) : (
        <>
          {layout === "week" && (
            <div className="week-scroll">
              <div
                className="week-grid"
                style={{
                  gridTemplateColumns: `58px repeat(${visibleDays.length}, minmax(130px, 1fr))`,
                }}
              >
                <div className="week-corner">ET</div>
                {visibleDays.map((day) => (
                  <div className="week-day" key={day}>
                    {DAY_LABELS[day]}
                  </div>
                ))}
                <div
                  className="week-times"
                  style={{ height: (dayEnd - dayStart) * 0.85 }}
                >
                  {hours.slice(0, -1).map((hour) => (
                    <span key={hour} style={{ top: (hour - dayStart) * 0.85 }}>
                      {formatTime(`${Math.floor(hour / 60)}:00`).replace(
                        ":00",
                        "",
                      )}
                    </span>
                  ))}
                </div>
                {visibleDays.map((day) => (
                  <div
                    className="week-column"
                    key={day}
                    style={{ height: (dayEnd - dayStart) * 0.85 }}
                  >
                    {hours.map((hour) => (
                      <span
                        className="hour-line"
                        key={hour}
                        style={{ top: (hour - dayStart) * 0.85 }}
                      />
                    ))}
                    {scheduledMeetings
                      .filter((item) => item.meeting.days.includes(day))
                      .map(({ course, section, meeting, color }, i) => (
                        <div
                          key={`${section.id}-${i}`}
                          className={`calendar-event color-${color % 6} ${conflictIds.has(section.id) ? "event-conflict" : ""}`}
                          style={{
                            top:
                              ((minutes(meeting.startTime) ?? dayStart) -
                                dayStart) *
                              0.85,
                            minHeight: 38,
                            height: Math.max(
                              38,
                              ((minutes(meeting.endTime) ?? dayStart) -
                                (minutes(meeting.startTime) ?? dayStart)) *
                                0.85 -
                                3,
                            ),
                          }}
                          title={`${courseCode(course)} ${section.component} ${section.section} · ${formatTime(meeting.startTime)}–${formatTime(meeting.endTime)} · ${meeting.startDate}–${meeting.endDate}`}
                        >
                          <strong>{courseCode(course)}</strong>
                          <span>
                            {formatTime(meeting.startTime)}–
                            {formatTime(meeting.endTime)}
                          </span>
                          <span>
                            {meeting.building} {meeting.room}
                          </span>
                        </div>
                      ))}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="planned-list">
            {items.map(({ course, section }, i) => (
              <article
                className={`planned-card ${conflictIds.has(section.id) ? "planned-conflict" : ""}`}
                key={section.id}
              >
                <span className={`plan-color color-${i % 6}`} />
                <div className="planned-main">
                  <span className="course-code">{courseCode(course)}</span>
                  <h3>{course.title}</h3>
                  <p>
                    Section {section.section} · #{section.classNumber} ·{" "}
                    {section.component}
                  </p>
                  <span className="muted">
                    {instructorLabel(section)}
                    {!section.instructors.length &&
                      section.instructorDiscovery && (
                        <> · {instructorEvidenceLabel(section)}</>
                      )}
                  </span>
                </div>
                <MeetingSummary section={section} />
                {conflictIds.has(section.id) && (
                  <span className="conflict-tag">
                    <Icon name="warning" size={13} />
                    Time conflict
                  </span>
                )}
                <button
                  className="icon-button"
                  onClick={() => onSave(course, section)}
                  aria-label={`Remove ${courseCode(course)} section ${section.section}`}
                >
                  <Icon name="trash" size={18} />
                </button>
              </article>
            ))}
          </div>
          <p className="fine-print schedule-note">
            <Icon name="info" size={15} />
            The week combines all saved date ranges; sections in different
            sessions may appear together. Calendar exports use actual meeting
            dates but do not exclude holidays. TBA times and dates cannot be
            checked for conflicts. Check linked lectures, labs, and recitations
            in BuckeyeLink.
          </p>
        </>
      )}
    </section>
  );
}

function DataStatus({
  catalog,
  termCode,
  campus,
  termLabel,
  via,
  sections,
  named,
  identified,
  surnameMatches,
  onReport,
}: {
  catalog: Catalog;
  termCode: string;
  campus: string;
  termLabel: string;
  via: string;
  sections: number;
  named: number;
  identified: number;
  surnameMatches: number;
  onReport: () => void;
}) {
  const coverage = catalog.coverage.filter(
    (c) => c.termCode === termCode && (!campus || c.campus === campus),
  );
  const percent = sections
    ? Math.round((identified / sections) * 1000) / 10
    : 0;
  return (
    <section className="data-page">
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-icon">
            <Icon name="book" size={22} />
          </span>
          <span className="stat-label">IMPORTED SECTIONS</span>
          <strong>{sections.toLocaleString()}</strong>
          <span>{termLabel} · selected coverage</span>
        </div>
        <div className="stat-card">
          <span className="stat-icon green">
            <Icon name="people" size={22} />
          </span>
          <span className="stat-label">FULL NAME COVERAGE</span>
          <strong>{percent}%</strong>
          <span>
            {named.toLocaleString()} published ·{" "}
            {Math.max(0, identified - named).toLocaleString()} likely full-name
            matches
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-icon amber">
            <Icon name="clock" size={22} />
          </span>
          <span className="stat-label">INSTRUCTOR NOT RESOLVED</span>
          <strong>{Math.max(0, sections - identified).toLocaleString()}</strong>
          <span>May need further searches or an OSU assignment update</span>
        </div>
      </div>
      <div className="data-panels">
        <article className="panel">
          <div className="panel-title">
            <Icon name="status" size={20} />
            <h2>What’s in this snapshot</h2>
            <span className="tag">Published coverage</span>
          </div>
          <dl className="data-dl">
            <dt>Oldest source check</dt>
            <dd>
              {formatDate(collectedAt(catalog, termCode, campus), {
                month: "long",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
                timeZoneName: "short",
              })}
            </dd>
            <dt>Serving from</dt>
            <dd>
              {via === "api" ? "Spring Boot API" : "Published catalog snapshot"}
            </dd>
            <dt>Semester</dt>
            <dd>{termLabel}</dd>
            <dt>Surname search evidence</dt>
            <dd>
              {surnameMatches.toLocaleString()} sections matched by surname;
              full identities may remain unresolved.
            </dd>
            {coverage.map((c) => (
              <div
                className="coverage-dl-group"
                key={`${c.termCode}-${c.campus}-${c.subjects.join("-")}`}
              >
                <dt>
                  {catalog.campuses.find((campus) => campus.code === c.campus)
                    ?.label ?? c.campus}
                </dt>
                <dd>
                  {c.subjects.join(", ")}
                  <span className="data-subtext">
                    {c.courseCount.toLocaleString()} courses ·{" "}
                    {c.sectionCount.toLocaleString()} sections ·{" "}
                    {c.complete
                      ? "All pages fetched for this scope"
                      : "Partial import"}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="fine-print">
            Coverage above lists the semesters, campuses and subjects included
            in this snapshot. Sections refresh through the configured import
            schedule; check the source timestamps for freshness.
          </p>
        </article>
        <article className="panel">
          <div className="panel-title">
            <Icon name="external" size={20} />
            <h2>Sources you can check</h2>
          </div>
          <a
            className="source-card"
            href={catalog.source.url}
            target="_blank"
            rel="noreferrer"
          >
            <span className="source-icon">
              <Icon name="book" size={21} />
            </span>
            <div>
              <strong>Ohio State Class Search</strong>
              <span>
                Official course, section, meeting, and published instructor
                records
              </span>
            </div>
            <Icon name="external" size={16} />
          </a>
          <a
            className="source-card"
            href="https://buckeyelink.osu.edu/"
            target="_blank"
            rel="noreferrer"
          >
            <span className="source-icon">
              <Icon name="calendar" size={21} />
            </span>
            <div>
              <strong>BuckeyeLink</strong>
              <span>
                Confirm availability, requirements, and complete your enrollment
              </span>
            </div>
            <Icon name="external" size={16} />
          </a>
          <a
            className="source-card"
            href="https://registrar.osu.edu/student-hub/course-enrollment-information/"
            target="_blank"
            rel="noreferrer"
          >
            <span className="source-icon">
              <Icon name="info" size={21} />
            </span>
            <div>
              <strong>University Registrar</strong>
              <span>Enrollment guidance and academic information</span>
            </div>
            <Icon name="external" size={16} />
          </a>
        </article>
      </div>
      <article className="panel limitations-panel">
        <div className="panel-title">
          <Icon name="info" size={20} />
          <h2>A few things to keep in mind</h2>
        </div>
        <div className="limitations-grid">
          <div>
            <strong>Instructor evidence.</strong>
            <p>
              Published assignments and likely full-name matches are labeled
              separately. Likely names use official profile and teaching-history
              evidence; multiple possible candidates remain visible.
            </p>
          </div>
          <div>
            <strong>Availability is a snapshot.</strong>
            <p>
              Open, closed, and waitlist labels reflect the last collection.
              Open a section’s details and choose “Check current seats” for
              current capacity, available seats and waitlist counts when
              supplied by OSU.
            </p>
          </div>
          <div>
            <strong>Your schedule is a plan.</strong>
            <p>
              Saved sections live on this device. Check prerequisites, linked
              components, holidays, and official requirements before enrolling.
            </p>
          </div>
        </div>
        <div className="data-report">
          <span>Found something that doesn’t look right?</span>
          <button className="text-button" onClick={onReport}>
            Report a data issue <Icon name="arrow" size={15} />
          </button>
        </div>
      </article>
    </section>
  );
}

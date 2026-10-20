import { useState } from "react";
import {
  courseCode,
  DAY_LABELS,
  formatDate,
  formatTime,
  fullNameMatches,
  hasSingleFullNameMatch,
  hasSurnameMatch,
  instructorLabel,
  instructorEvidenceLabel,
  instructorRatingUrl,
  isInstructorIdentified,
  matchedSurnames,
  sectionInstructorNames,
  sortSections,
} from "../domain/catalog";
import type {
  Course,
  InstructorIdentityMatch,
  InstructorProfile,
  Section,
} from "../domain/types";
import Icon from "./Icon";

export function EnrollmentBadge({ section }: { section: Section }) {
  const status = section.enrollment.status;
  return (
    <span
      className={`enrollment-badge ${status.toLowerCase()}`}
      title="Status when this snapshot was collected; verify current availability in BuckeyeLink."
    >
      <span className="status-dot" />
      {
        {
          OPEN: "Open",
          WAITLIST: "Waitlist",
          CLOSED: "Closed",
          UNKNOWN: "Not provided",
          CANCELLED: "Cancelled",
        }[status]
      }
    </span>
  );
}

export function MeetingSummary({
  section,
  compact = false,
}: {
  section: Section;
  compact?: boolean;
}) {
  const first =
    section.meetings.find((m) => m.days.length || m.startTime) ??
    section.meetings[0];
  if (!first) return <span className="muted">Schedule TBA</span>;
  const days = first.days.map((day) => DAY_LABELS[day] ?? day).join(", ");
  return (
    <div className="cell-lines">
      <span className="cell-primary">{days || "Days TBA"}</span>
      <span className="cell-secondary">
        {first.startTime && first.endTime
          ? `${formatTime(first.startTime)} – ${formatTime(first.endTime)}`
          : "Time not provided"}
      </span>
      {!compact && section.meetings.length > 1 && (
        <span className="cell-note">
          +{section.meetings.length - 1} meeting
          {section.meetings.length > 2 ? "s" : ""}
        </span>
      )}
    </div>
  );
}

interface Props {
  course: Course;
  termLabel: string;
  saved: Set<string>;
  compared: Set<string>;
  onSave: (course: Course, section: Section) => void;
  onCompare: (course: Course, section: Section) => void;
  onInstructor: (instructor: InstructorProfile) => void;
  notify: (message: string) => void;
  identityProfiles?: Map<string, InstructorIdentityMatch>;
  onPreviousTerm?: () => void;
}

export default function CourseCard({
  course,
  termLabel,
  saved,
  compared,
  onSave,
  onCompare,
  onInstructor,
  notify,
  identityProfiles,
  onPreviousTerm,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState("section");
  const [visible, setVisible] = useState(12);
  const pieces = course.description.split(/\n(?=Prereq:)/);
  const prerequisites =
    course.prerequisites ??
    pieces
      .find((p) => p.startsWith("Prereq:"))
      ?.slice(7)
      .trim();
  const sorted = sortSections(course.sections, sort);
  const identified = course.sections.filter(isInstructorIdentified).length;
  const hasInstructorEvidence = course.sections.some(
    (s) => sectionInstructorNames(s).length > 0,
  );
  const toggle = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function copyClass(classNumber: string) {
    try {
      await navigator.clipboard.writeText(classNumber);
      notify(`Class #${classNumber} copied.`);
    } catch {
      notify(`Class number: ${classNumber}`);
    }
  }

  return (
    <article className="course-card">
      <div className="course-heading">
        <div className="course-code-row">
          <span className="course-code">{courseCode(course)}</span>
          <span className="tag">{course.career || "Course"}</span>
          {course.attributes.slice(0, 2).map((a) => (
            <span className="tag" key={a}>
              {a}
            </span>
          ))}
        </div>
        <h2>{course.title}</h2>
        <div className="course-meta">
          <span>
            <Icon name="book" size={15} />
            {/^\d/.test(course.credits)
              ? `${course.credits} ${course.credits === "1" ? "credit hour" : "credit hours"}`
              : "Credits not published"}
          </span>
          <span>
            <Icon name="people" size={15} />
            {identified} of {course.sections.length} sections with an identified
            instructor
          </span>
          <span>
            <Icon name="pin" size={15} />
            {course.campus === "col" ? "Columbus" : course.campus}
          </span>
        </div>
        {pieces[0] && <p className="course-description">{pieces[0]}</p>}
        {prerequisites && (
          <p className="course-prerequisites">
            <strong>Prerequisites</strong> {prerequisites}
          </p>
        )}
      </div>
      <div className="section-toolbar">
        <div className="section-toolbar-label">
          <Icon name="grid" size={15} />
          <strong>{termLabel} sections</strong>
          <span className="count-badge">{course.sections.length}</span>
        </div>
        <label className="sort-control">
          Sort by{" "}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label={`Sort ${courseCode(course)} sections`}
          >
            <option value="section">Section number</option>
            <option value="time">Meeting time</option>
            <option value="instructor">Instructor name</option>
            <option value="status">Enrollment status</option>
          </select>
          <Icon name="down" size={13} />
        </label>
      </div>
      {!hasInstructorEvidence && (
        <div className="assignment-notice">
          <Icon name="info" size={16} />
          <span>
            Current imports have not resolved instructors for these sections.
          </span>
          {onPreviousTerm && (
            <button className="text-button" onClick={onPreviousTerm}>
              See past term <Icon name="arrow" size={14} />
            </button>
          )}
        </div>
      )}
      <div className="table-wrap">
        <table className="sections-table">
          <thead>
            <tr>
              <th scope="col">Section</th>
              <th scope="col">Instructor</th>
              <th scope="col">Days & time</th>
              <th scope="col">Location</th>
              <th scope="col">
                Status <span className="header-note">at last update</span>
              </th>
              <th scope="col">
                <span className="sr-only">Plan section</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, visible).map((section) => {
              const first =
                section.meetings.find((m) => m.building || m.room) ??
                section.meetings[0];
              const isOpen = expanded.has(section.id);
              const isSaved = saved.has(section.id);
              const isCompared = compared.has(section.id);
              const surnames = matchedSurnames(section);
              const identities = section.instructors.length
                ? section.instructors
                : fullNameMatches(section);
              return (
                <SectionRows key={section.id}>
                  <tr
                    className={
                      isOpen ? "section-row is-expanded" : "section-row"
                    }
                  >
                    <td>
                      <div className="section-number">
                        <button
                          className={`expand-button ${isOpen ? "expanded" : ""}`}
                          onClick={() => toggle(section.id)}
                          aria-expanded={isOpen}
                          aria-controls={`details-${section.id}`}
                          aria-label={`${isOpen ? "Hide" : "Show"} details for section ${section.section}`}
                        >
                          <Icon name="chevron" size={16} />
                        </button>
                        <div className="cell-lines">
                          <span className="cell-primary section-value">
                            {section.section}
                          </span>
                          <span className="cell-secondary class-number">
                            #{section.classNumber}
                          </span>
                          <span className="cell-note">{section.component}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="cell-lines">
                        {identities.length ? (
                          identities.map((instructor) => (
                            <div
                              className="instructor-identity"
                              key={instructor.id}
                            >
                              <button
                                className="instructor-link"
                                onClick={() => onInstructor(instructor)}
                              >
                                {instructor.name}
                              </button>
                              <a
                                className="instructor-review-link"
                                href={instructorRatingUrl(
                                  identityProfiles?.get(instructor.id) ??
                                    instructor,
                                )}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Look up ${instructor.name} on RateMyProfessors`}
                              >
                                RateMyProfessors{" "}
                                <Icon name="external" size={11} />
                              </a>
                            </div>
                          ))
                        ) : surnames.length ? (
                          <span className="cell-primary surname-match">
                            {instructorLabel(section)}
                          </span>
                        ) : (
                          <span className="tba-label">
                            Instructor not resolved{" "}
                            <Icon name="info" size={13} />
                          </span>
                        )}
                        {!section.instructors.length &&
                          identities.length > 0 &&
                          surnames
                            .filter(
                              (surname) =>
                                !fullNameMatches(section).some(
                                  (identity) =>
                                    identity.surname.toLowerCase() ===
                                    surname.toLowerCase(),
                                ),
                            )
                            .map((surname) => (
                              <span
                                className="cell-primary surname-match"
                                key={surname}
                              >
                                {surname} · Full name unresolved
                              </span>
                            ))}
                        <span className="cell-secondary">
                          {section.instructors[0]?.role ||
                            instructorEvidenceLabel(section)}
                        </span>
                      </div>
                    </td>
                    <td>
                      <MeetingSummary section={section} />
                    </td>
                    <td>
                      <div className="cell-lines">
                        <span className="cell-primary location-value">
                          {first?.building || "Location TBA"}
                          {first?.room ? ` ${first.room}` : ""}
                        </span>
                        <span className="cell-secondary">
                          {section.instructionMode || "Mode not provided"}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="cell-lines">
                        <EnrollmentBadge section={section} />
                        <span className="cell-secondary">
                          {section.enrollment.enrolled != null
                            ? `${section.enrollment.enrolled} enrolled`
                            : "Count not provided"}
                          {section.enrollment.waitlist
                            ? ` · ${section.enrollment.waitlist} waiting`
                            : ""}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="section-actions">
                        <button
                          className={`icon-button compare-button ${isCompared ? "selected" : ""}`}
                          onClick={() => onCompare(course, section)}
                          aria-pressed={isCompared}
                          aria-label={`${isCompared ? "Remove" : "Add"} section ${section.section} ${isCompared ? "from" : "to"} comparison`}
                          title="Compare section"
                        >
                          <Icon name="compare" size={17} />
                        </button>
                        <button
                          className={`save-button ${isSaved ? "saved" : ""}`}
                          onClick={() => onSave(course, section)}
                          aria-pressed={isSaved}
                          aria-label={`${isSaved ? "Remove" : "Add"} ${courseCode(course)} section ${section.section} ${isSaved ? "from" : "to"} schedule`}
                        >
                          <Icon name={isSaved ? "check" : "plus"} size={16} />
                          {isSaved ? "Added" : "Add"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="details-row" id={`details-${section.id}`}>
                      <td colSpan={6}>
                        <div className="section-details">
                          <div>
                            <h3>Meeting details</h3>
                            {section.meetings.length ? (
                              section.meetings.map((m, i) => (
                                <div className="meeting-detail" key={i}>
                                  <strong>
                                    {m.days
                                      .map((d) => DAY_LABELS[d] ?? d)
                                      .join(", ") || "Days not provided"}{" "}
                                    ·{" "}
                                    {m.startTime && m.endTime
                                      ? `${formatTime(m.startTime)}–${formatTime(m.endTime)}`
                                      : "Time TBA"}
                                  </strong>
                                  <span>
                                    {[m.building, m.room]
                                      .filter(Boolean)
                                      .join(" ") || "Location not provided"}
                                  </span>
                                  <span>
                                    {formatDate(m.startDate)} –{" "}
                                    {formatDate(m.endDate)}
                                  </span>
                                </div>
                              ))
                            ) : (
                              <p>
                                The source does not list meeting information.
                              </p>
                            )}
                          </div>
                          <div>
                            <h3>Assignment & availability</h3>
                            <p>
                              {section.instructors.length
                                ? "Instructor names are published in the official OSU source."
                                : hasSingleFullNameMatch(section)
                                  ? "Likely full-name match using official OSU records and published teaching history. This section’s full identity and teaching role remain inferred."
                                  : identities.length
                                    ? "Multiple full-name candidates match the surname evidence. No single instructor identity is confirmed for this section."
                                    : hasSurnameMatch(section)
                                      ? "Surname matched in OSU search. First name and teaching role not exposed."
                                      : surnames.length
                                        ? "Multiple surname searches matched this section. Full instructor identity remains unresolved."
                                        : "No name found in current search coverage; this does not prove the section is unassigned. The base course feed does not publish an instructor name."}
                            </p>
                            {!section.instructors.length &&
                              fullNameMatches(section).map((identity) => (
                                <p key={identity.id}>
                                  <a
                                    className="inline-link"
                                    href={identity.profileUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {identity.name} · Official OSU records{" "}
                                    <Icon name="external" size={13} />
                                  </a>
                                  <span className="cell-secondary">
                                    Identity sources checked{" "}
                                    {formatDate(identity.checkedAt)} · Likely
                                    match
                                  </span>
                                </p>
                              ))}
                            {!section.instructors.length &&
                              !!surnames.length &&
                              section.instructorDiscovery && (
                                <p className="discovery-provenance">
                                  Exact last-name search checked{" "}
                                  {formatDate(
                                    section.instructorDiscovery.checkedAt,
                                    {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                      hour: "numeric",
                                      minute: "2-digit",
                                      timeZoneName: "short",
                                    },
                                  )}
                                  .{" "}
                                  <a
                                    className="inline-link"
                                    href={section.instructorDiscovery.sourceUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open OSU instructor search{" "}
                                    <Icon name="external" size={13} />
                                  </a>
                                </p>
                              )}
                            <p>
                              Collected{" "}
                              {formatDate(section.lastUpdated, {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                                timeZoneName: "short",
                              })}
                              . Seat capacity is not provided.
                            </p>
                            <a
                              className="inline-link"
                              href={section.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View source record{" "}
                              <Icon name="external" size={13} />
                            </a>
                          </div>
                          <div>
                            <h3>Plan, then enroll</h3>
                            <p>
                              Adding a section saves it on this device. Complete
                              enrollment and check current availability in
                              BuckeyeLink.
                            </p>
                            <div className="details-actions">
                              <a
                                className="button button-secondary small"
                                href="https://buckeyelink.osu.edu/"
                                target="_blank"
                                rel="noreferrer"
                              >
                                BuckeyeLink <Icon name="external" size={14} />
                              </a>
                              <button
                                className="text-button"
                                onClick={() =>
                                  void copyClass(section.classNumber)
                                }
                              >
                                <Icon name="copy" size={14} />
                                Copy #{section.classNumber}
                              </button>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </SectionRows>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="course-footer">
        <span>
          Showing {Math.min(visible, sorted.length)} of {sorted.length} sections
        </span>
        {visible < sorted.length ? (
          <button
            className="text-button"
            onClick={() => setVisible((v) => v + 12)}
          >
            Show more sections <Icon name="down" size={14} />
          </button>
        ) : (
          <span className="footer-hint">
            <Icon name="info" size={13} />
            All times Eastern
          </span>
        )}
      </div>
    </article>
  );
}

function SectionRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

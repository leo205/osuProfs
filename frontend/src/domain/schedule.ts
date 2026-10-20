import type { Catalog, Meeting, PlannedSection, SavedReference } from "./types";
import {
  fullNameMatches,
  hasSingleFullNameMatch,
  hasSurnameMatch,
  instructorLabel,
  matchedSurnames,
} from "./catalog";

export interface Conflict {
  leftId: string;
  rightId: string;
  days: string[];
}
export interface CalendarExport {
  content: string;
  eventCount: number;
  skippedMeetings: number;
}

const DAY_MS = 86_400_000;
const DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const MAX_MEETING_DAYS = 366;
const MAX_CALENDAR_EVENTS = 10_000;
const encoder = new TextEncoder();

/** Strict 24-hour time parsing. Unknown times never mean asynchronous classes. */
export function minutes(time: string | null): number | null {
  if (!time || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function dateDay(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    return null;
  return date.getTime();
}

function validMeeting(meeting: Meeting): {
  start: number;
  end: number;
  first: number;
  last: number;
  days: string[];
} | null {
  const start = minutes(meeting.startTime),
    end = minutes(meeting.endTime);
  const first = dateDay(meeting.startDate),
    last = dateDay(meeting.endDate);
  if (
    start === null ||
    end === null ||
    first === null ||
    last === null ||
    start >= end ||
    first > last ||
    !meeting.days.length ||
    meeting.days.some((day) => !DAYS.includes(day))
  )
    return null;
  return {
    start,
    end,
    first,
    last,
    days: DAYS.filter((day) => meeting.days.includes(day)),
  };
}

function occursWithin(day: string, first: number, last: number): boolean {
  const firstWeekday = (new Date(first).getUTCDay() + 6) % 7;
  const offset = (DAYS.indexOf(day) - firstWeekday + 7) % 7;
  return first + offset * DAY_MS <= last;
}

/** Resolve identifiers against the current snapshot without dropping stale references silently. */
export function resolveSaved(
  catalog: Catalog,
  refs: SavedReference[],
): {
  items: PlannedSection[];
  missing: SavedReference[];
} {
  const courses = new Map(
    catalog.courses.map((course) => [
      JSON.stringify([course.termCode, course.id]),
      course,
    ]),
  );
  const items: PlannedSection[] = [],
    missing: SavedReference[] = [];
  const seen = new Set<string>();
  for (const reference of refs) {
    const key = JSON.stringify([
      reference.termCode,
      reference.courseId,
      reference.sectionId,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    const course = courses.get(
      JSON.stringify([reference.termCode, reference.courseId]),
    );
    const section = course?.sections.find(
      (section) => section.id === reference.sectionId,
    );
    if (course && section) items.push({ course, section });
    else missing.push(reference);
  }
  return { items, missing };
}

/** Definite schedule overlaps only; missing meeting information cannot establish a conflict. */
export function findConflicts(items: PlannedSection[]): Conflict[] {
  const result: Conflict[] = [];
  const emitted = new Set<string>();
  for (let leftIndex = 0; leftIndex < items.length; leftIndex++) {
    const left = items[leftIndex];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < items.length;
      rightIndex++
    ) {
      const right = items[rightIndex];
      if (
        left.course.termCode !== right.course.termCode ||
        left.section.id === right.section.id
      )
        continue;
      const pairKey = JSON.stringify(
        [left.section.id, right.section.id].sort(),
      );
      if (emitted.has(pairKey)) continue;
      const overlapDays = new Set<string>();
      for (const leftMeeting of left.section.meetings) {
        const a = validMeeting(leftMeeting);
        if (!a) continue;
        for (const rightMeeting of right.section.meetings) {
          const b = validMeeting(rightMeeting);
          if (!b || a.start >= b.end || b.start >= a.end) continue;
          const first = Math.max(a.first, b.first),
            last = Math.min(a.last, b.last);
          if (first > last) continue;
          for (const day of a.days) {
            if (b.days.includes(day) && occursWithin(day, first, last))
              overlapDays.add(day);
          }
        }
      }
      if (overlapDays.size) {
        emitted.add(pairKey);
        result.push({
          leftId: left.section.id,
          rightId: right.section.id,
          days: DAYS.filter((day) => overlapDays.has(day)),
        });
      }
    }
  }
  return result;
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/** RFC 5545 section 3.1: fold at 75 octets without splitting UTF-8 characters. */
function foldLine(value: string): string {
  const lines: string[] = [];
  let line = "",
    size = 0;
  for (const character of value) {
    const length = encoder.encode(character).length;
    if (size + length > 75) {
      lines.push(line);
      line = " ";
      size = 1;
    }
    line += character;
    size += length;
  }
  lines.push(line);
  return lines.join("\r\n");
}

function calendarDate(day: number): string {
  return new Date(day).toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * Export each published meeting occurrence in Columbus local time. Contemporary
 * US DST rules apply from 2007 onward. Unverified historical dates are skipped.
 * Holidays and exceptional cancellations are unavailable in the source feed.
 */
export function calendarExport(items: PlannedSection[]): CalendarExport {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Buckeye Course Guide//Schedule Export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Buckeye course schedule",
    "X-WR-TIMEZONE:America/New_York",
    "BEGIN:VTIMEZONE",
    "TZID:America/New_York",
    "X-LIC-LOCATION:America/New_York",
    "BEGIN:DAYLIGHT",
    "DTSTART:20070311T020000",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "TZNAME:EDT",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "DTSTART:20071104T020000",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "TZNAME:EST",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  let eventCount = 0,
    skippedMeetings = 0;
  const seen = new Set<string>();
  for (const { course, section } of items) {
    if (seen.has(section.id)) continue;
    seen.add(section.id);
    section.meetings.forEach((meeting, meetingIndex) => {
      const valid = validMeeting(meeting);
      if (
        !valid ||
        valid.last - valid.first >= MAX_MEETING_DAYS * DAY_MS ||
        valid.first < Date.UTC(2007, 0, 1)
      ) {
        skippedMeetings++;
        return;
      }
      const dates: number[] = [];
      for (let day = valid.first; day <= valid.last; day += DAY_MS) {
        if (valid.days.includes(DAYS[(new Date(day).getUTCDay() + 6) % 7]))
          dates.push(day);
      }
      if (!dates.length || eventCount + dates.length > MAX_CALENDAR_EVENTS) {
        skippedMeetings++;
        return;
      }
      const surnames = matchedSurnames(section);
      const instructorDescription = section.instructors.length
        ? `Instructors: ${instructorLabel(section)}.`
        : hasSingleFullNameMatch(section)
          ? `Likely instructor: ${instructorLabel(section)}. Full-name identity is inferred from official OSU records and teaching history; the section assignment and primary role are not confirmed.`
          : fullNameMatches(section).length
            ? `Instructor candidates: ${instructorLabel(section)}. Multiple possible matches; no single identity is confirmed.`
            : hasSurnameMatch(section)
              ? `Instructor surname: ${instructorLabel(section)}. Matched in OSU search; first name and primary role are not confirmed.`
              : surnames.length
                ? `Instructor surname candidates: ${surnames.join(" / ")}. Multiple matches; full identity remains unresolved.`
                : "Instructor not resolved in current search coverage; this does not prove the section is unassigned.";
      const description = [
        `Section ${section.section}; class ${section.classNumber}. ${section.component}. ${section.instructionMode}.`,
        instructorDescription,
        ...(!section.instructors.length &&
        surnames.length &&
        section.instructorDiscovery
          ? [
              `Instructor evidence checked: ${section.instructorDiscovery.checkedAt}.`,
              `Instructor evidence: ${section.instructorDiscovery.sourceUrl}`,
            ]
          : []),
        ...(!section.instructors.length
          ? fullNameMatches(section).map(
              (identity) =>
                `Identity candidate: ${identity.name}; likely match; sources checked ${identity.checkedAt}; ${identity.profileUrl}`,
            )
          : []),
        "Meeting times use America/New_York. Holidays and schedule exceptions are not included; verify with Ohio State.",
        `Source: ${section.sourceUrl}`,
      ].join("\n");
      for (const day of dates) {
        const date = calendarDate(day);
        lines.push(
          "BEGIN:VEVENT",
          `UID:${encodeURIComponent(section.id)}-${meetingIndex}-${date}@buckeye-course-guide.local`,
          `DTSTAMP:${stamp}`,
          `DTSTART;TZID=America/New_York:${date}T${meeting.startTime!.replace(":", "")}00`,
          `DTEND;TZID=America/New_York:${date}T${meeting.endTime!.replace(":", "")}00`,
          `SUMMARY:${escapeText(`${course.subject} ${course.catalogNumber} — ${course.title}`)}`,
          `DESCRIPTION:${escapeText(description)}`,
          `LOCATION:${escapeText([meeting.building, meeting.room].filter(Boolean).join(" ") || "Location TBA")}`,
          "TRANSP:OPAQUE",
          "END:VEVENT",
        );
        eventCount++;
      }
    });
  }
  lines.push("END:VCALENDAR");
  return {
    content: lines.map(foldLine).join("\r\n") + "\r\n",
    eventCount,
    skippedMeetings,
  };
}

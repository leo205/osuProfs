#!/usr/bin/env python3
"""Fetch a verified starter snapshot from OSU's public class-search JSON API.

This development utility bootstraps the repository. The production scheduled
importer lives in the Java backend. No accounts, credentials, or scraping of
protected pages are involved.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import ssl
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ENDPOINT = "https://content.osu.edu/v2/classes/search"
SUBJECTS = ("CSE", "MATH", "STAT", "PHYSICS", "ECE", "ENGR")
DAYS = (("monday", "MO"), ("tuesday", "TU"), ("wednesday", "WE"),
        ("thursday", "TH"), ("friday", "FR"), ("saturday", "SA"), ("sunday", "SU"))
STATUSES = {"open": "OPEN", "closed": "CLOSED", "waitlist": "WAITLIST",
            "wait list": "WAITLIST", "waitlisted": "WAITLIST"}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def read_page(term: str, subject: str, page: int, cache: Path, offline: bool) -> tuple[dict, str]:
    url = ENDPOINT + "?" + urlencode({"q": "", "term": term, "campus": "col",
                                       "subject": subject.lower(), "p": page})
    target = cache / f"{term}-{subject.lower()}-{page}.json"
    if offline:
        if not target.exists():
            raise RuntimeError(f"Missing cached page: {target}")
        return json.loads(target.read_text()), url
    for attempt in range(3):
        try:
            request = Request(url, headers={"User-Agent": "OSUProfs-bootstrap/1.0 (public course-data pilot)"})
            # Python.org macOS builds do not always inherit the OS CA bundle.
            # Use the system's trusted bundle while retaining TLS validation.
            system_ca = Path("/etc/ssl/cert.pem")
            context = ssl.create_default_context(cafile=str(system_ca)) if sys.platform == "darwin" and system_ca.exists() else ssl.create_default_context()
            with urlopen(request, timeout=45, context=context) as response:
                body = response.read()
            parsed = json.loads(body)
            if not isinstance(parsed.get("data", {}).get("courses"), list):
                raise RuntimeError(f"Unexpected course response for {url}")
            cache.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
            time.sleep(0.25)
            return parsed, url
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)
    raise AssertionError("unreachable")


def time24(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    for pattern in ("%I:%M %p", "%H:%M", "%H:%M:%S"):
        try:
            return datetime.strptime(value.upper(), pattern).strftime("%H:%M")
        except ValueError:
            pass
    raise ValueError(f"Unexpected meeting time: {value!r}")


def number_text(value: object) -> str:
    if isinstance(value, (int, float)):
        return f"{value:g}"
    return str(value) if value is not None else "Not published"


def normalize_course(raw: dict, term: str) -> dict:
    minimum, maximum = raw.get("minUnits"), raw.get("maxUnits")
    credits = number_text(minimum) if minimum == maximum else f"{number_text(minimum)}–{number_text(maximum)}"
    return {
        "id": f"{term}-col-{raw['subject']}-{raw['catalogNumber']}-{raw['courseId']}-{raw.get('offeringNumber', '1')}",
        "termCode": term,
        "campus": "col",
        "subject": raw["subject"],
        "catalogNumber": str(raw["catalogNumber"]),
        "title": raw.get("title") or raw.get("shortDescription") or "Untitled course",
        "description": (raw.get("description") or "").replace("\r\n", "\n"),
        "credits": credits,
        "career": raw.get("academicCareer") or "Not published",
        "prerequisites": None,
        "attributes": sorted({a["description"] for a in raw.get("courseAttributes", []) if a.get("description")}),
        "sections": [],
    }


def normalize_section(raw: dict, term: str, source: str, fetched_at: str) -> dict:
    instructors = {}
    meetings = []
    for meeting in raw.get("meetings") or []:
        for instructor in meeting.get("instructors") or []:
            name = (instructor.get("displayName") or "").strip()
            if not name or name.casefold() in {"tba", "staff", "to be announced", "to be determined"}:
                continue
            identity = (instructor.get("email") or name).casefold().strip()
            # Email is used only to disambiguate a stable identity, never exposed.
            identifier = "osu-" + hashlib.sha256(identity.encode()).hexdigest()[:16]
            instructors[(identifier, instructor.get("role"))] = {
                "id": identifier, "name": name, "role": instructor.get("role") or None,
            }
        meetings.append({
            "days": [abbreviation for field, abbreviation in DAYS if meeting.get(field) is True],
            "startTime": time24(meeting.get("startTime")),
            "endTime": time24(meeting.get("endTime")),
            "building": meeting.get("facilityDescription") or meeting.get("buildingDescription") or None,
            "room": meeting.get("room") or None,
            "startDate": meeting.get("startDate"),
            "endDate": meeting.get("endDate"),
        })
    upstream_status = str(raw.get("enrollmentStatus") or "").strip().casefold()
    # facilityCapacity is a room's capacity, not section enrollment capacity.
    return {
        "id": f"{term}-{raw['classNumber']}",
        "classNumber": str(raw["classNumber"]),
        "section": str(raw.get("section") or ""),
        "component": raw.get("component") or "Not published",
        "instructionMode": raw.get("instructionMode") or "Not published",
        "instructors": sorted(instructors.values(), key=lambda i: (i["name"], i["role"] or "")),
        "meetings": meetings,
        "enrollment": {
            "status": STATUSES.get(upstream_status, "UNKNOWN"),
            "enrolled": raw.get("enrollmentTotal"),
            "capacity": None,
            "waitlist": raw.get("waitlistTotal"),
            "available": None,
            "checkedAt": fetched_at if upstream_status or raw.get("enrollmentTotal") is not None else None,
        },
        "sourceUrl": source,
        "lastUpdated": fetched_at,
    }


def build(args: argparse.Namespace) -> dict:
    jobs = [(term, subject) for term in args.term for subject in args.subject]
    if args.include_autumn_cse and ("1268", "CSE") not in jobs:
        jobs.append(("1268", "CSE"))
    courses = {}
    terms, subjects, coverage = {}, {}, {}
    fetched_times = []
    for term, subject in jobs:
        first, source = read_page(term, subject, 1, args.cache_dir, args.offline)
        data = first["data"]
        total_pages = data.get("totalPages", 1)
        if not isinstance(total_pages, int) or not 0 <= total_pages <= 100:
            raise RuntimeError(f"Unexpected page count: {term} {subject} {total_pages!r}")
        pages = [first]
        for page_number in range(2, total_pages + 1):
            page, _ = read_page(term, subject, page_number, args.cache_dir, args.offline)
            if page["data"].get("page") != page_number:
                raise RuntimeError("OSU returned an unexpected page number")
            if page["data"].get("totalItems") != data.get("totalItems"):
                raise RuntimeError("Source counts changed during import; retry to avoid publishing an incomplete dataset")
            pages.append(page)
        section_ids = set()
        group = coverage.setdefault(term, {"termCode": term, "campus": "col", "subjects": [],
                                          "courseCount": 0, "sectionCount": 0,
                                          "namedInstructorSections": 0, "complete": True,
                                          "warnings": ["Pilot coverage: Columbus campus and the listed subjects only.",
                                                       "A published instructor may change. Empty assignments remain TBA.",
                                                       "Enrollment is a snapshot; verify current availability in Buckeye Link. Section capacities are not supplied."]})
        group["subjects"].append(subject)
        for page_index, page in enumerate(pages, start=1):
            cache_file = args.cache_dir / f"{term}-{subject.lower()}-{page_index}.json"
            fetched_at = datetime.fromtimestamp(cache_file.stat().st_mtime, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
            fetched_times.append(fetched_at)
            for entry in page["data"]["courses"]:
                raw_course = dict(entry["course"])
                first_section = next(iter(entry.get("sections") or []), {})
                campus_code = raw_course.get("campusCode") or first_section.get("secCampus")
                if raw_course.get("subject") != subject or (campus_code or "").upper() != "COL":
                    raise RuntimeError("OSU returned an unexpected subject or campus")
                if not raw_course.get("title"):
                    warning = "Some source records lack full course metadata; unpublished credit values are shown explicitly."
                    if warning not in group["warnings"]:
                        group["warnings"].append(warning)
                raw_course.setdefault("title", first_section.get("courseTitle") or raw_course.get("shortDescription") or first_section.get("description"))
                raw_course.setdefault("offeringNumber", str(first_section.get("courseOfferingNumber") or "1"))
                raw_course.setdefault("subjectDesc", first_section.get("subjectDesc") or subject)
                terms[term] = raw_course["term"]
                subjects[subject] = raw_course.get("subjectDesc") or subject
                for raw_section in entry["sections"]:
                    offering_course = dict(raw_course)
                    offering_course["offeringNumber"] = str(raw_section.get("courseOfferingNumber") or raw_course.get("offeringNumber") or "1")
                    course = normalize_course(offering_course, term)
                    saved = courses.setdefault(course["id"], course)
                    section = normalize_section(raw_section, term, source, fetched_at)
                    if section["id"] in section_ids:
                        raise RuntimeError(f"Duplicate section across pages: {section['id']}")
                    section_ids.add(section["id"])
                    saved["sections"].append(section)
        if len(section_ids) != data.get("totalItems"):
            raise RuntimeError(f"Incomplete import {term} {subject}: {len(section_ids)} sections vs {data.get('totalItems')} reported")
        print(f"Verified {terms.get(term, term)} / {subject}: {len(section_ids)} sections across {total_pages} pages", flush=True)
    for course in courses.values():
        course["sections"].sort(key=lambda s: (s["section"], s["classNumber"]))
        group = coverage[course["termCode"]]
        group["courseCount"] += 1
        group["sectionCount"] += len(course["sections"])
        group["namedInstructorSections"] += sum(bool(s["instructors"]) for s in course["sections"])
    return {
        "schemaVersion": 1,
        "generatedAt": max(fetched_times, default=now()),
        "source": {"name": "Ohio State Class Search", "url": "https://classes.osu.edu/", "endpoint": ENDPOINT},
        "terms": [{"code": code, "label": label} for code, label in sorted(terms.items(), reverse=True)],
        "subjects": [{"code": code, "label": label} for code, label in sorted(subjects.items())],
        "campuses": [{"code": "col", "label": "Columbus"}],
        "coverage": list(coverage.values()),
        "courses": sorted(courses.values(), key=lambda c: (c["termCode"], c["subject"], c["catalogNumber"])),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--term", action="append", default=None)
    parser.add_argument("--subject", action="append", default=None)
    parser.add_argument("--include-autumn-cse", action="store_true")
    parser.add_argument("--cache-dir", type=Path, default=Path("/tmp/osuprofs-bootstrap-cache"))
    parser.add_argument("--offline", action="store_true", help="Rebuild from previously fetched local raw responses")
    parser.add_argument("--output", type=Path, default=Path("frontend/public/data/catalog.json"))
    args = parser.parse_args()
    args.term = args.term or ["1272"]
    args.subject = [s.upper() for s in (args.subject or SUBJECTS)]
    if any(not re.fullmatch(r"\d{4}", term) for term in args.term):
        parser.error("Terms must be four-digit OSU term codes")
    if any(not re.fullmatch(r"[A-Z][A-Z0-9-]{0,19}", s) for s in args.subject):
        parser.error("Invalid subject code")
    result = build(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    temporary.replace(args.output)
    print(f"Published {len(result['courses'])} verified courses to {args.output}", flush=True)


if __name__ == "__main__":
    main()

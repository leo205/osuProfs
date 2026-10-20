#!/usr/bin/env python3
"""Publish a validated catalog as small, immutable static files and an atomic index."""
import argparse
import hashlib
import json
import os
import re
import tempfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def validate_timestamp(value):
    if not isinstance(value, str):
        raise ValueError("Catalog timestamp must be an ISO date and time")
    try:
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("Catalog timestamp must be an ISO date and time") from error
    if timestamp.tzinfo is None:
        raise ValueError("Catalog timestamp must include a timezone")


def validate(catalog):
    if catalog.get("schemaVersion") != 1 or not catalog.get("generatedAt"):
        raise ValueError("Unsupported catalog format")
    validate_timestamp(catalog["generatedAt"])
    courses, coverage = catalog.get("courses"), catalog.get("coverage")
    if not isinstance(courses, list) or not courses or not isinstance(coverage, list) or not coverage:
        raise ValueError("An empty or incomplete catalog cannot replace published data")
    scopes, ids, sections = set(), set(), set()
    for scope in coverage:
        if not scope.get("complete") or not scope.get("subjects"):
            raise ValueError("Every published scope must be complete")
        keys = {(scope["termCode"], scope["campus"], subject) for subject in scope["subjects"]}
        if scopes & keys:
            raise ValueError("Overlapping catalog coverage")
        scopes.update(keys)
        selected = [c for c in courses if (c["termCode"], c["campus"], c["subject"]) in keys]
        if len(selected) != scope["courseCount"] or sum(len(c["sections"]) for c in selected) != scope["sectionCount"]:
            raise ValueError("Catalog coverage counts do not match its records")
    for course in courses:
        if course["id"] in ids:
            raise ValueError("Duplicate course ID")
        ids.add(course["id"])
        if (course["termCode"], course["campus"], course["subject"]) not in scopes:
            raise ValueError("Course outside declared coverage")
        for section in course["sections"]:
            key = (course["termCode"], section["id"])
            if key in sections:
                raise ValueError("Duplicate section ID within a term")
            sections.add(key)
    return catalog


def load_catalog(path):
    path = Path(path)
    value = json.loads(path.read_text())
    if "catalogs" not in value:
        return validate(value)
    if value.get("schemaVersion") != 1 or not isinstance(value["catalogs"], list) or not value["catalogs"]:
        raise ValueError("Invalid catalog index")
    validate_timestamp(value.get("generatedAt"))
    merged = None
    declared_scopes = set()
    options = {key: {} for key in ("terms", "campuses", "subjects")}
    for entry in value["catalogs"]:
        url = entry["url"]
        if not isinstance(url, str) or not re.fullmatch(r"/data/catalogs/[A-Za-z0-9._-]+\.json", url):
            raise ValueError("Invalid catalog shard path")
        shard_path = (path.parent / url[len("/data/"):]).resolve()
        if not shard_path.is_relative_to(path.parent.resolve()):
            raise ValueError("Shard path escapes the catalog directory")
        term, campus, subjects = entry.get("termCode"), entry.get("campus"), entry.get("subjects")
        if not isinstance(term, str) or not re.fullmatch(r"\d{4}", term) or not isinstance(campus, str) or not re.fullmatch(r"[a-z]{2,8}", campus):
            raise ValueError("Invalid catalog shard term or campus")
        if not isinstance(subjects, list) or not subjects or any(not isinstance(subject, str) or not subject for subject in subjects):
            raise ValueError("Catalog shard must declare its subjects")
        scopes = {(term, campus, subject) for subject in subjects}
        if len(scopes) != len(subjects) or declared_scopes & scopes:
            raise ValueError("Overlapping catalog shard scopes")
        declared_scopes.update(scopes)
        shard = validate(json.loads(shard_path.read_text()))
        actual_scopes = {(scope["termCode"], scope["campus"], subject)
                         for scope in shard["coverage"] for subject in scope["subjects"]}
        if actual_scopes != scopes:
            raise ValueError("Catalog shard scope differs from its manifest entry")
        if (entry.get("courseCount") != len(shard["courses"]) or
                entry.get("sectionCount") != sum(len(course["sections"]) for course in shard["courses"])):
            raise ValueError("Catalog shard counts differ from its manifest entry")
        if ({item["code"] for item in shard["terms"]} != {term} or
                {item["code"] for item in shard["campuses"]} != {campus} or
                {item["code"] for item in shard["subjects"]} != set(subjects)):
            raise ValueError("Catalog shard metadata differs from its manifest entry")
        if merged is None:
            merged = {**shard, "generatedAt": value["generatedAt"], "courses": [], "coverage": []}
        merged["courses"].extend(shard["courses"])
        merged["coverage"].extend(shard["coverage"])
        for key, values in options.items():
            for option in shard[key]:
                old = values.get(option["code"])
                if old and old["label"] != option["label"]:
                    raise ValueError("Conflicting catalog option labels")
                values[option["code"]] = option
    for key, values in options.items():
        merged[key] = sorted(values.values(), key=lambda item: item["code"])
    return validate(merged)


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name, suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def make_shard(catalog, term, campus, subjects, courses, coverage_by_subject):
    keys = set(subjects)
    warnings = sorted({warning for subject in subjects
                       for warning in coverage_by_subject[(term, campus, subject)].get("warnings", [])})
    return {
        "schemaVersion": 1, "generatedAt": catalog["generatedAt"], "source": catalog["source"],
        "terms": [x for x in catalog["terms"] if x["code"] == term],
        "campuses": [x for x in catalog["campuses"] if x["code"] == campus],
        "subjects": [x for x in catalog["subjects"] if x["code"] in keys],
        "coverage": [{
            "termCode": term, "campus": campus, "subjects": subjects,
            "courseCount": len(courses), "sectionCount": sum(len(c["sections"]) for c in courses),
            "namedInstructorSections": sum(bool(s["instructors"]) for c in courses for s in c["sections"]),
            "complete": True, "warnings": warnings,
        }],
        "courses": courses,
    }


def publish(catalog, output_dir, target_bytes=4 * 1024 * 1024):
    validate(catalog)
    if target_bytes < 1024 or target_bytes > 24 * 1024 * 1024:
        raise ValueError("Shard target must be between 1 KiB and 24 MiB")
    output_dir = Path(output_dir)
    grouped, coverage_by_subject = defaultdict(lambda: defaultdict(list)), {}
    for scope in catalog["coverage"]:
        for subject in scope["subjects"]:
            grouped[(scope["termCode"], scope["campus"])][subject]
            coverage_by_subject[(scope["termCode"], scope["campus"], subject)] = scope
    for course in catalog["courses"]:
        grouped[(course["termCode"], course["campus"])][course["subject"]].append(course)
    prepared = []
    for (term, campus), by_subject in sorted(grouped.items()):
        subjects, courses, approximate_size = [], [], 0
        batches = []
        for subject, rows in sorted(by_subject.items()):
            size = len(encoded(rows))
            if rows and courses and approximate_size + size > target_bytes:
                batches.append((subjects, courses))
                subjects, courses, approximate_size = [], [], 0
            subjects.append(subject)
            courses.extend(rows)
            approximate_size += size
        if courses:
            batches.append((subjects, courses))
        elif subjects:
            raise ValueError("Cannot publish a term/campus with no course records")
        for index, (subjects, courses) in enumerate(batches, 1):
            shard = make_shard(catalog, term, campus, subjects, courses, coverage_by_subject)
            content = encoded(validate(shard))
            if len(content) > 24 * 1024 * 1024:
                raise ValueError("A subject exceeds the static hosting file limit; split strategy needs review")
            digest = hashlib.sha256(content).hexdigest()[:16]
            relative = f"catalogs/{term}-{campus}-{index}-{digest}.json"
            prepared.append((relative, content, {
                "url": "/data/" + relative, "termCode": term, "campus": campus, "subjects": subjects,
                "courseCount": len(courses), "sectionCount": sum(len(c["sections"]) for c in courses),
            }))
    manifest = {"schemaVersion": 1, "generatedAt": catalog["generatedAt"],
                "catalogs": [entry for _, _, entry in prepared]}
    # Validate every shard before making any visible index change. Content hashes
    # keep existing clients' files intact while the new index is being published.
    for relative, content, _ in prepared:
        atomic_write(output_dir / relative, content)
    atomic_write(output_dir / "catalog-index.json", encoded(manifest))
    # The legacy combined file can exceed Pages' per-file limit at university scale.
    (output_dir / "catalog.json").unlink(missing_ok=True)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("frontend/public/data"))
    parser.add_argument("--target-mib", type=float, default=4)
    parser.add_argument("--flatten", type=Path, help="Write a combined local working snapshot instead of publishing")
    args = parser.parse_args()
    catalog = load_catalog(args.input)
    if args.flatten:
        atomic_write(args.flatten, encoded(catalog))
        print(f"Wrote working catalog: {args.flatten}")
    else:
        manifest = publish(catalog, args.output_dir, int(args.target_mib * 1024 * 1024))
        print(f"Published {len(catalog['courses'])} courses in {len(manifest['catalogs'])} static catalog files")


if __name__ == "__main__":
    main()

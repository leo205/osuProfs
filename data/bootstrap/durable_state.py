#!/usr/bin/env python3
"""Keep checked catalog/search progress in Git; Actions caches are disposable."""
import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from publish_catalog import atomic_write, encoded, load_catalog


def instant(value):
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("Search timestamps must include a timezone")
    return result


def query_state(path):
    if not path.exists():
        return {"schemaVersion": 1, "queries": {}}
    state = json.loads(path.read_text())
    if state.get("schemaVersion") != 1 or not isinstance(state.get("queries"), dict):
        raise ValueError("Unsupported instructor-search state")
    clean = {}
    for key, value in state["queries"].items():
        parts = key.split("|", 3)
        if (len(parts) != 4 or not re.fullmatch(r"\d{4}", parts[0]) or
                not re.fullmatch(r"[a-z]{2,8}", parts[1]) or not parts[2] or not parts[3]):
            raise ValueError("Invalid instructor-search scope")
        instant(value["checkedAt"])
        if not re.fullmatch(r"[a-f0-9]{64}", value["scopeFingerprint"]):
            raise ValueError("Invalid instructor-search fingerprint")
        clean[key] = {"checkedAt": value["checkedAt"], "scopeFingerprint": value["scopeFingerprint"]}
    return {"schemaVersion": 1, "queries": clean}


def restore(published, saved_dir, work_dir):
    baseline = load_catalog(published)
    saved = query_state(saved_dir / "instructor-queries.json")
    catalog_path, queries_path = work_dir / "catalog.json", work_dir / "discovery-state.json"
    try:
        cached = load_catalog(catalog_path) if catalog_path.exists() else None
    except (ValueError, OSError):
        cached = None
    if cached is None or instant(baseline["generatedAt"]) > instant(cached["generatedAt"]):
        # Restore catalog and its query state together. An older cache cannot
        # replace new published assignments or resurrect cleared evidence.
        atomic_write(catalog_path, encoded(baseline))
        atomic_write(queries_path, encoded(saved))
    else:
        try:
            current = query_state(queries_path)
        except (ValueError, KeyError, TypeError, OSError):
            current = {"schemaVersion": 1, "queries": {}}
        for key, value in saved["queries"].items():
            old = current["queries"].get(key)
            if old is None or instant(value["checkedAt"]) > instant(old["checkedAt"]):
                current["queries"][key] = value
        atomic_write(queries_path, encoded(current))


def save(published, saved_dir, work_dir):
    catalog = load_catalog(published)
    working = load_catalog(work_dir / "catalog.json")
    if ({c["id"]: c for c in catalog["courses"]} !=
            {c["id"]: c for c in working["courses"]} or catalog["generatedAt"] != working["generatedAt"]):
        raise ValueError("Only state paired with the verified published catalog can be saved")
    state = query_state(work_dir / "discovery-state.json")
    source_receipt = work_dir / "collection.json"
    receipt = json.loads(source_receipt.read_text()) if source_receipt.exists() else {}
    discovery = receipt.get("discovery", {})
    sections = [section for course in catalog["courses"] for section in course["sections"]]
    named = sum(bool(section["instructors"]) for section in sections)
    likely = sum(not section["instructors"] and bool(
        (section.get("instructorDiscovery") or {}).get("fullNameMatches")) for section in sections)
    status = {
        "schemaVersion": 1,
        "savedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "catalogGeneratedAt": catalog["generatedAt"],
        "terms": [term["code"] for term in catalog["terms"]],
        "courseCount": len(catalog["courses"]), "sectionCount": len(sections),
        "publishedInstructorSections": named, "likelyFullNameSections": likely,
        "unresolvedSections": len(sections) - named - likely,
        "successfulSurnameQueries": len(state["queries"]),
        "pendingSurnameQueries": discovery.get("pendingSurnameQueries"),
        "pendingBatches": discovery.get("pendingBatches"),
        "failedBatches": [{"campus": failure["campus"], "subject": failure["subject"],
                           "attemptedAt": failure["attemptedAt"],
                           "reason": "Source lookup failed; prior evidence retained and queries remain pending."}
                          for failure in discovery.get("failures", [])],
    }
    # Validate everything before replacing durable files. Neither file includes
    # cookies, raw forms, local paths, or private build-only teaching history.
    atomic_write(saved_dir / "instructor-queries.json", encoded(state))
    atomic_write(saved_dir / "status.json", encoded(status))
    return status


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["restore", "save"])
    parser.add_argument("--published", type=Path, default=Path("frontend/public/data/catalog-index.json"))
    parser.add_argument("--saved-dir", type=Path, default=Path("data/discovery/refresh-state"))
    parser.add_argument("--work-dir", type=Path, default=Path("artifacts/university"))
    args = parser.parse_args()
    if args.action == "restore":
        restore(args.published, args.saved_dir, args.work_dir)
    else:
        print(json.dumps(save(args.published, args.saved_dir, args.work_dir)))


if __name__ == "__main__":
    main()

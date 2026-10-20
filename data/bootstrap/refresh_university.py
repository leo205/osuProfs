#!/usr/bin/env python3
"""Refresh every offered subject/campus, then resume paced instructor-search batches."""
import argparse
import copy
import hashlib
import json
import math
import re
import subprocess
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

from publish_catalog import atomic_write, encoded, load_catalog, publish, validate

ROOT = Path(__file__).resolve().parents[2]


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def campus_counts(term):
    url = "https://content.osu.edu/v2/classes/search?" + urlencode({"q": "", "term": term, "pagenum": 1})
    result = subprocess.run(["curl", "--fail", "--silent", "--show-error", "--retry", "2",
                             "--max-time", "45", url], check=True, capture_output=True)
    data = json.loads(result.stdout)["data"]
    campus_filter = next((f for f in data["filters"] if f["slug"] == "campus"), None)
    if not campus_filter or not campus_filter["items"]:
        raise ValueError("Official campus discovery returned no campuses")
    return {item["term"].lower(): int(item["count"]) for item in campus_filter["items"]}


def merge_catalogs(previous, fresh):
    """Replace declared scopes without dropping newer independent search evidence."""
    scopes = {(s["termCode"], s["campus"], subject)
              for s in fresh["coverage"] for subject in s["subjects"]}
    previous_sections = {(c["id"], s["id"]): s
                         for c in previous["courses"] for s in c["sections"]}
    refreshed = copy.deepcopy(fresh["courses"])
    for course in refreshed:
        for section in course["sections"]:
            if section["instructors"]:
                # Published assignments take precedence over cached candidates.
                section["instructorDiscovery"] = None
                continue
            old = previous_sections.get((course["id"], section["id"]), {})
            old_evidence, fresh_evidence = old.get("instructorDiscovery"), section.get("instructorDiscovery")
            if not old_evidence:
                continue
            # A base-feed refresh has no discovery timestamp. Keep prior query
            # evidence, including its original date, until a newer search replaces it.
            old_checked = old_evidence.get("checkedAt")
            fresh_checked = (fresh_evidence or {}).get("checkedAt")
            if not fresh_evidence or (old_checked and fresh_checked and
                    datetime.fromisoformat(old_checked.replace("Z", "+00:00")) >
                    datetime.fromisoformat(fresh_checked.replace("Z", "+00:00"))):
                section["instructorDiscovery"] = copy.deepcopy(old_evidence)
    courses = refreshed + [
        c for c in previous["courses"] if (c["termCode"], c["campus"], c["subject"]) not in scopes]
    coverage = list(fresh["coverage"])
    for old in previous["coverage"]:
        remaining = [subject for subject in old["subjects"]
                     if (old["termCode"], old["campus"], subject) not in scopes]
        if not remaining:
            continue
        selected = [c for c in courses if c["termCode"] == old["termCode"]
                    and c["campus"] == old["campus"] and c["subject"] in remaining]
        coverage.append({**old, "subjects": remaining, "courseCount": len(selected),
                         "sectionCount": sum(len(c["sections"]) for c in selected),
                         "namedInstructorSections": sum(bool(s["instructors"]) for c in selected for s in c["sections"])})
    generated = max((previous["generatedAt"], fresh["generatedAt"]),
                    key=lambda value: datetime.fromisoformat(value.replace("Z", "+00:00")))
    merged = {**fresh, "generatedAt": generated, "courses": courses, "coverage": coverage}
    for key in ("terms", "campuses", "subjects"):
        options = {v["code"]: v for v in previous[key]}
        for value in fresh[key]:
            if value["label"] != value["code"] or value["code"] not in options:
                options[value["code"]] = value
        merged[key] = sorted(options.values(), key=lambda v: v["code"])
    return validate(merged)


def select_term(catalog, term):
    """Keep history available to collection without publishing it in the app."""
    courses = [course for course in catalog["courses"] if course["termCode"] == term]
    coverage = [scope for scope in catalog["coverage"] if scope["termCode"] == term]
    campuses = {scope["campus"] for scope in coverage}
    subjects = {subject for scope in coverage for subject in scope["subjects"]}
    return validate({**catalog, "courses": courses, "coverage": coverage,
                     "terms": [value for value in catalog["terms"] if value["code"] == term],
                     "campuses": [value for value in catalog["campuses"] if value["code"] in campuses],
                     "subjects": [value for value in catalog["subjects"] if value["code"] in subjects]})


def candidates_by_subject(catalog, history=None, cse_seeds=None):
    candidates = defaultdict(dict)
    for source in (catalog, history):
        if source is None:
            continue
        for course in source["courses"]:
            target = candidates[course["subject"]]
            for section in course["sections"]:
                for instructor in section["instructors"]:
                    name = re.sub(r"(?i),?\s+(Jr|Sr|II|III|IV)\.?$", "", instructor["name"].strip())
                    if "," in name:
                        possibilities = [name.split(",", 1)[0]]
                    else:
                        parts = name.split()
                        # Display names do not expose a family-name field. Try
                        # suffix alternatives so compound surnames are not lost.
                        # These are query inputs only, never identity assertions.
                        possibilities = [" ".join(parts[start:]) for start in range(1, len(parts))]
                        if len(parts) == 1:
                            possibilities = parts
                    for surname in possibilities:
                        target.setdefault(surname.casefold(), surname)
                for surname in (section.get("instructorDiscovery") or {}).get("surnames", []):
                    target.setdefault(surname.casefold(), surname)
    if cse_seeds and Path(cse_seeds).exists():
        for surname in Path(cse_seeds).read_text().splitlines():
            if surname.strip():
                candidates["CSE"].setdefault(surname.strip().casefold(), surname.strip())
    return {subject: sorted(values.values(), key=str.casefold) for subject, values in candidates.items()}


def scope_fingerprint(catalog, term, campus, subject):
    identifiers = sorted((c["id"], s["id"]) for c in catalog["courses"]
                         if c["termCode"] == term and c["campus"] == campus and c["subject"] == subject
                         for s in c["sections"])
    return hashlib.sha256(encoded(identifiers)).hexdigest()


def discovery_batches(catalog, state, term, batch_size, refresh_days, history=None, cse_seeds=None):
    candidates = candidates_by_subject(catalog, history, cse_seeds)
    scopes = defaultdict(lambda: {"unresolved": 0, "scheduled": 0})
    for course in catalog["courses"]:
        if course["termCode"] != term:
            continue
        for section in course["sections"]:
            if not section["instructors"]:
                key = (course["campus"], course["subject"])
                scopes[key]["unresolved"] += 1
                scopes[key]["scheduled"] += bool(section["meetings"] and
                    any(m["days"] and m["startTime"] for m in section["meetings"]))
    cutoff = time.time() - refresh_days * 86400
    new_batches, changed_batches, refresh_batches = [], [], []
    # Never let repeated refreshes of busy subjects starve the unsearched tail.
    # First search new/changed scopes; then refresh oldest completed queries.
    for (campus, subject), counts in sorted(scopes.items(), key=lambda x: (-x[1]["scheduled"], x[0])):
        pending, changed, expired = [], [], []
        fingerprint = scope_fingerprint(catalog, term, campus, subject)
        for surname in candidates.get(subject, []):
            key = "|".join((term, campus, subject, surname.casefold()))
            entry = state.get("queries", {}).get(key, {})
            checked = entry.get("checkedAt")
            if checked and entry.get("scopeFingerprint") == fingerprint:
                checked_at = datetime.fromisoformat(checked.replace("Z", "+00:00")).timestamp()
                if checked_at < cutoff:
                    expired.append((checked_at, surname))
            elif checked:
                changed.append(surname)
            else:
                pending.append(surname)
        for start in range(0, len(pending), batch_size):
            new_batches.append((campus, subject, pending[start:start + batch_size]))
        for start in range(0, len(changed), batch_size):
            changed_batches.append((campus, subject, changed[start:start + batch_size]))
        expired.sort()
        for start in range(0, len(expired), batch_size):
            batch = expired[start:start + batch_size]
            refresh_batches.append((batch[0][0], campus, subject, [name for _, name in batch]))
    refresh_batches.sort(key=lambda batch: (batch[0], batch[1], batch[2]))
    return new_batches + changed_batches + [(campus, subject, names) for _, campus, subject, names in refresh_batches]


def run_import(args, output, term, campus, subjects="ALL", surnames=None, history=None):
    command = ["java", "-Xmx768m", "-jar", str(args.jar.resolve()),
               "--spring.main.web-application-type=none", "--app.import.enabled=true",
               f"--app.catalog.path={output.resolve()}", f"--app.import.output={output.resolve()}",
               f"--app.import.term={term}", f"--app.import.campus={campus}",
               f"--app.import.subjects={subjects}",
               f"--app.discovery.identity-file={ROOT / 'data/discovery/cse-instructor-identities.json'}",
               f"--app.discovery.enabled={'true' if surnames else 'false'}",
               "--app.discovery.include-catalog-candidates=false", "--app.discovery.candidate-file=",
               "--app.discovery.max-candidates=40", f"--app.discovery.subject={subjects}",
               f"--app.discovery.candidate-subject={subjects}"]
    if surnames:
        command.append("--app.discovery.surnames=" + ",".join(surnames))
    if history:
        command.append("--app.discovery.history-file=" + str(history.resolve()))
    log = args.work_dir / ("latest-import.log" if not surnames else "latest-discovery.log")
    with log.open("w") as stream:
        result = subprocess.run(command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT)
    if result.returncode:
        tail = "\n".join(log.read_text().splitlines()[-22:])
        raise RuntimeError(f"Import failed for {term}/{campus}/{subjects}; see {log}\n{tail}")


def collect_term(args, output, term):
    expected = campus_counts(term)
    selected = sorted(expected) if args.campuses == "ALL" else args.campuses.lower().split(",")
    if set(selected) - set(expected):
        raise ValueError("Requested campus is absent from the official term")
    for campus in selected:
        print(f"Collecting {term}/{campus}: all official subjects", flush=True)
        run_import(args, output, term, campus)
    catalog = load_catalog(output)
    actual = {campus: sum(len(c["sections"]) for c in catalog["courses"]
                         if c["termCode"] == term and c["campus"] == campus) for campus in selected}
    after = campus_counts(term)
    for campus, count in actual.items():
        if count not in (expected.get(campus), after.get(campus)):
            raise ValueError(f"University completeness check failed for {term}/{campus}: "
                             f"collected {count}, official counts {expected.get(campus)}/{after.get(campus)}")
    return {"termCode": term, "checkedAt": now(), "expectedBefore": expected,
            "expectedAfter": after, "collected": actual}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--term", default="1272")
    parser.add_argument("--history-term", default="1268")
    parser.add_argument("--campuses", default="ALL")
    parser.add_argument("--jar", type=Path, default=ROOT / "backend/target/osu-profs-0.1.0.jar")
    parser.add_argument("--work-dir", type=Path, default=ROOT / "artifacts/university")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "frontend/public/data")
    parser.add_argument("--refresh-history", action="store_true")
    parser.add_argument("--skip-base", action="store_true", help="Resume searches on an already validated working snapshot")
    parser.add_argument("--discover", action="store_true")
    parser.add_argument("--discovery-minutes", type=float, default=20, help="0 processes the entire pending search queue")
    parser.add_argument("--refresh-days", type=int, default=7)
    parser.add_argument("--no-publish", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"\d{4}", args.term) or not re.fullmatch(r"\d{4}", args.history_term):
        parser.error("Terms must be four-digit OSU codes")
    if not math.isfinite(args.discovery_minutes) or args.discovery_minutes < 0 or args.refresh_days < 1:
        parser.error("Invalid discovery budget or refresh interval")
    args.work_dir.mkdir(parents=True, exist_ok=True)
    output, history = args.work_dir / "catalog.json", args.work_dir / "history.json"
    state_path = args.work_dir / "discovery-state.json"
    receipt_path = args.work_dir / "collection.json"
    if not output.exists():
        baseline = args.output_dir / "catalog-index.json"
        if not baseline.exists():
            baseline = args.output_dir / "catalog.json"
        atomic_write(output, encoded(load_catalog(baseline)))
    receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else {"collections": []}
    if not args.skip_base:
        if args.refresh_history or not history.exists():
            receipt["collections"].append(collect_term(args, history, args.history_term))
        receipt["collections"].append(collect_term(args, output, args.term))
        atomic_write(receipt_path, encoded(receipt))
    # Comparison history remains a private input to discovery and identity
    # resolution. Only the requested upcoming semester is served to users.
    catalog = select_term(load_catalog(output), args.term)
    atomic_write(output, encoded(catalog))
    state = json.loads(state_path.read_text()) if state_path.exists() else {"schemaVersion": 1, "queries": {}}
    failures = []
    if args.discover:
        history_catalog = load_catalog(history) if history.exists() else None
        batches = discovery_batches(catalog, state, args.term, 40, args.refresh_days,
                                    history_catalog, ROOT / "data/discovery/cse-surnames.txt")
        started, completed = time.monotonic(), 0
        for campus, subject, surnames in batches:
            if args.discovery_minutes and time.monotonic() - started >= args.discovery_minutes * 60:
                break
            print(f"Discovering {args.term}/{campus}/{subject}: {len(surnames)} surnames "
                  f"(batch {completed + 1}/{len(batches)})", flush=True)
            try:
                run_import(args, output, args.term, campus, subject, surnames, history if history.exists() else None)
                checked = now()
                fingerprint = scope_fingerprint(load_catalog(output), args.term, campus, subject)
                for surname in surnames:
                    state["queries"]["|".join((args.term, campus, subject, surname.casefold()))] = {
                        "checkedAt": checked, "scopeFingerprint": fingerprint}
                atomic_write(state_path, encoded(state))
                completed += 1
            except RuntimeError as failure:
                failures.append({"campus": campus, "subject": subject, "surnames": surnames,
                                 "attemptedAt": now(), "error": str(failure)})
                print(f"Search batch retained its previous data: {subject}/{campus}. See discovery receipt.", flush=True)
        catalog = select_term(load_catalog(output), args.term)
        remaining = discovery_batches(catalog, state, args.term, 40, args.refresh_days,
                                       history_catalog, ROOT / "data/discovery/cse-surnames.txt")
        receipt["discovery"] = {"updatedAt": now(), "completedBatches": completed,
                                "pendingBatches": len(remaining),
                                "pendingSurnameQueries": sum(len(b[2]) for b in remaining),
                                "failures": failures}
        atomic_write(receipt_path, encoded(receipt))
    if not args.no_publish:
        manifest = publish(catalog, args.output_dir)
        print(f"Published {len(catalog['courses'])} courses in {len(manifest['catalogs'])} files.", flush=True)
    print(json.dumps(receipt.get("discovery", {})), flush=True)


if __name__ == "__main__":
    main()

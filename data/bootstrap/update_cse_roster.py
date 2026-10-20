#!/usr/bin/env python3
"""Collect public CSE faculty/lecturer names and combine them with published catalog names.

This prepares search inputs and identity candidates. It does not establish any section assignment.
"""
import argparse
import hashlib
import json
import re
import subprocess
import time
import unicodedata
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse


class DirectoryPage(HTMLParser):
    def __init__(self, url):
        super().__init__(convert_charrefs=True)
        self.url, self.people, self.next_page = url, [], None

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag != "a":
            return
        href, title = attrs.get("href", ""), attrs.get("title", "")
        if "next" in attrs.get("rel", "").split():
            self.next_page = urljoin(self.url, href)
        prefix = "View full profile for "
        if title.startswith(prefix) and href.startswith("/people/"):
            label = title[len(prefix):].strip()
            if "," not in label:
                raise ValueError("Directory changed its surname/name format")
            surname, given = (part.strip() for part in label.split(",", 1))
            if not surname or not given:
                raise ValueError("Directory contains an incomplete name")
            self.people.append({"name": f"{given} {surname}", "surname": surname,
                                "profileUrl": urljoin(self.url, href), "sourceUrl": self.url})


def normalized(value):
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def same_person_name(person, historical):
    if normalized(person["surname"]) != normalized(historical["surname"]):
        return False
    first = normalized(person["name"]).split()[0].rstrip(".")
    other = normalized(historical["name"]).split()[0].rstrip(".")
    return min(len(first), len(other)) >= 3 and (first.startswith(other) or other.startswith(first))


def add_history(identities, affinities, catalog, history):
    source = history["sourceUrl"]
    url = urlparse(source)
    if history.get("schemaVersion") != 1 or history.get("subject") != "CSE" or url.scheme != "https" or url.hostname != "registrar.osu.edu":
        raise ValueError("Expected the verified official historical CSE associations")
    known = {}
    for course in catalog["courses"]:
        if course["subject"] == "CSE":
            for section in course["sections"]:
                for person in section["instructors"]:
                    known[person["id"]] = {"id": person["id"], "name": person["name"], "surname": person["name"].split()[-1]}
    for historical in history["associations"]:
        # Printed initials supply search seeds, but never become invented given names.
        first = re.sub(r"\W", "", historical["name"].split()[0])
        if len(first) < 2 or " " not in historical["name"]:
            continue
        pool = {**known, **identities}
        candidates = [person for person in pool.values() if same_person_name(person, historical)]
        if len(candidates) > 1:
            exact = [person for person in candidates if normalized(person["name"]) == normalized(historical["name"])]
            if len(exact) != 1:
                continue
            candidates = exact
        if candidates:
            person = candidates[0]
            identifier = person["id"]
        else:
            identifier = "osu-history-" + hashlib.sha256(normalized(historical["name"]).encode()).hexdigest()[:16]
            person = historical
        if identifier not in identities:
            identities[identifier] = {"id": identifier, "name": person["name"], "surname": historical["surname"],
                "profileUrl": source, "rateMyProfessorsUrl": None, "sourceUrls": [source],
                "confidence": "LIKELY", "checkedAt": history["retrievedAt"]}
        elif source not in identities[identifier]["sourceUrls"]:
            identities[identifier]["sourceUrls"].append(source)
        numbers = historical["catalogNumbers"]
        if any(not re.fullmatch(r"[0-9]{4}(?:\.[0-9]+)?[A-Z]*", number) for number in numbers):
            raise ValueError("Historical associations contain an invalid catalog number")
        affinities[identifier] = sorted(set(affinities.get(identifier, [])) | set(numbers))


def atomic_json(path, value):
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    temporary.replace(path)


def collect_directory():
    people, pages = {}, []
    for classification in ("faculty", "lecturers"):
        url = f"https://cse.osu.edu/directory/{classification}?page=0"
        visited = set()
        while url:
            if url in visited or len(visited) >= 20 or urlparse(url).hostname != "cse.osu.edu":
                raise ValueError("Directory pagination is cyclic, excessive, or outside OSU CSE")
            visited.add(url)
            time.sleep(0.35)
            # Use the system HTTPS client and CA trust on both macOS and Actions runners.
            response = subprocess.run(["curl", "--fail", "--silent", "--show-error", "--location",
                "--max-time", "45", "--max-filesize", "2000000", "--write-out", "\n%{http_code} %{url_effective}", url],
                check=True, capture_output=True)
            html, metadata = response.stdout.rsplit(b"\n", 1)
            status, final_url = metadata.decode().split(" ", 1)
            if status != "200" or urlparse(final_url).hostname != "cse.osu.edu":
                raise ValueError("Directory request did not return an official CSE page")
            if len(html) > 2_000_000:
                raise ValueError("Directory response exceeded its size limit")
            parser = DirectoryPage(url)
            parser.feed(html.decode("utf-8"))
            if not parser.people:
                raise ValueError("Directory returned no recognizable public names")
            for person in parser.people:
                people[person["profileUrl"]] = person
            pages.append({"url": url, "names": len(parser.people),
                          "sha256": hashlib.sha256(html).hexdigest()})
            url = parser.next_page
    if len(people) < 80:
        raise ValueError("Directory collection is unexpectedly small; existing files retained")
    return list(people.values()), pages


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--catalog", type=Path, default=Path("frontend/public/data/catalog-index.json"))
    args.add_argument("--registry", type=Path, default=Path("data/discovery/cse-instructor-identities.json"))
    args.add_argument("--seeds", type=Path, default=Path("data/discovery/cse-surnames.txt"))
    args.add_argument("--receipt", type=Path, default=Path("data/discovery/cse-directory-collection.json"))
    args.add_argument("--history", type=Path, default=Path("data/discovery/cse-expanded-3521/spring2026-cse-course-associations.json"))
    args.add_argument("--max-surnames", type=int, default=2000)
    options = args.parse_args()
    from publish_catalog import load_catalog
    catalog = load_catalog(options.catalog)
    existing = json.loads(options.registry.read_text())
    if existing["schemaVersion"] != 1 or existing["subject"] != "CSE":
        raise ValueError("Expected the versioned CSE identity registry")
    directory, pages = collect_directory()
    checked_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    # Preserve specifically reviewed overrides, such as a direct rating URL or course-affinity source.
    overrides = [identity for identity in existing["identities"]
                 if not any("/directory/" in source for source in identity["sourceUrls"])]
    identities = {identity["id"]: identity for identity in overrides}
    override_names = {normalized(identity["name"]) for identity in overrides}
    for person in directory:
        profile_name = unquote(urlparse(person["profileUrl"]).path.rsplit("/", 1)[-1]).lower()
        if not re.fullmatch(r"[a-z0-9._-]+", profile_name):
            raise ValueError("Unexpected directory profile identifier")
        identifier = "osu-" + hashlib.sha256((profile_name + "@osu.edu").encode()).hexdigest()[:16]
        if identifier in identities or normalized(person["name"]) in override_names:
            continue
        identities[identifier] = {"id": identifier, "name": person["name"], "surname": person["surname"],
            "profileUrl": person["profileUrl"], "rateMyProfessorsUrl": None,
            "sourceUrls": [person["profileUrl"], person["sourceUrl"]],
            "confidence": "LIKELY", "checkedAt": checked_at}
    affinities = {key: value for key, value in existing.get("courseAffinities", {}).items() if key in identities}
    history = json.loads(options.history.read_text())
    add_history(identities, affinities, catalog, history)
    seeds = {normalized(identity["surname"]): identity["surname"] for identity in identities.values()}
    for person in history["associations"]:
        seeds.setdefault(normalized(person["surname"]), person["surname"])
    # Include graduate instructors and other teachers actually named in the official course feed.
    for course in catalog["courses"]:
        if course["subject"] != "CSE":
            continue
        for section in course["sections"]:
            for instructor in section["instructors"]:
                name = re.sub(r"(?i),?\s+(Jr|Sr|II|III|IV)\.?$", "", instructor["name"].strip())
                surname = name.split(",", 1)[0] if "," in name else name.split()[-1]
                seeds.setdefault(normalized(surname), surname)
    if not seeds or len(seeds) > options.max_surnames:
        raise ValueError(f"Review the candidate scope: {len(seeds)} surnames exceeds the bound {options.max_surnames}")
    # All requests and validation finish before any output is replaced.
    atomic_json(options.registry, {"schemaVersion": 1, "subject": "CSE",
        "identities": sorted(identities.values(), key=lambda identity: normalized(identity["name"])),
        "courseAffinities": affinities})
    seed_temp = options.seeds.with_name(options.seeds.name + ".tmp")
    seed_temp.write_text("\n".join(sorted(seeds.values(), key=normalized)) + "\n")
    seed_temp.replace(options.seeds)
    atomic_json(options.receipt, {"collectedAt": checked_at, "sourcePages": pages,
        "directoryNames": len(directory), "identityCandidates": len(identities), "surnameCandidates": len(seeds),
        "purpose": "Search inputs and likely identity candidates only; no section assignment is established by a directory entry."})
    print(f"Collected {len(directory)} directory names from {len(pages)} pages; prepared {len(seeds)} CSE surname candidates.")


if __name__ == "__main__":
    main()

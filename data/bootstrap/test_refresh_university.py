import copy
import json
import unittest
from pathlib import Path

from refresh_university import candidates_by_subject, discovery_batches, merge_catalogs, now, scope_fingerprint, select_term


class RefreshUniversityTest(unittest.TestCase):
    def catalog(self):
        source = json.loads((Path(__file__).parents[1] / "catalog-contract.example.json").read_text())
        source["generatedAt"] = "2026-10-20T00:00:00Z"
        course = source["courses"][0]
        for section in course["sections"]:
            section["instructors"] = []
            section["instructorDiscovery"] = None
        source["coverage"] = [{
            "termCode": course["termCode"], "campus": course["campus"], "subjects": [course["subject"]],
            "courseCount": 1, "sectionCount": len(course["sections"]), "namedInstructorSections": 0,
            "complete": True, "warnings": [],
        }]
        return source

    def test_resume_skips_only_successful_queries_and_keeps_subjects_isolated(self):
        catalog = self.catalog()
        course = catalog["courses"][0]
        history = copy.deepcopy(catalog)
        history["courses"][0]["sections"][0]["instructors"] = [
            {"id": "a", "name": "Alice One", "role": None},
            {"id": "b", "name": "Bob Two", "role": None},
        ]
        other = copy.deepcopy(history["courses"][0])
        other["subject"] = "UNRELATED"
        other["sections"][0]["instructors"] = [{"id": "x", "name": "Chris Other", "role": None}]
        history["courses"].append(other)
        key = "|".join((course["termCode"], course["campus"], course["subject"], "one"))
        state = {"queries": {key: {"checkedAt": now(), "scopeFingerprint": scope_fingerprint(
            catalog, course["termCode"], course["campus"], course["subject"])}}}
        batches = discovery_batches(catalog, state, course["termCode"], 40, 7, history)
        self.assertEqual([(course["campus"], course["subject"], ["Two"])], batches)
        course["sections"].append({**course["sections"][0], "id": "new-section"})
        batches = discovery_batches(catalog, state, course["termCode"], 40, 7, history)
        self.assertEqual([["Two"], ["One"]], [batch[2] for batch in batches])

    def test_all_surnames_are_partitioned_without_silent_truncation(self):
        catalog = self.catalog()
        history = copy.deepcopy(catalog)
        history["courses"][0]["sections"][0]["instructors"] = [
            {"id": str(i), "name": f"Person Last{i}", "role": None} for i in range(205)]
        batches = discovery_batches(catalog, {"queries": {}}, catalog["courses"][0]["termCode"], 40, 7, history)
        self.assertEqual(6, len(batches))
        self.assertEqual(205, sum(len(batch[2]) for batch in batches))
        self.assertEqual(205, len({name for batch in batches for name in batch[2]}))

    def test_history_merge_preserves_current_term_evidence_and_timestamps(self):
        current = self.catalog()
        section = current["courses"][0]["sections"][0]
        section["instructorDiscovery"] = {"status": "SURNAME_MATCH", "surnames": ["One"],
                                          "checkedAt": "2026-10-19T00:00:00Z"}
        historical = copy.deepcopy(current)
        old = historical["courses"][0]
        old["id"] = "older-course"
        old["termCode"] = "1268"
        historical["coverage"][0]["termCode"] = "1268"
        historical["terms"] = [{"code": "1268", "label": "Autumn 2026"}]
        historical["generatedAt"] = "2026-10-19T00:00:00Z"
        merged = merge_catalogs(current, historical)
        preserved = next(c for c in merged["courses"] if c["id"] == current["courses"][0]["id"])
        self.assertEqual(current["courses"][0], preserved)
        self.assertEqual(2, len(merged["coverage"]))

    def test_compound_surname_evidence_is_retained(self):
        catalog = self.catalog()
        catalog["courses"][0]["sections"][0]["instructorDiscovery"] = {"surnames": ["Abu Shattal"]}
        seeds = candidates_by_subject(catalog)
        self.assertEqual(["Abu Shattal"], seeds[catalog["courses"][0]["subject"]])

    def test_compound_display_names_supply_query_alternatives_without_assigning_instructors(self):
        catalog = self.catalog()
        history = copy.deepcopy(catalog)
        history["courses"][0]["sections"][0]["instructors"] = [
            {"id": "one", "name": "Diana Leyva del Rio"},
            {"id": "two", "name": "Abu Shattal, Mohammad"}]
        candidates = candidates_by_subject(catalog, history)[catalog["courses"][0]["subject"]]
        self.assertEqual(["Abu Shattal", "del Rio", "Leyva del Rio", "Rio"], candidates)
        self.assertFalse(catalog["courses"][0]["sections"][0]["instructors"])

    def test_refresh_keeps_search_evidence_until_newer_search_or_published_name(self):
        previous = self.catalog()
        evidence = {"status": "SURNAME_MATCH", "surnames": ["One"],
                    "checkedAt": "2026-10-20T00:00:00Z"}
        previous["courses"][0]["sections"][0]["instructorDiscovery"] = evidence
        fresh = self.catalog()
        merged = merge_catalogs(previous, fresh)
        self.assertEqual(evidence, merged["courses"][0]["sections"][0]["instructorDiscovery"])
        self.assertIsNone(fresh["courses"][0]["sections"][0]["instructorDiscovery"])
        replacement = {"status": "SURNAME_MATCH", "surnames": ["Two"],
                       "checkedAt": "2026-10-21T00:00:00Z"}
        fresh["courses"][0]["sections"][0]["instructorDiscovery"] = replacement
        merged = merge_catalogs(previous, fresh)
        self.assertEqual(replacement, merged["courses"][0]["sections"][0]["instructorDiscovery"])
        fresh["courses"][0]["sections"][0]["instructors"] = [{"id": "official", "name": "Alice Three"}]
        merged = merge_catalogs(previous, fresh)
        self.assertIsNone(merged["courses"][0]["sections"][0]["instructorDiscovery"])
        self.assertEqual("Alice Three", merged["courses"][0]["sections"][0]["instructors"][0]["name"])

    def test_merge_retains_newer_search_without_restoring_removed_sections(self):
        previous = self.catalog()
        evidence = {"status": "SURNAME_MATCH", "surnames": ["One"],
                    "checkedAt": "2026-10-22T00:00:00Z"}
        previous["courses"][0]["sections"][0]["instructorDiscovery"] = evidence
        fresh = self.catalog()
        fresh["courses"][0]["sections"][0]["instructorDiscovery"] = {
            **evidence, "surnames": ["Two"], "checkedAt": "2026-10-21T00:00:00Z"}
        removed = copy.deepcopy(previous["courses"][0]["sections"][0])
        removed["id"] = "removed-section"
        previous["courses"][0]["sections"].append(removed)
        previous["coverage"][0]["sectionCount"] += 1
        merged = merge_catalogs(previous, fresh)
        self.assertEqual(evidence, merged["courses"][0]["sections"][0]["instructorDiscovery"])
        self.assertFalse(any(s["id"] == "removed-section" for s in merged["courses"][0]["sections"]))

    def test_public_catalog_has_only_upcoming_term_but_history_still_supplies_candidates(self):
        current = self.catalog()
        current_term = current["courses"][0]["termCode"]
        history = copy.deepcopy(current)
        old = history["courses"][0]
        old["id"], old["termCode"] = "historical-course", "1268"
        old["sections"][0]["instructors"] = [{"id": "prior", "name": "Earlier Teacher"}]
        history["coverage"][0]["termCode"] = "1268"
        history["terms"] = [{"code": "1268", "label": "Autumn 2026"}]
        public = select_term(merge_catalogs(current, history), current_term)
        self.assertEqual([current_term], [term["code"] for term in public["terms"]])
        self.assertEqual(1, len(public["courses"]))
        self.assertTrue(all(scope["termCode"] == current_term for scope in public["coverage"]))
        batches = discovery_batches(public, {"queries": {}}, current_term, 40, 7, history)
        self.assertEqual(["Teacher"], batches[0][2])

    def test_never_searched_names_run_before_expired_queries_to_prevent_starvation(self):
        catalog = self.catalog()
        course = catalog["courses"][0]
        history = copy.deepcopy(catalog)
        history["courses"][0]["sections"][0]["instructors"] = [
            {"id": "a", "name": "Person Alpha"}, {"id": "b", "name": "Person Zulu"}]
        key = "|".join((course["termCode"], course["campus"], course["subject"], "alpha"))
        state = {"queries": {key: {"checkedAt": "2020-01-01T00:00:00Z", "scopeFingerprint": scope_fingerprint(
            catalog, course["termCode"], course["campus"], course["subject"])}}}
        batches = discovery_batches(catalog, state, course["termCode"], 40, 7, history)
        self.assertEqual([["Zulu"], ["Alpha"]], [batch[2] for batch in batches])
        state["queries"][key]["scopeFingerprint"] = "changed-inventory"
        batches = discovery_batches(catalog, state, course["termCode"], 40, 7, history)
        self.assertEqual([["Zulu"], ["Alpha"]], [batch[2] for batch in batches])


if __name__ == "__main__":
    unittest.main()

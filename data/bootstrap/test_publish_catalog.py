import copy
import json
import tempfile
import unittest
from pathlib import Path

from publish_catalog import load_catalog, publish


class PublishCatalogTest(unittest.TestCase):
    def catalog(self):
        source = json.loads((Path(__file__).parents[1] / "catalog-contract.example.json").read_text())
        source["generatedAt"] = "2026-10-20T18:00:00Z"
        # Contract fixtures contain one complete course scope.
        source["coverage"] = [{
            "termCode": source["courses"][0]["termCode"], "campus": source["courses"][0]["campus"],
            "subjects": sorted({c["subject"] for c in source["courses"]}),
            "courseCount": len(source["courses"]),
            "sectionCount": sum(len(c["sections"]) for c in source["courses"]),
            "namedInstructorSections": sum(bool(s["instructors"]) for c in source["courses"] for s in c["sections"]),
            "complete": True, "warnings": [],
        }]
        return source

    def test_round_trip_preserves_every_record_and_qualifying_field(self):
        catalog = self.catalog()
        with tempfile.TemporaryDirectory() as directory:
            legacy = Path(directory) / "catalog.json"
            legacy.write_text("old")
            manifest = publish(catalog, directory)
            merged = load_catalog(Path(directory) / "catalog-index.json")
            self.assertEqual(catalog["courses"], merged["courses"])
            self.assertEqual(catalog["source"], merged["source"])
            self.assertEqual(1, len(manifest["catalogs"]))
            self.assertFalse(legacy.exists())

    def test_failed_validation_leaves_published_index_untouched(self):
        catalog = self.catalog()
        with tempfile.TemporaryDirectory() as directory:
            publish(catalog, directory)
            path = Path(directory) / "catalog-index.json"
            before = path.read_bytes()
            catalog["coverage"][0]["sectionCount"] += 1
            with self.assertRaisesRegex(ValueError, "counts"):
                publish(catalog, directory)
            self.assertEqual(before, path.read_bytes())

    def test_daily_updates_retain_only_current_and_previous_generated_files(self):
        catalog = self.catalog()
        with tempfile.TemporaryDirectory() as directory:
            first = publish(catalog, directory)
            first_file = Path(directory) / first["catalogs"][0]["url"].removeprefix("/data/")
            catalog["generatedAt"] = "2026-10-21T00:00:00Z"
            second = publish(catalog, directory)
            second_file = Path(directory) / second["catalogs"][0]["url"].removeprefix("/data/")
            self.assertTrue(first_file.exists())
            unrelated = Path(directory) / "catalogs/notes.json"
            unrelated.write_text("unrelated")
            catalog["generatedAt"] = "2026-10-22T00:00:00Z"
            publish(catalog, directory)
            self.assertFalse(first_file.exists())
            self.assertTrue(second_file.exists())
            self.assertTrue(unrelated.exists())

    def test_groups_whole_subjects_without_overlapping_scopes(self):
        catalog = self.catalog()
        other = copy.deepcopy(catalog["courses"][0])
        other.update(id="other-course", subject="ZZTEST", description="x" * 3000)
        for section in other["sections"]:
            section["id"] += "-other"
        catalog["courses"][0]["description"] = "y" * 3000
        catalog["courses"].append(other)
        catalog["subjects"].append({"code": "ZZTEST", "label": "Test subject"})
        catalog["coverage"][0]["subjects"].append("ZZTEST")
        catalog["coverage"][0]["courseCount"] += 1
        catalog["coverage"][0]["sectionCount"] += len(other["sections"])
        with tempfile.TemporaryDirectory() as directory:
            manifest = publish(catalog, directory, target_bytes=4096)
            self.assertEqual(2, len(manifest["catalogs"]))
            merged = load_catalog(Path(directory) / "catalog-index.json")
            self.assertEqual({c["id"] for c in catalog["courses"]}, {c["id"] for c in merged["courses"]})

    def test_same_section_copied_to_another_course_cannot_mask_missing_classes(self):
        catalog = self.catalog()
        other = copy.deepcopy(catalog["courses"][0])
        other["id"] = "another-course-with-duplicated-section"
        catalog["courses"].append(other)
        catalog["coverage"][0]["courseCount"] += 1
        catalog["coverage"][0]["sectionCount"] += len(other["sections"])
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "Duplicate section"):
                publish(catalog, directory)

    def test_manifest_rejects_mismatched_scope_counts_metadata_and_duplicate_entries(self):
        catalog = self.catalog()
        mutations = [
            lambda value: value["catalogs"][0].update(termCode="9999"),
            lambda value: value["catalogs"][0].update(campus="nwk"),
            lambda value: value["catalogs"][0].update(subjects=["NOT_IMPORTED"]),
            lambda value: value["catalogs"][0].update(courseCount=999),
            lambda value: value["catalogs"][0].update(sectionCount=999),
            lambda value: value["catalogs"].append(copy.deepcopy(value["catalogs"][0])),
            lambda value: value.update(generatedAt="not-a-time"),
        ]
        with tempfile.TemporaryDirectory() as directory:
            manifest = publish(catalog, directory)
            path = Path(directory) / "catalog-index.json"
            for mutation in mutations:
                value = copy.deepcopy(manifest)
                mutation(value)
                path.write_text(json.dumps(value))
                with self.subTest(value=value):
                    with self.assertRaises(ValueError):
                        load_catalog(path)
            path.write_text(json.dumps(manifest))
            shard_path = Path(directory) / manifest["catalogs"][0]["url"].removeprefix("/data/")
            shard = json.loads(shard_path.read_text())
            shard["campuses"] = [{"code": "nwk", "label": "Wrong campus"}]
            shard_path.write_text(json.dumps(shard))
            with self.assertRaisesRegex(ValueError, "metadata"):
                load_catalog(path)

    def test_zero_offering_subject_at_batch_boundary_does_not_create_empty_shard(self):
        catalog = self.catalog()
        catalog["courses"][0]["description"] = "x" * 5000
        catalog["coverage"][0]["subjects"].append("ZZEMPTY")
        catalog["subjects"].append({"code": "ZZEMPTY", "label": "No current offerings"})
        with tempfile.TemporaryDirectory() as directory:
            manifest = publish(catalog, directory, target_bytes=1024)
            self.assertEqual(1, len(manifest["catalogs"]))
            merged = load_catalog(Path(directory) / "catalog-index.json")
            self.assertIn("ZZEMPTY", merged["coverage"][0]["subjects"])
            self.assertEqual(catalog["courses"], merged["courses"])

    def test_manifest_cannot_load_outside_its_data_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "catalog-index.json"
            path.write_text(json.dumps({"schemaVersion": 1, "generatedAt": "2026-10-20T00:00:00Z",
                                       "catalogs": [{"url": "/data/../private.json"}]}))
            with self.assertRaisesRegex(ValueError, "path"):
                load_catalog(path)


if __name__ == "__main__":
    unittest.main()

package org.osuprofs;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.osuprofs.adapter.out.file.FileSnapshotStore;
import tools.jackson.databind.json.JsonMapper;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class CatalogManifestTest {
    @TempDir Path temp;
    private final JsonMapper mapper = JsonMapper.builder().build();
    private final FileSnapshotStore store = new FileSnapshotStore(mapper);
    private Map<String, Object> entry(String subject, String url) {
        return Map.of("url", url, "termCode", "1272", "campus", "col", "subjects", List.of(subject), "courseCount", 1, "sectionCount", 2);
    }
    private Path manifest(List<Map<String, Object>> entries) throws Exception {
        Path file = temp.resolve("catalog-index.json");
        Files.writeString(file, mapper.writeValueAsString(Map.of("schemaVersion", 1, "generatedAt", "2026-10-20T18:00:00Z", "catalogs", entries)));
        return file;
    }
    @Test void loadsDisjointShardsAndPreservesTheirSubjectCoverage() throws Exception {
        store.write(temp.resolve("catalogs/cse.json").toString(), CatalogFixtures.snapshot("1272", "CSE", 2));
        store.write(temp.resolve("catalogs/math.json").toString(), CatalogFixtures.snapshot("1272", "MATH", 2));
        var result = store.read(manifest(List.of(entry("CSE", "/data/catalogs/cse.json"), entry("MATH", "/data/catalogs/math.json"))).toString()).orElseThrow();
        assertEquals(2, result.courses().size());
        assertEquals(Set.of("CSE", "MATH"), new HashSet<>(result.subjects().stream().map(o -> o.code()).toList()));
        assertEquals("2026-10-20T18:00:00Z", result.generatedAt());
    }
    @Test void rejectsMissingOverlappingOutsideOrMiscountedShardsRatherThanServingPartialData() throws Exception {
        store.write(temp.resolve("catalogs/cse.json").toString(), CatalogFixtures.snapshot("1272", "CSE", 2));
        var valid = entry("CSE", "/data/catalogs/cse.json");
        for (var entries : List.of(List.of(entry("CSE", "/data/catalogs/missing.json")), List.of(valid, valid),
                List.of(entry("CSE", "/data/../outside.json")), List.of(entry("MATH", "/data/catalogs/cse.json"))))
            assertThrows(IllegalStateException.class, () -> store.read(manifest(entries).toString()));
        var wrongCount = new HashMap<>(valid); wrongCount.put("sectionCount", 999);
        assertThrows(IllegalStateException.class, () -> store.read(manifest(List.of(wrongCount)).toString()));
    }
    @Test void onlyMissingDefaultManifestFallsBackToLegacyCatalog() throws Exception {
        var legacy = CatalogFixtures.snapshot("1272", "CSE", 2); store.write(temp.resolve("catalog.json").toString(), legacy);
        assertEquals(legacy, store.read(temp.resolve("catalog-index.json").toString()).orElseThrow());
        Files.writeString(temp.resolve("catalog-index.json"), "{}");
        assertThrows(Exception.class, () -> store.read(temp.resolve("catalog-index.json").toString()));
    }
}

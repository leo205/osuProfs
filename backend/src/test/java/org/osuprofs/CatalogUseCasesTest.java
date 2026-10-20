package org.osuprofs;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.osuprofs.adapter.out.file.FileSnapshotStore;
import org.osuprofs.application.port.in.*;
import org.osuprofs.application.service.*;
import org.osuprofs.domain.model.Catalog;
import tools.jackson.databind.json.JsonMapper;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class CatalogUseCasesTest {
    @TempDir Path temp;
    private final FileSnapshotStore store = new FileSnapshotStore(JsonMapper.builder().build());
    @Test void failedOrSuddenlyShrinkingImportsLeavePublishedBytesUntouched() throws Exception {
        String output = temp.resolve("catalog.json").toString();
        store.write(output, CatalogFixtures.snapshot("1272", "CSE", 10));
        String original = Files.readString(Path.of(output));
        var importer = new CatalogImportService((term, campus, subjects) -> CatalogFixtures.snapshot(term, "CSE", 2), store, null);
        assertThrows(IllegalStateException.class, () -> importer.run(new ImportCatalog.Request("1272", "col", List.of("CSE"), output, .25, false)));
        assertEquals(original, Files.readString(Path.of(output)));
    }
    @Test void refreshPreservesOtherTermsAndCourseIdentifiers() throws Exception {
        String output = temp.resolve("catalog.json").toString();
        store.write(output, CatalogFixtures.snapshot("1268", "CSE", 2));
        var importer = new CatalogImportService((term, campus, subjects) -> CatalogFixtures.snapshot(term, "CSE", 3), store, null);
        var result = importer.run(new ImportCatalog.Request("1272", "col", List.of("CSE"), output, .25, false));
        assertEquals(Set.of("1268", "1272"), new HashSet<>(result.terms().stream().map(Catalog.Option::code).toList()));
        assertEquals(2, result.courses().size()); assertEquals(2, result.coverage().size());
        assertEquals(result, store.read(output).orElseThrow());
        try (var paths = Files.list(temp)) { assertEquals(1, paths.count(), "No half-written temporary files remain"); }
    }
    @Test void incompleteImportIsNeverPublished() throws Exception {
        Catalog sample = CatalogFixtures.snapshot("1272", "CSE", 2);
        Catalog broken = new Catalog(1, sample.generatedAt(), sample.source(), sample.terms(), sample.subjects(), sample.campuses(),
            List.of(new Catalog.Coverage("1272", "col", List.of("CSE"), 1, 2, 1, false, List.of("Missing page"))), sample.courses());
        var importer = new CatalogImportService((term, campus, subjects) -> broken, store, null);
        String output = temp.resolve("catalog.json").toString();
        assertThrows(IllegalStateException.class, () -> importer.run(new ImportCatalog.Request("1272", "col", List.of("CSE"), output, .25, false)));
        assertFalse(Files.exists(Path.of(output)));
    }
    @Test void courseNumberFilterIsExactAndInstructorSearchIsCaseInsensitive() {
        var queries = new CatalogQueryService(CatalogFixtures.snapshot("1272", "CSE", 2));
        assertEquals(1, queries.search(new QueryCatalog.Search("cse2421", "1272", "CSE", "", "inSTRUCTOR", "col", 0, 25)).total());
        assertEquals(0, queries.search(new QueryCatalog.Search("", "", "", "9999", "", "", 0, 25)).total());
        assertThrows(IllegalArgumentException.class, () -> queries.search(new QueryCatalog.Search("", "", "", "", "", "", -1, 25)));
        assertEquals(0, queries.search(new QueryCatalog.Search("", "", "", "", "", "", Integer.MAX_VALUE, 100)).items().size());
    }
    @Test void invalidSnapshotDoesNotSilentlyBecomeAnEmptyCatalog() throws Exception {
        String output = temp.resolve("bad.json").toString();
        Files.writeString(Path.of(output), "{\"schemaVersion\":2,\"courses\":[]}");
        assertThrows(Exception.class, () -> store.read(output));
    }
}

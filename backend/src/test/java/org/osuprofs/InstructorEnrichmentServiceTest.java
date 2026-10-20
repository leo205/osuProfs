package org.osuprofs;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.osuprofs.adapter.out.file.*;
import org.osuprofs.application.port.in.ImportCatalog;
import org.osuprofs.application.port.in.QueryCatalog;
import org.osuprofs.application.port.out.InstructorDiscoverySource;
import org.osuprofs.application.service.*;
import org.osuprofs.domain.model.Catalog;
import tools.jackson.databind.json.JsonMapper;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.UnaryOperator;
import static org.junit.jupiter.api.Assertions.*;

class InstructorEnrichmentServiceTest {
    @TempDir Path temp;
    private static final String SOURCE = "https://courses.erppub.osu.edu/psc/ps_1/EMPLOYEE/CAMP/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL";
    private static final String CHECKED = "2026-10-20T18:00:00Z";
    private final FileSnapshotStore store = new FileSnapshotStore(JsonMapper.builder().build());
    private InstructorEnrichmentService service(InstructorDiscoverySource source, String... names) {
        return new InstructorEnrichmentService(source, new InstructorEnrichmentService.Options("CSE", "", List.of(names), 20, false));
    }
    private InstructorDiscoverySource.Evidence evidence(String term, String classNumber, String surname) {
        return new InstructorDiscoverySource.Evidence(term, classNumber, surname, SOURCE, CHECKED);
    }
    private Catalog mapSections(Catalog catalog, UnaryOperator<Catalog.Section> mapper) {
        var courses = catalog.courses().stream().map(c -> new Catalog.Course(c.id(), c.termCode(), c.campus(), c.subject(), c.catalogNumber(), c.title(),
            c.description(), c.credits(), c.career(), c.prerequisites(), c.attributes(), c.sections().stream().map(mapper).toList())).toList();
        return new Catalog(catalog.schemaVersion(), catalog.generatedAt(), catalog.source(), catalog.terms(), catalog.subjects(), catalog.campuses(), catalog.coverage(), courses);
    }
    private Catalog withCachedEvidence(Catalog catalog, String... surnames) {
        return mapSections(catalog, s -> s.instructors().isEmpty() ? new Catalog.Section(s.id(), s.classNumber(), s.section(), s.component(),
            s.instructionMode(), s.instructors(), s.meetings(), s.enrollment(), s.sourceUrl(), s.lastUpdated(),
            new Catalog.InstructorDiscovery(surnames.length == 1 ? "SURNAME_MATCH" : "AMBIGUOUS", List.of(surnames), SOURCE, "2026-10-19T12:00:00Z", "PEOPLESOFT_EXACT_LAST_NAME")) : s);
    }
    @Test void joinsByCurrentTermClassNumberAndNeverInventsAFullName() throws Exception {
        var fresh = CatalogFixtures.snapshot("1272", "CSE", 2);
        var result = service(query -> List.of(evidence("1272", "1", "Lee"), evidence("1272", "0", "Lee")), "Lee").enrich(fresh, null);
        var named = result.courses().getFirst().sections().getFirst();
        var unknown = result.courses().getFirst().sections().get(1);
        assertNull(named.instructorDiscovery(), "An official published identity wins");
        assertEquals(fresh.courses().getFirst().sections().getFirst().instructors(), named.instructors());
        assertTrue(unknown.instructors().isEmpty(), "Surname evidence must not populate published full identities");
        assertEquals("SURNAME_MATCH", unknown.instructorDiscovery().status());
        assertEquals(List.of("Lee"), unknown.instructorDiscovery().surnames());
        assertEquals("PEOPLESOFT_EXACT_LAST_NAME", unknown.instructorDiscovery().method());
        assertEquals(CHECKED, unknown.instructorDiscovery().checkedAt());
    }
    @Test void recordsMultipleVerifiedSurnamesAsAmbiguousAndRejectsWrongTerm() throws Exception {
        var fresh = CatalogFixtures.snapshot("1272", "CSE", 2);
        var result = service(query -> List.of(evidence("1272", "1", "Lee"), evidence("1272", "1", "Smith")), "Lee", "Smith").enrich(fresh, null);
        assertEquals("AMBIGUOUS", result.courses().getFirst().sections().get(1).instructorDiscovery().status());
        assertThrows(IllegalStateException.class, () -> service(query -> List.of(evidence("1268", "1", "Lee")), "Lee").enrich(fresh, null));
        assertThrows(IllegalStateException.class, () -> service(query -> List.of(evidence("1272", "999999", "Lee")), "Lee").enrich(fresh, null));
    }
    @Test void historicalNamesOnlySeedTheSearchAndAreNotFutureAssignments() throws Exception {
        var old = mapSections(CatalogFixtures.snapshot("1268", "CSE", 2), s -> new Catalog.Section(s.id(), s.classNumber(), s.section(), s.component(),
            s.instructionMode(), List.of(new Catalog.Instructor("historical-person", "Rubao Lee", "PI")), s.meetings(), s.enrollment(), s.sourceUrl(), s.lastUpdated()));
        AtomicReference<List<String>> seeds = new AtomicReference<>();
        var enrichment = new InstructorEnrichmentService(query -> { seeds.set(query.surnames()); return List.of(); },
            new InstructorEnrichmentService.Options("CSE", "", List.of(), 20));
        var result = enrichment.enrich(CatalogFixtures.snapshot("1272", "CSE", 2), old);
        assertTrue(seeds.get().contains("Lee"));
        assertTrue(result.courses().getFirst().sections().get(1).instructors().isEmpty());
        assertNull(result.courses().getFirst().sections().get(1).instructorDiscovery());
    }
    @Test void ordinaryImportPreservesVerifiedEvidenceAndItsOriginalCheckTime() throws Exception {
        String output = temp.resolve("catalog.json").toString();
        var old = withCachedEvidence(CatalogFixtures.snapshot("1272", "CSE", 2), "Lee"); store.write(output, old);
        var importer = new CatalogImportService((term, campus, subjects) -> CatalogFixtures.snapshot(term, "CSE", 2), store, null);
        var result = importer.run(new ImportCatalog.Request("1272", "col", List.of("CSE"), output, .25, false));
        assertEquals(old.courses().getFirst().sections().get(1).instructorDiscovery(), result.courses().getFirst().sections().get(1).instructorDiscovery());
    }
    @Test void failingDiscoveryNeverPublishesANameWipingRefresh() throws Exception {
        String output = temp.resolve("catalog.json").toString();
        store.write(output, withCachedEvidence(CatalogFixtures.snapshot("1272", "CSE", 2), "Lee"));
        String before = Files.readString(Path.of(output));
        var importer = new CatalogImportService((term, campus, subjects) -> CatalogFixtures.snapshot(term, "CSE", 2), store, null,
            service(query -> { throw new IllegalStateException("Public discovery unavailable"); }, "Lee"));
        assertThrows(IllegalStateException.class, () -> importer.run(new ImportCatalog.Request("1272", "col", List.of("CSE"), output, .25, false)));
        assertEquals(before, Files.readString(Path.of(output)));
    }
    @Test void successfulNegativeRevalidationRemovesOnlyTestedSurnameEvidence() throws Exception {
        var cached = withCachedEvidence(CatalogFixtures.snapshot("1272", "CSE", 2), "Lee", "Smith");
        var result = service(query -> List.of(), "Lee").enrich(cached, null);
        var discovery = result.courses().getFirst().sections().get(1).instructorDiscovery();
        assertEquals(List.of("Smith"), discovery.surnames());
        assertEquals("SURNAME_MATCH", discovery.status());
        assertEquals("2026-10-19T12:00:00Z", discovery.checkedAt());
    }
    @Test void surnameEvidenceIsSearchableWithoutBecomingAPublishedIdentity() {
        var catalog = new CatalogQueryService(withCachedEvidence(CatalogFixtures.snapshot("1272", "CSE", 2), "Lee"));
        assertEquals(1, catalog.search(new QueryCatalog.Search("Lee", "1272", "", "", "", "", 0, 25)).total());
        assertEquals(1, catalog.search(new QueryCatalog.Search("", "1272", "", "", "Lee", "", 0, 25)).total());
        assertTrue(catalog.instructors("Lee").isEmpty());
        assertEquals(0, catalog.search(new QueryCatalog.Search("Rubao Lee", "1272", "", "", "", "", 0, 25)).total());
    }
    @Test void candidateFilesSupportBoundedPlainTextAndPublicDirectoryJson() throws Exception {
        var reader = new DiscoveryCandidateFile(JsonMapper.builder().build());
        var txt = temp.resolve("candidates.txt"); Files.writeString(txt, "# Public seeds\nLee\n\nSmith\n");
        assertEquals(List.of("Lee", "Smith"), reader.read(txt.toString()));
        var json = temp.resolve("candidates.json"); Files.writeString(json, "[\"Lee\",{\"name\":\"A Candidate\",\"surname\":\"Smith\"}]");
        assertEquals(List.of("Lee", "Smith"), reader.read(json.toString()));
        Files.writeString(json, "[{\"name\":\"No surname\"}]");
        assertThrows(IllegalArgumentException.class, () -> reader.read(json.toString()));
        Files.writeString(txt, "# No candidates\n\n");
        assertThrows(IllegalArgumentException.class, () -> reader.read(txt.toString()));
        Files.writeString(json, "[]");
        assertThrows(IllegalArgumentException.class, () -> reader.read(json.toString()));
    }
}

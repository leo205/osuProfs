package org.osuprofs;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.osuprofs.adapter.out.file.*;
import org.osuprofs.application.port.in.*;
import org.osuprofs.application.port.out.*;
import org.osuprofs.application.service.*;
import org.osuprofs.domain.model.Catalog;
import tools.jackson.databind.json.JsonMapper;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class InstructorIdentityResolutionTest {
    @TempDir Path temp;
    private final JsonMapper mapper = JsonMapper.builder().build();
    private Catalog.InstructorIdentityMatch identity(String id, String name, String surname) {
        return new Catalog.InstructorIdentityMatch(id, name, surname, "https://cse.osu.edu/people/" + id, null,
            List.of("https://engineering.osu.edu/news/2026/08/meet-colleges-2026-2027-new-faculty-cohort"), "LIKELY", "2026-10-20T17:51:38Z");
    }
    private Catalog discovered(String surname, List<Catalog.InstructorIdentityMatch> identities) {
        var catalog = CatalogFixtures.snapshot("1272", "CSE", 2); var c = catalog.courses().getFirst();
        var sections = c.sections().stream().map(s -> !s.instructors().isEmpty() ? s : new Catalog.Section(s.id(), s.classNumber(), s.section(),
            s.component(), s.instructionMode(), s.instructors(), s.meetings(), s.enrollment(), s.sourceUrl(), s.lastUpdated(),
            new Catalog.InstructorDiscovery("SURNAME_MATCH", List.of(surname), "https://courses.erppub.osu.edu/", "2026-10-20T17:00:00Z", "PEOPLESOFT_EXACT_LAST_NAME", identities))).toList();
        var course = new Catalog.Course(c.id(), c.termCode(), c.campus(), c.subject(), c.catalogNumber(), c.title(), c.description(), c.credits(),
            c.career(), c.prerequisites(), c.attributes(), sections);
        return new Catalog(catalog.schemaVersion(), catalog.generatedAt(), catalog.source(), catalog.terms(), catalog.subjects(), catalog.campuses(), catalog.coverage(), List.of(course));
    }
    private InstructorIdentityResolutionService resolver(String subject, Catalog.InstructorIdentityMatch... people) {
        return new InstructorIdentityResolutionService(() -> new InstructorIdentityRegistry.Registry(subject, List.of(people)));
    }
    @Test void keepsEveryReviewedFirstNameCandidateAndNeverPublishesALikelyIdentity() throws Exception {
        var rubao = identity("rubao", "Rubao Lee", "Lee"); var alternate = identity("alternate", "Yoonkyung Lee", "Lee");
        var fresh = discovered("Lee", null); var result = resolver("CSE", rubao, alternate).resolve(fresh);
        var section = result.courses().getFirst().sections().get(1);
        assertTrue(section.instructors().isEmpty());
        assertEquals(Set.of("Rubao Lee", "Yoonkyung Lee"), new HashSet<>(section.instructorDiscovery().fullNameMatches().stream().map(Catalog.InstructorIdentityMatch::name).toList()));
        assertTrue(section.instructorDiscovery().fullNameMatches().stream().allMatch(i -> i.confidence().equals("LIKELY")));
        assertEquals(fresh.courses().getFirst().sections().getFirst(), result.courses().getFirst().sections().getFirst());
        assertEquals("2026-10-20T17:00:00Z", section.instructorDiscovery().checkedAt(), "Identity review must not change assignment-check time");
    }
    @Test void requiresExactNormalizedSurnameAndMatchingSubject() throws Exception {
        var candidate = identity("garcia", "Reviewed García", "García");
        var result = resolver("CSE", candidate).resolve(discovered("  GARCIA  ", null));
        assertEquals(1, result.courses().getFirst().sections().get(1).instructorDiscovery().fullNameMatches().size());
        var otherSubject = resolver("MATH", candidate).resolve(discovered("García", null));
        assertTrue(otherSubject.courses().getFirst().sections().get(1).instructorDiscovery().fullNameMatches().isEmpty(),
            "A reviewed identity in a different subject must not become a candidate");
        assertTrue(resolver("CSE", identity("other", "Reviewed McLee", "McLee")).resolve(discovered("Lee", null))
            .courses().getFirst().sections().get(1).instructorDiscovery().fullNameMatches().isEmpty());
    }
    @Test void fullCandidateSearchDoesNotCreateAnOfficialInstructorProfile() throws Exception {
        var catalog = new CatalogQueryService(resolver("CSE", identity("rubao", "Rubao Lee", "Lee")).resolve(discovered("Lee", null)));
        assertEquals(1, catalog.search(new QueryCatalog.Search("Rubao Lee", "1272", "", "", "", "", 0, 25)).total());
        assertEquals(1, catalog.search(new QueryCatalog.Search("", "1272", "", "", "Rubao Lee", "", 0, 25)).total());
        assertTrue(catalog.instructors("Rubao").isEmpty());
    }
    @Test void normalRefreshAndSurnameRevalidationRetainExistingReviewedMetadata() throws Exception {
        var person = identity("rubao", "Rubao Lee", "Lee"); var old = discovered("Lee", List.of(person));
        String output = temp.resolve("catalog.json").toString(); var store = new FileSnapshotStore(mapper); store.write(output, old);
        var request = new ImportCatalog.Request("1272", "col", List.of("CSE"), output, .25, false);
        var plain = new CatalogImportService((term, campus, subjects) -> CatalogFixtures.snapshot("1272", "CSE", 2), store, null).run(request);
        assertEquals(List.of(person), plain.courses().getFirst().sections().get(1).instructorDiscovery().fullNameMatches());
        var enrichment = new InstructorEnrichmentService(query -> List.of(new InstructorDiscoverySource.Evidence("1272", "1", "Lee", "https://courses.erppub.osu.edu/", "2026-10-21T12:00:00Z")),
            new InstructorEnrichmentService.Options("CSE", "", List.of("Lee"), 10, false));
        var refreshed = new CatalogImportService((term, campus, subjects) -> CatalogFixtures.snapshot("1272", "CSE", 2), store, null, enrichment).run(request);
        assertEquals(List.of(person), refreshed.courses().getFirst().sections().get(1).instructorDiscovery().fullNameMatches());
    }
    @Test void identityMappingFailureLeavesThePublishedSnapshotUntouched() throws Exception {
        var store = new FileSnapshotStore(mapper); String output = temp.resolve("catalog.json").toString(); store.write(output, discovered("Lee", List.of(identity("rubao", "Rubao Lee", "Lee"))));
        String before = Files.readString(Path.of(output));
        var bad = new InstructorIdentityResolutionService(() -> { throw new IllegalArgumentException("Malformed reviewed registry"); });
        var importer = new CatalogImportService((term, campus, subjects) -> CatalogFixtures.snapshot("1272", "CSE", 2), store, null, null, bad);
        assertThrows(IllegalArgumentException.class, () -> importer.run(new ImportCatalog.Request("1272", "col", List.of("CSE"), output, .25, false)));
        assertEquals(before, Files.readString(Path.of(output)));
    }
    @Test void registryRejectsEmptyDuplicateNonOfficialOrOverconfidentEntries() throws Exception {
        var file = temp.resolve("identities.json"); var person = identity("rubao", "Rubao Lee", "Lee");
        Files.writeString(file, mapper.writeValueAsString(Map.of("schemaVersion", 1, "subject", "CSE", "identities", List.of(person))));
        var reader = new FileInstructorIdentityRegistry(mapper, file.toString()); assertEquals(List.of(person), reader.load().identities());
        Files.writeString(file, mapper.writeValueAsString(Map.of("schemaVersion", 1, "subject", "CSE", "identities", List.of(person), "courseAffinities", Map.of(person.id(), List.of("3521")))));
        assertEquals(Map.of(person.id(), List.of("3521")), reader.load().courseAffinities());
        Files.writeString(file, mapper.writeValueAsString(Map.of("schemaVersion", 1, "subject", "CSE", "identities", List.of(person), "courseAffinities", Map.of("unknown-id", List.of("3521")))));
        assertThrows(IllegalArgumentException.class, reader::load);
        for (var entries : List.of(List.of(), List.of(person, person), List.of(new Catalog.InstructorIdentityMatch("rubao", "Rubao Lee", "Lee", "https://unofficial.example/people/lee", null, person.sourceUrls(), "LIKELY", person.checkedAt())),
                List.of(new Catalog.InstructorIdentityMatch("rubao", "Rubao Lee", "Lee", person.profileUrl(), null, person.sourceUrls(), "CONFIRMED", person.checkedAt())),
                List.of(new Catalog.InstructorIdentityMatch("rubao", "Rubao Lee", "Lee", person.profileUrl(), "https://unofficial.example/rating", person.sourceUrls(), "LIKELY", person.checkedAt())))) {
            Files.writeString(file, mapper.writeValueAsString(Map.of("schemaVersion", 1, "subject", "CSE", "identities", entries)));
            assertThrows(IllegalArgumentException.class, reader::load);
        }
    }
    @Test void oldDiscoveryJsonWithoutFullNamesRemainsReadable() {
        String old = "{\"status\":\"SURNAME_MATCH\",\"surnames\":[\"Lee\"],\"sourceUrl\":\"https://courses.erppub.osu.edu/\",\"checkedAt\":\"2026-10-20T17:00:00Z\",\"method\":\"PEOPLESOFT_EXACT_LAST_NAME\"}";
        assertNull(mapper.readValue(old, Catalog.InstructorDiscovery.class).fullNameMatches());
    }
}

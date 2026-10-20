package org.osuprofs;

import org.junit.jupiter.api.Test;
import org.osuprofs.application.port.out.InstructorIdentityRegistry;
import org.osuprofs.application.service.*;
import org.osuprofs.domain.model.Catalog;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

class CatalogBackedIdentityResolutionTest {
    private final InstructorIdentityResolutionService resolver = new InstructorIdentityResolutionService(() -> new InstructorIdentityRegistry.Registry("", List.of()));
    private Catalog.Instructor person(String id, String name) { return new Catalog.Instructor(id, name, "PI"); }
    private Catalog.Course course(String term, String number, List<Catalog.Instructor> teachers, String discoveredSurname) {
        var template = CatalogFixtures.snapshot(term, "CSE", 2).courses().getFirst();
        List<Catalog.Section> sections = new ArrayList<>();
        for (int i = 0; i < 2; i++) {
            var s = template.sections().get(i); String classNumber = number + i;
            var discovery = i == 1 && discoveredSurname != null ? new Catalog.InstructorDiscovery("SURNAME_MATCH", List.of(discoveredSurname),
                "https://courses.erppub.osu.edu/", "2026-10-20T17:00:00Z", "PEOPLESOFT_EXACT_LAST_NAME") : null;
            sections.add(new Catalog.Section(term + "-" + classNumber, classNumber, "000" + i, s.component(), s.instructionMode(),
                i == 0 ? teachers : List.of(), s.meetings(), s.enrollment(), s.sourceUrl(), s.lastUpdated(), discovery));
        }
        return new Catalog.Course(term + "-col-CSE-" + number, term, "col", "CSE", number, "Test course", "Test fixture", "3", "Undergraduate", null, List.of(), sections);
    }
    private Catalog catalog(Catalog.Course... courses) {
        var base = CatalogFixtures.snapshot("1272", "CSE", 2);
        return new Catalog(base.schemaVersion(), base.generatedAt(), base.source(), base.terms(), base.subjects(), base.campuses(), base.coverage(), List.of(courses));
    }
    private List<Catalog.InstructorIdentityMatch> matches(Catalog result) { return result.courses().getFirst().sections().get(1).instructorDiscovery().fullNameMatches(); }
    @Test void publishedHistoricalRecordsSupplyPortableNamesWithoutInventingFacultyUrls() throws Exception {
        var fresh = course("1272", "3521", List.of(), "Zhang");
        var old = course("1268", "3521", List.of(person("simon", "Simon Zhang")), null);
        var result = resolver.resolve(catalog(fresh, old)); var match = matches(result).getFirst();
        assertEquals("Simon Zhang", match.name()); assertEquals("LIKELY", match.confidence());
        assertEquals("https://content.osu.edu/v2/classes/search?term=1268&campus=col&subject=cse&q=35210", match.profileUrl());
        assertTrue(result.courses().getFirst().sections().get(1).instructors().isEmpty());
        assertEquals(old, result.courses().get(1), "Published historical course records must remain intact");
    }
    @Test void sameCourseTierKeepsEveryObservedInstructorAndExcludesUnrelatedSurnameMatches() throws Exception {
        var result = resolver.resolve(catalog(course("1272", "3521", List.of(), "Zhang"),
            course("1268", "3521", List.of(person("simon", "Simon Zhang"), person("avery", "Avery Zhang")), null),
            course("1268", "3901", List.of(person("unrelated", "Unrelated Zhang")), null)));
        assertEquals(Set.of("Simon Zhang", "Avery Zhang"), new HashSet<>(matches(result).stream().map(Catalog.InstructorIdentityMatch::name).toList()));
    }
    @Test void numberFamilyTierPrecedesOtherSubjectCandidates() throws Exception {
        var result = resolver.resolve(catalog(course("1272", "3521", List.of(), "Zhang"),
            course("1268", "5521", List.of(person("family", "Family Zhang")), null),
            course("1268", "3901", List.of(person("other", "Other Zhang")), null)));
        assertEquals(List.of("Family Zhang"), matches(result).stream().map(Catalog.InstructorIdentityMatch::name).toList());
    }
    @Test void subjectTierPreservesDistinctGivenNamesWhenNoCourseContextExists() throws Exception {
        var result = resolver.resolve(catalog(course("1272", "3521", List.of(), "Zhang"),
            course("1268", "3901", List.of(person("first", "First Zhang")), null),
            course("1268", "3430", List.of(person("second", "Second Zhang")), null)));
        assertEquals(Set.of("First Zhang", "Second Zhang"), new HashSet<>(matches(result).stream().map(Catalog.InstructorIdentityMatch::name).toList()));
    }
    @Test void reviewedProfileMetadataWinsByUniqueExactFullNameWithoutChangingPublishedIds() throws Exception {
        var reviewed = new Catalog.InstructorIdentityMatch("directory-simon", "Simon Zhang", "Zhang", "https://cse.osu.edu/people/reviewed",
            "https://www.ratemyprofessors.com/professor/123", List.of("https://cse.osu.edu/directory/faculty"), "LIKELY", "2026-10-20T18:00:00Z");
        var service = new InstructorIdentityResolutionService(() -> new InstructorIdentityRegistry.Registry("CSE", List.of(reviewed)));
        var result = service.resolve(catalog(course("1272", "3521", List.of(), "Zhang"), course("1268", "3521", List.of(person("published-simon", "Simon Zhang")), null)));
        assertEquals("published-simon", matches(result).getFirst().id()); assertEquals(reviewed.profileUrl(), matches(result).getFirst().profileUrl());
        assertEquals(reviewed.rateMyProfessorsUrl(), matches(result).getFirst().rateMyProfessorsUrl());
        assertTrue(matches(result).getFirst().sourceUrls().stream().anyMatch(url -> url.contains("term=1268") && url.contains("q=35210")));
    }
    @Test void reviewedCompoundSurnameCorrectsTheCatalogSeedHeuristic() throws Exception {
        var reviewed = new Catalog.InstructorIdentityMatch("directory", "Vijay Bojja Venkatakrishnan", "Bojja Venkatakrishnan",
            "https://cse.osu.edu/people/reviewed", null, List.of("https://cse.osu.edu/directory/faculty"), "LIKELY", "2026-10-20T18:00:00Z");
        var service = new InstructorIdentityResolutionService(() -> new InstructorIdentityRegistry.Registry("CSE", List.of(reviewed)));
        var result = service.resolve(catalog(course("1272", "3521", List.of(), "Bojja Venkatakrishnan"),
            course("1268", "3521", List.of(person("published", reviewed.name())), null)));
        assertEquals("published", matches(result).getFirst().id()); assertEquals(reviewed.surname(), matches(result).getFirst().surname());
    }
    @Test void reviewedExternalCourseProofParticipatesInTheSameCourseTier() throws Exception {
        var reviewed = new Catalog.InstructorIdentityMatch("directory-zhihui", "Zhihui Zhu", "Zhu", "https://cse.osu.edu/people/reviewed",
            null, List.of("https://registrar.osu.edu/example-official-schedule.pdf"), "LIKELY", "2026-10-20T18:00:00Z");
        var registry = new InstructorIdentityRegistry.Registry("CSE", List.of(reviewed), Map.of(reviewed.id(), List.of("3521")));
        var service = new InstructorIdentityResolutionService(() -> registry);
        var result = service.resolve(catalog(course("1272", "3521", List.of(), "Zhu"),
            course("1268", "3901", List.of(person("ting", "Ting Zhu"), person("published-zhihui", "Zhihui Zhu")), null)));
        assertEquals(List.of("Zhihui Zhu"), matches(result).stream().map(Catalog.InstructorIdentityMatch::name).toList());
        assertEquals("published-zhihui", matches(result).getFirst().id());
        assertTrue(matches(result).getFirst().sourceUrls().contains(reviewed.sourceUrls().getFirst()));
        assertEquals("LIKELY", matches(result).getFirst().confidence());
    }
    @Test void catalogCandidateSeedsCoverCurrentAndPriorNamesAndProcessEveryBoundedBatch() throws Exception {
        var fresh = catalog(course("1272", "3521", List.of(person("current", "Current Zhang")), "Zhang"));
        var previous = catalog(course("1268", "5521", List.of(person("old1", "Jonathan Torku"), person("old2", "Alan Perrault")), null));
        AtomicReference<List<String>> queried = new AtomicReference<>();
        var service = new InstructorEnrichmentService(query -> { queried.set(query.surnames()); return List.of(); },
            new InstructorEnrichmentService.Options("CSE", "", List.of("Bojja Venkatakrishnan"), 200));
        service.enrich(fresh, previous);
        assertTrue(queried.get().containsAll(List.of("Zhang", "Torku", "Perrault", "Bojja Venkatakrishnan")));
        List<List<String>> batches = new ArrayList<>();
        var capped = new InstructorEnrichmentService(query -> { batches.add(query.surnames()); return List.of(); },
            new InstructorEnrichmentService.Options("CSE", "", List.of("Lee", "Zhang", "Torku"), 2, false));
        capped.enrich(fresh, previous);
        assertEquals(List.of(List.of("Lee", "Torku"), List.of("Zhang")), batches);
    }
}

package org.osuprofs;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.osuprofs.adapter.out.file.FileSnapshotStore;
import org.osuprofs.application.port.in.ImportCatalog;
import org.osuprofs.application.port.out.*;
import org.osuprofs.application.service.*;
import org.osuprofs.domain.model.Catalog;
import tools.jackson.databind.json.JsonMapper;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class SchoolwideCatalogTest {
    @TempDir Path temp;
    private final FileSnapshotStore store = new FileSnapshotStore(JsonMapper.builder().build());
    private Catalog catalog(Catalog... catalogs) {
        Catalog first = catalogs[0];
        return new Catalog(1, first.generatedAt(), first.source(), Arrays.stream(catalogs).flatMap(c -> c.terms().stream()).distinct().toList(),
            Arrays.stream(catalogs).flatMap(c -> c.subjects().stream()).distinct().toList(), first.campuses(),
            Arrays.stream(catalogs).flatMap(c -> c.coverage().stream()).toList(),
            Arrays.stream(catalogs).flatMap(c -> c.courses().stream()).toList());
    }
    private Catalog named(String term, String subject, String name, String surname) {
        Catalog base = CatalogFixtures.snapshot(term, subject, 2);
        var c = base.courses().getFirst();
        var sections = c.sections().stream().map(s -> new Catalog.Section(subject + "-" + s.id(), s.classNumber(),
            s.section(), s.component(), s.instructionMode(), s.instructors().isEmpty() ? List.of() :
                List.of(new Catalog.Instructor(subject + "-" + name, name, "PI")), s.meetings(), s.enrollment(), s.sourceUrl(), s.lastUpdated(),
            s.instructors().isEmpty() && surname != null ? new Catalog.InstructorDiscovery("SURNAME_MATCH", List.of(surname),
                "https://courses.erppub.osu.edu/", base.generatedAt(), "PEOPLESOFT_EXACT_LAST_NAME") : null,
            new Catalog.SectionDetails("1", "Regular", "2027-01-11", "2027-04-26", "10", List.of("0020"), "I", "0010",
                "MAIN", List.of("Test attribute"), "https://content.osu.edu/v2/classes/availability?termCode=" + term))).toList();
        return new Catalog(1, base.generatedAt(), base.source(), base.terms(), base.subjects(), base.campuses(), base.coverage(),
            List.of(new Catalog.Course(c.id(), c.termCode(), c.campus(), c.subject(), c.catalogNumber(), c.title(), c.description(),
                c.credits(), c.career(), c.prerequisites(), c.attributes(), sections)));
    }
    @Test void allImportsUseEveryDiscoveredSubjectAndFailureCannotReplaceSnapshot() throws Exception {
        Catalog current = catalog(named("1272", "CSE", "Sam Lee", null), named("1272", "MATH", "Mary Jones", null));
        String output = temp.resolve("catalog.json").toString();
        var source = new CatalogSource() {
            @Override public List<String> subjects(String term, String campus) { return List.of("MATH", "CSE"); }
            @Override public Catalog fetch(String term, String campus, List<String> subjects) {
                assertEquals(List.of("CSE", "MATH"), subjects); return current;
            }
        };
        var request = new ImportCatalog.Request("1272", "col", List.of("ALL"), output, .25, false);
        var imported = new CatalogImportService(source, store, null).run(request);
        assertEquals(2, imported.courses().size());
        String before = Files.readString(Path.of(output));
        var incompleteSource = new CatalogSource() {
            @Override public List<String> subjects(String term, String campus) { return List.of("CSE", "MATH"); }
            @Override public Catalog fetch(String term, String campus, List<String> subjects) { return named("1272", "CSE", "Sam Lee", null); }
        };
        assertThrows(IllegalStateException.class, () -> new CatalogImportService(incompleteSource, store, null).run(request));
        assertEquals(before, Files.readString(Path.of(output)));
    }
    @Test void allRefreshIncludesPreviouslyCoveredSubjectsThatNowHaveZeroOfferings() throws Exception {
        String output = temp.resolve("catalog.json").toString();
        store.write(output, catalog(named("1272", "CSE", "Sam Lee", null), named("1272", "MATH", "Mary Jones", null)));
        var source = new CatalogSource() {
            @Override public List<String> subjects(String term, String campus) { return List.of("CSE"); }
            @Override public Catalog fetch(String term, String campus, List<String> subjects) {
                assertEquals(List.of("CSE", "MATH"), subjects);
                var current = named("1272", "CSE", "Sam Lee", null);
                return new Catalog(1, current.generatedAt(), current.source(), current.terms(), current.subjects(), current.campuses(),
                    List.of(new Catalog.Coverage(term, campus, subjects, 1, 2, 1, true, List.of())), current.courses());
            }
        };
        var result = new CatalogImportService(source, store, null).run(new ImportCatalog.Request("1272", "col", List.of("ALL"), output, .25, true));
        assertEquals(List.of("CSE"), result.courses().stream().map(Catalog.Course::subject).toList());
        assertEquals(List.of("CSE", "MATH"), result.coverage().getFirst().subjects());
    }
    @Test void multiSubjectDiscoveryUsesScopedSeedsAndPreservesDetails() throws Exception {
        Catalog fresh = catalog(named("1272", "CSE", "Sam Lee", null), named("1272", "MATH", "Mary Jones", null));
        Map<String, List<String>> queries = new LinkedHashMap<>();
        var service = new InstructorEnrichmentService(query -> {
            queries.computeIfAbsent(query.subject(), key -> new ArrayList<>()).addAll(query.surnames());
            return query.surnames().stream().map(surname -> new InstructorDiscoverySource.Evidence("1272", "1", surname,
                "https://courses.erppub.osu.edu/", fresh.generatedAt())).toList();
        }, new InstructorEnrichmentService.Options("ALL", "", List.of("Zhang"), 1, true, "CSE"));
        var enriched = service.enrich(fresh, null);
        assertEquals(Map.of("CSE", List.of("Lee", "Zhang"), "MATH", List.of("Jones")), queries);
        assertEquals(List.of("Jones"), enriched.courses().get(1).sections().get(1).instructorDiscovery().surnames());
        assertEquals(fresh.courses().get(1).sections().get(1).details(), enriched.courses().get(1).sections().get(1).details());
    }
    @Test void extraHistorySupportsEverySubjectWithoutPublishingOldCoursesOrCrossSubjectNames() throws Exception {
        Catalog current = catalog(named("1272", "CSE", "Current Cse", "Lee"), named("1272", "MATH", "Current Math", "Lee"));
        Catalog history = catalog(named("1268", "CSE", "Computer Lee", null), named("1268", "MATH", "Mathematics Lee", null));
        String output = temp.resolve("catalog.json").toString(), historical = temp.resolve("history.json").toString();
        store.write(output, current); store.write(historical, history);
        var reviewed = new Catalog.InstructorIdentityMatch("reviewed", "Reviewed Lee", "Lee", "https://cse.osu.edu/people/reviewed",
            null, List.of("https://cse.osu.edu/directory"), "LIKELY", current.generatedAt());
        var resolver = new InstructorIdentityResolutionService(() -> new InstructorIdentityRegistry.Registry("CSE", List.of(reviewed)), "ALL");
        var importer = new CatalogImportService((term, campus, subjects) -> current, store, null, null, resolver, historical);
        var result = importer.run(new ImportCatalog.Request("1272", "col", List.of("CSE", "MATH"), output, .25, false));
        assertEquals(Set.of("1272"), new HashSet<>(result.courses().stream().map(Catalog.Course::termCode).toList()));
        var math = result.courses().stream().filter(c -> c.subject().equals("MATH")).findFirst().orElseThrow();
        assertEquals(List.of("Mathematics Lee"), math.sections().get(1).instructorDiscovery().fullNameMatches().stream()
            .map(Catalog.InstructorIdentityMatch::name).toList());
        assertEquals(current.courses().get(1).sections().get(1).details(), math.sections().get(1).details());
    }
    @Test void failureInLaterDiscoveryBatchLeavesPublishedBytesUntouched() throws Exception {
        String output = temp.resolve("catalog.json").toString();
        Catalog current = named("1272", "CSE", "Sam Lee", null); store.write(output, current);
        String before = Files.readString(Path.of(output));
        var discovery = new InstructorEnrichmentService(query -> {
            if (query.surnames().contains("Zhang")) throw new IllegalStateException("Upstream unavailable");
            return List.of(new InstructorDiscoverySource.Evidence("1272", "1", "Lee", "https://courses.erppub.osu.edu/", current.generatedAt()));
        }, new InstructorEnrichmentService.Options("ALL", "", List.of("Zhang"), 1, true, "CSE"));
        var importer = new CatalogImportService((term, campus, subjects) -> current, store, null, discovery);
        assertThrows(IllegalStateException.class, () -> importer.run(new ImportCatalog.Request("1272", "col", List.of("CSE"), output, .25, false)));
        assertEquals(before, Files.readString(Path.of(output)));
    }
}

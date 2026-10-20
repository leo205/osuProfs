package org.osuprofs;

import org.osuprofs.domain.model.Catalog;
import java.util.List;

final class CatalogFixtures {
    static Catalog snapshot(String term, String subject, int sectionCount) {
        var sections = java.util.stream.IntStream.range(0, sectionCount).mapToObj(i -> new Catalog.Section(term + "-" + i,
            String.valueOf(i), "00" + i, "Lecture", "In Person", i == 0 ? List.of(new Catalog.Instructor("test-instructor", "Test Instructor", "PI")) : List.of(),
            List.of(), new Catalog.Enrollment("UNKNOWN", null, null, null, null, null), "https://classes.osu.edu/", "2026-10-20T12:00:00Z")).toList();
        var course = new Catalog.Course(term + "-col-" + subject + "-2421-123-1", term, "col", subject, "2421", "Systems I",
            "Description mentions 9999; exact course number is 2421", "4", "Undergraduate", null, List.of(), sections);
        return new Catalog(1, "2026-10-20T12:00:00Z", new Catalog.Source("Ohio State Class Search", "https://classes.osu.edu/", "https://content.osu.edu/v2/classes/search"),
            List.of(new Catalog.Option(term, "Spring 2027")), List.of(new Catalog.Option(subject, subject)),
            List.of(new Catalog.Option("col", "Columbus")), List.of(new Catalog.Coverage(term, "col", List.of(subject), 1, sectionCount, 1, true, List.of())), List.of(course));
    }
}

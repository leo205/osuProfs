package org.osuprofs.application.service;

import org.osuprofs.application.port.in.ImportCatalog;
import org.osuprofs.application.port.out.*;
import org.osuprofs.domain.model.Catalog;
import java.util.*;

/** Validates the full requested scope before publishing, preserving unrelated semesters and subjects. */
public final class CatalogImportService implements ImportCatalog {
    private final CatalogSource source;
    private final SnapshotStore snapshots;
    private final CatalogArchive archive;
    private final InstructorEnrichmentService enrichment;
    private final InstructorIdentityResolutionService identityResolution;
    public CatalogImportService(CatalogSource source, SnapshotStore snapshots, CatalogArchive archive) {
        this(source, snapshots, archive, null, null);
    }
    public CatalogImportService(CatalogSource source, SnapshotStore snapshots, CatalogArchive archive, InstructorEnrichmentService enrichment) {
        this(source, snapshots, archive, enrichment, null);
    }
    public CatalogImportService(CatalogSource source, SnapshotStore snapshots, CatalogArchive archive, InstructorEnrichmentService enrichment,
                                InstructorIdentityResolutionService identityResolution) {
        this.source = source; this.snapshots = snapshots; this.archive = archive; this.enrichment = enrichment;
        this.identityResolution = identityResolution;
    }
    @Override public Catalog run(Request request) throws Exception {
        if (!request.term().matches("[0-9]{4}") || !request.campus().matches("[a-z]{2,8}") || request.subjects().isEmpty())
            throw new IllegalArgumentException("Specify a four-digit term, campus code, and at least one subject");
        if (request.maxDropFraction() < 0 || request.maxDropFraction() > 1)
            throw new IllegalArgumentException("max-drop-fraction must be between 0 and 1");
        Set<String> requested = new TreeSet<>();
        for (String subject : request.subjects()) {
            if (!subject.matches("[A-Z0-9&_-]{1,15}")) throw new IllegalArgumentException("Invalid subject: " + subject);
            requested.add(subject);
        }
        Catalog next = source.fetch(request.term(), request.campus(), List.copyOf(requested));
        if (next.schemaVersion() != 1 || next.courses().isEmpty() || next.coverage().isEmpty() ||
            next.coverage().stream().anyMatch(c -> !c.complete()))
            throw new IllegalStateException("Import is empty or incomplete; existing snapshot retained");
        var previous = snapshots.read(request.output());
        if (previous.isPresent()) next = retainDiscovery(next, previous.get());
        if (enrichment != null) next = enrichment.enrich(next, previous.orElse(null));
        List<Catalog.Course> courses = new ArrayList<>(next.courses());
        List<Catalog.Coverage> coverage = new ArrayList<>(next.coverage());
        if (previous.isPresent()) {
            Catalog old = previous.get();
            for (String subject : requested) {
                int oldCount = countSections(old, request.term(), request.campus(), subject);
                int nextCount = countSections(next, request.term(), request.campus(), subject);
                if (!request.allowLargeDrop() && oldCount > 0 && nextCount < oldCount * (1 - request.maxDropFraction()))
                    throw new IllegalStateException("Section count dropped from " + oldCount + " to " + nextCount +
                        " for " + subject + "; existing snapshot retained. Review upstream changes before allowing a large drop.");
            }
            old.courses().stream().filter(c -> !(c.termCode().equals(request.term()) && c.campus().equals(request.campus()) &&
                requested.contains(c.subject()))).forEach(courses::add);
            for (Catalog.Coverage scope : old.coverage()) {
                if (!scope.termCode().equals(request.term()) || !scope.campus().equals(request.campus())) coverage.add(scope);
                else {
                    var remaining = scope.subjects().stream().filter(s -> !requested.contains(s)).toList();
                    if (!remaining.isEmpty()) coverage.add(coverage(scope.termCode(), scope.campus(), remaining, courses, scope.complete(), scope.warnings()));
                }
            }
        }
        courses.sort(Comparator.comparing(Catalog.Course::termCode).reversed().thenComparing(Catalog.Course::subject)
            .thenComparing(Catalog.Course::catalogNumber).thenComparing(Catalog.Course::id));
        Set<String> courseIds = new HashSet<>();
        for (Catalog.Course c : courses) if (!courseIds.add(c.id())) throw new IllegalStateException("Duplicate course ID: " + c.id());
        Catalog old = previous.orElse(next);
        Catalog merged = new Catalog(1, next.generatedAt(), next.source(), mergeOptions(next.terms(), old.terms()),
            mergeOptions(next.subjects(), old.subjects()), mergeOptions(next.campuses(), old.campuses()), coverage, courses);
        if (identityResolution != null) merged = identityResolution.resolve(merged);
        // A failing database write must not replace the published static snapshot.
        if (archive != null) archive.save(merged);
        snapshots.write(request.output(), merged);
        return merged;
    }
    private Catalog retainDiscovery(Catalog fresh, Catalog previous) {
        Map<String, Catalog.InstructorDiscovery> cached = new HashMap<>();
        previous.courses().forEach(c -> c.sections().stream().filter(s -> s.instructorDiscovery() != null)
            .forEach(s -> cached.put(c.termCode() + "-" + s.classNumber(), s.instructorDiscovery())));
        var courses = fresh.courses().stream().map(c -> new Catalog.Course(c.id(), c.termCode(), c.campus(), c.subject(),
            c.catalogNumber(), c.title(), c.description(), c.credits(), c.career(), c.prerequisites(), c.attributes(),
            c.sections().stream().map(s -> s.instructorDiscovery() != null || !s.instructors().isEmpty() || !cached.containsKey(c.termCode() + "-" + s.classNumber()) ? s :
                new Catalog.Section(s.id(), s.classNumber(), s.section(), s.component(), s.instructionMode(), s.instructors(),
                    s.meetings(), s.enrollment(), s.sourceUrl(), s.lastUpdated(), cached.get(c.termCode() + "-" + s.classNumber()))).toList())).toList();
        return new Catalog(fresh.schemaVersion(), fresh.generatedAt(), fresh.source(), fresh.terms(), fresh.subjects(), fresh.campuses(), fresh.coverage(), courses);
    }
    private int countSections(Catalog c, String term, String campus, String subject) {
        return c.courses().stream().filter(x -> x.termCode().equals(term) && x.campus().equals(campus) && x.subject().equals(subject))
            .mapToInt(x -> x.sections().size()).sum();
    }
    private List<Catalog.Option> mergeOptions(List<Catalog.Option> fresh, List<Catalog.Option> old) {
        Map<String, Catalog.Option> result = new TreeMap<>();
        old.forEach(o -> result.put(o.code(), o)); fresh.forEach(o -> result.put(o.code(), o));
        return List.copyOf(result.values());
    }
    private Catalog.Coverage coverage(String term, String campus, List<String> subjects, List<Catalog.Course> courses,
                                     boolean complete, List<String> warnings) {
        var scoped = courses.stream().filter(c -> c.termCode().equals(term) && c.campus().equals(campus) && subjects.contains(c.subject())).toList();
        return new Catalog.Coverage(term, campus, subjects, scoped.size(), scoped.stream().mapToInt(c -> c.sections().size()).sum(),
            scoped.stream().flatMap(c -> c.sections().stream()).mapToInt(s -> s.instructors().isEmpty() ? 0 : 1).sum(), complete, warnings);
    }
}

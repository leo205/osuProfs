package org.osuprofs.application.service;

import org.osuprofs.application.port.out.InstructorDiscoverySource;
import org.osuprofs.domain.model.Catalog;
import java.time.Instant;
import java.util.*;

/** Joins verified current-term surname search evidence; it never promotes a historical full name. */
public final class InstructorEnrichmentService {
    private final InstructorDiscoverySource source;
    private final Options options;
    /** maxCandidates bounds each remote batch; every candidate is processed, without truncation. */
    public record Options(String subject, String catalogNumber, List<String> surnames, int maxCandidates,
                          boolean includeCatalogCandidates, String candidateSubject) {
        public Options(String subject, String catalogNumber, List<String> surnames, int maxCandidates) {
            this(subject, catalogNumber, surnames, maxCandidates, true, subject);
        }
        public Options(String subject, String catalogNumber, List<String> surnames, int maxCandidates, boolean includeCatalogCandidates) {
            this(subject, catalogNumber, surnames, maxCandidates, includeCatalogCandidates, subject);
        }
    }
    public InstructorEnrichmentService(InstructorDiscoverySource source, Options options) {
        this.source = source; this.options = options;
        if (options.maxCandidates() < 1 || options.maxCandidates() > 200)
            throw new IllegalArgumentException("Discovery batch size must be between 1 and 200");
        if (options.subject().equalsIgnoreCase("ALL") && !options.surnames().isEmpty() && options.candidateSubject().equalsIgnoreCase("ALL"))
            throw new IllegalArgumentException("Explicit surname seeds require their own candidate-subject when discovering ALL subjects");
    }

    public Catalog enrich(Catalog fresh, Catalog previous) throws Exception { return enrich(fresh, previous, null); }
    public Catalog enrich(Catalog fresh, Catalog previous, Catalog history) throws Exception {
        boolean all = options.subject().equalsIgnoreCase("ALL");
        var subjects = fresh.courses().stream().map(Catalog.Course::subject).distinct().sorted()
            .filter(subject -> all || subject.equalsIgnoreCase(options.subject())).toList();
        Catalog result = fresh;
        for (String subject : subjects) result = enrichSubject(result, previous, history, subject, all);
        return result;
    }
    private Catalog enrichSubject(Catalog fresh, Catalog previous, Catalog history, String subject, boolean all) throws Exception {
        var relevant = fresh.courses().stream().filter(c -> c.subject().equalsIgnoreCase(subject) &&
            (options.catalogNumber().isBlank() || c.catalogNumber().equals(options.catalogNumber()))).toList();
        if (relevant.stream().flatMap(c -> c.sections().stream()).noneMatch(s -> s.instructors().isEmpty())) return fresh;
        Set<String> seeds = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        var seedCatalogs = new ArrayList<Catalog>(); seedCatalogs.add(fresh);
        if (previous != null) seedCatalogs.add(previous);
        if (history != null) seedCatalogs.add(history);
        if (options.includeCatalogCandidates()) for (Catalog catalog : seedCatalogs) {
            catalog.courses().stream().filter(c -> c.subject().equalsIgnoreCase(subject))
                .flatMap(c -> c.sections().stream()).flatMap(s -> s.instructors().stream())
                .map(Catalog.Instructor::name).map(InstructorEnrichmentService::candidateSurname).filter(s -> !s.isBlank()).forEach(seeds::add);
            catalog.courses().stream().filter(c -> c.subject().equalsIgnoreCase(subject))
                .flatMap(c -> c.sections().stream()).map(Catalog.Section::instructorDiscovery).filter(Objects::nonNull)
                .flatMap(d -> d.surnames().stream()).forEach(seeds::add);
        }
        if (subject.equalsIgnoreCase(options.candidateSubject()))
            options.surnames().stream().map(String::strip).filter(s -> !s.isBlank()).forEach(seeds::add);
        if (seeds.isEmpty()) {
            if (all) return fresh;
            throw new IllegalStateException("Discovery is enabled but no surname candidates are available for " + subject);
        }
        Map<String, List<InstructorDiscoverySource.Evidence>> evidenceBySection = new HashMap<>();
        Set<String> scopes = new LinkedHashSet<>();
        relevant.stream().filter(c -> c.sections().stream().anyMatch(s -> s.instructors().isEmpty()))
            .forEach(c -> scopes.add(c.termCode() + ":" + c.campus()));
        var candidates = List.copyOf(seeds);
        for (String scope : scopes) {
            String[] parts = scope.split(":", 2);
            Set<String> expectedClasses = new HashSet<>();
            relevant.stream().filter(c -> c.termCode().equals(parts[0]) && c.campus().equals(parts[1]))
                .flatMap(c -> c.sections().stream()).forEach(s -> expectedClasses.add(s.classNumber()));
            System.getLogger(InstructorEnrichmentService.class.getName()).log(System.Logger.Level.INFO,
                "Discovering {0} / {1} / {2}: {3} surname candidates in batches of {4}",
                parts[0], parts[1], subject, seeds.size(), options.maxCandidates());
            for (int start = 0; start < candidates.size(); start += options.maxCandidates()) {
                var batch = candidates.subList(start, Math.min(start + options.maxCandidates(), candidates.size()));
                var query = new InstructorDiscoverySource.Query(parts[0], parts[1], subject, options.catalogNumber(), batch);
                for (var evidence : source.discover(query)) {
                    if (!evidence.termCode().equals(parts[0]) || batch.stream().noneMatch(s -> s.equalsIgnoreCase(evidence.surname())) || !expectedClasses.contains(evidence.classNumber()))
                        throw new IllegalStateException("Discovery evidence does not match the requested term, class scope, or surname");
                    Instant.parse(evidence.checkedAt());
                    evidenceBySection.computeIfAbsent(scope + ":" + evidence.classNumber(), ignored -> new ArrayList<>()).add(evidence);
                }
            }
        }
        Set<String> relevantCourseIds = new HashSet<>(relevant.stream().map(Catalog.Course::id).toList());
        var courses = fresh.courses().stream().map(c -> {
            if (!relevantCourseIds.contains(c.id()) || !scopes.contains(c.termCode() + ":" + c.campus())) return c;
            var sections = c.sections().stream().map(section -> {
                var matches = evidenceBySection.get(c.termCode() + ":" + c.campus() + ":" + section.classNumber());
                if (!section.instructors().isEmpty()) return section;
                var surnames = new TreeSet<String>(String.CASE_INSENSITIVE_ORDER);
                var cached = section.instructorDiscovery();
                if (cached != null) cached.surnames().stream().filter(surname -> !seeds.contains(surname)).forEach(surnames::add);
                String sourceUrl = surnames.isEmpty() ? null : cached.sourceUrl();
                String checkedAt = surnames.isEmpty() ? null : cached.checkedAt();
                if (matches != null) for (var match : matches) {
                    surnames.add(match.surname()); sourceUrl = match.sourceUrl();
                    if (checkedAt == null || Instant.parse(match.checkedAt()).isBefore(Instant.parse(checkedAt))) checkedAt = match.checkedAt();
                }
                var cachedIdentities = cached == null || cached.fullNameMatches() == null ? null : cached.fullNameMatches().stream()
                    .filter(identity -> surnames.contains(identity.surname())).toList();
                var discovery = surnames.isEmpty() ? null : new Catalog.InstructorDiscovery(surnames.size() == 1 ? "SURNAME_MATCH" : "AMBIGUOUS",
                    List.copyOf(surnames), sourceUrl, checkedAt, "PEOPLESOFT_EXACT_LAST_NAME", cachedIdentities);
                return new Catalog.Section(section.id(), section.classNumber(), section.section(), section.component(), section.instructionMode(),
                    section.instructors(), section.meetings(), section.enrollment(), section.sourceUrl(), section.lastUpdated(), discovery, section.details());
            }).toList();
            return new Catalog.Course(c.id(), c.termCode(), c.campus(), c.subject(), c.catalogNumber(), c.title(), c.description(),
                c.credits(), c.career(), c.prerequisites(), c.attributes(), sections);
        }).toList();
        return new Catalog(fresh.schemaVersion(), fresh.generatedAt(), fresh.source(), fresh.terms(), fresh.subjects(), fresh.campuses(), fresh.coverage(), courses);
    }

    static String candidateSurname(String name) {
        String cleaned = name.strip().replaceAll("(?i),?\\s+(Jr|Sr|II|III|IV)\\.?$", "");
        if (cleaned.contains(",")) return cleaned.substring(0, cleaned.indexOf(',')).strip();
        String[] words = cleaned.split("\\s+");
        return words.length == 0 ? "" : words[words.length - 1];
    }
}

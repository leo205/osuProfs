package org.osuprofs.application.service;

import org.osuprofs.application.port.out.InstructorIdentityRegistry;
import org.osuprofs.domain.model.Catalog;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.*;

/** Resolves qualified names from public records; it never turns an inferred identity into a published assignment. */
public final class InstructorIdentityResolutionService {
    private static final String PUBLIC_RECORDS = "https://content.osu.edu/v2/classes/search";
    private final InstructorIdentityRegistry registry;
    private final String defaultSubject;
    public InstructorIdentityResolutionService(InstructorIdentityRegistry registry) { this(registry, "CSE"); }
    public InstructorIdentityResolutionService(InstructorIdentityRegistry registry, String defaultSubject) {
        this.registry = registry; this.defaultSubject = defaultSubject;
    }

    public Catalog resolve(Catalog catalog) throws Exception {
        var reviewed = registry.load();
        if (!reviewed.subject().isBlank() && reviewed.identities().isEmpty())
            throw new IllegalStateException("Configured instructor identity registry has no reviewed identities");
        String subject = reviewed.subject().isBlank() ? defaultSubject : reviewed.subject();
        Map<String, Candidate> candidates = catalogCandidates(catalog, subject);
        // Cached reviewed metadata remains portable when an import omits the optional registry.
        catalog.courses().stream().filter(c -> c.subject().equalsIgnoreCase(subject)).flatMap(c -> c.sections().stream())
            .map(Catalog.Section::instructorDiscovery).filter(Objects::nonNull).map(Catalog.InstructorDiscovery::fullNameMatches)
            .filter(Objects::nonNull).flatMap(List::stream).forEach(identity -> overlay(candidates, identity));
        for (var identity : reviewed.identities()) {
            Candidate candidate = overlay(candidates, identity);
            for (String number : reviewed.courseAffinities().getOrDefault(identity.id(), List.of()))
                candidate.observed.computeIfAbsent(number, ignored -> new LinkedHashSet<>()).addAll(identity.sourceUrls());
        }
        Map<String, List<Candidate>> bySurname = new HashMap<>();
        candidates.values().forEach(candidate -> bySurname.computeIfAbsent(normalize(candidate.identity.surname()), ignored -> new ArrayList<>()).add(candidate));

        var courses = catalog.courses().stream().map(course -> {
            if (!course.subject().equalsIgnoreCase(subject)) return course;
            var sections = course.sections().stream().map(section -> {
                var discovery = section.instructorDiscovery();
                if (discovery == null || !section.instructors().isEmpty()) return section;
                Map<String, Catalog.InstructorIdentityMatch> selected = new TreeMap<>();
                for (String surname : discovery.surnames()) {
                    var matching = bySurname.getOrDefault(normalize(surname), List.of());
                    int bestTier = matching.stream().mapToInt(c -> c.tier(course.catalogNumber())).min().orElse(2);
                    matching.stream().filter(candidate -> candidate.tier(course.catalogNumber()) == bestTier)
                        .forEach(candidate -> selected.putIfAbsent(candidate.identity.id(), candidate.forCourse(course.catalogNumber(), bestTier)));
                }
                var resolved = new Catalog.InstructorDiscovery(discovery.status(), discovery.surnames(), discovery.sourceUrl(),
                    discovery.checkedAt(), discovery.method(), List.copyOf(selected.values()));
                return new Catalog.Section(section.id(), section.classNumber(), section.section(), section.component(), section.instructionMode(),
                    section.instructors(), section.meetings(), section.enrollment(), section.sourceUrl(), section.lastUpdated(), resolved);
            }).toList();
            return new Catalog.Course(course.id(), course.termCode(), course.campus(), course.subject(), course.catalogNumber(), course.title(),
                course.description(), course.credits(), course.career(), course.prerequisites(), course.attributes(), sections);
        }).toList();
        return new Catalog(catalog.schemaVersion(), catalog.generatedAt(), catalog.source(), catalog.terms(), catalog.subjects(), catalog.campuses(), catalog.coverage(), courses);
    }

    private Map<String, Candidate> catalogCandidates(Catalog catalog, String subject) {
        Map<String, Candidate> result = new LinkedHashMap<>();
        var newestFirst = catalog.courses().stream().filter(c -> c.subject().equalsIgnoreCase(subject))
            .sorted(Comparator.comparing(Catalog.Course::termCode).reversed().thenComparing(Catalog.Course::id)).toList();
        for (var course : newestFirst) for (var section : course.sections()) for (var instructor : section.instructors()) {
            if (instructor.name() == null || instructor.name().isBlank()) continue;
            String surname = InstructorEnrichmentService.candidateSurname(instructor.name());
            if (surname.isBlank()) continue;
            String record = PUBLIC_RECORDS + "?term=" + encode(course.termCode()) + "&campus=" + encode(course.campus()) +
                "&subject=" + encode(course.subject().toLowerCase(Locale.ROOT)) + "&q=" + encode(section.classNumber());
            var identity = new Catalog.InstructorIdentityMatch(instructor.id(), instructor.name(), surname, record, null,
                List.of(record), "LIKELY", section.lastUpdated());
            var candidate = result.computeIfAbsent(instructor.id(), ignored -> new Candidate(identity));
            candidate.observed.computeIfAbsent(course.catalogNumber(), ignored -> new LinkedHashSet<>()).add(record);
        }
        return result;
    }

    private Candidate overlay(Map<String, Candidate> candidates, Catalog.InstructorIdentityMatch reviewed) {
        if (!"LIKELY".equals(reviewed.confidence())) throw new IllegalStateException("Reviewed identities must explicitly use LIKELY confidence");
        Candidate existing = candidates.get(reviewed.id());
        if (existing == null) {
            // Directory IDs may differ from the feed. An exact, unique full-name match can also correct a compound surname.
            var sameName = candidates.values().stream().filter(c -> normalize(c.identity.name()).equals(normalize(reviewed.name()))).toList();
            if (sameName.size() == 1) existing = sameName.getFirst();
        }
        if (existing == null) {
            existing = new Candidate(reviewed); candidates.put(reviewed.id(), existing);
        } else {
            Set<String> sources = new LinkedHashSet<>(reviewed.sourceUrls()); sources.addAll(existing.identity.sourceUrls());
            existing.identity = new Catalog.InstructorIdentityMatch(existing.identity.id(), reviewed.name(), reviewed.surname(), reviewed.profileUrl(),
                reviewed.rateMyProfessorsUrl(), List.copyOf(sources), "LIKELY", reviewed.checkedAt());
        }
        return existing;
    }

    private String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
    private static String normalize(String value) {
        return Normalizer.normalize(value, Normalizer.Form.NFD).replaceAll("\\p{M}+", "").strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
    }
    private static boolean numberFamily(String left, String right) {
        return left.matches("\\d{4}") && right.matches("\\d{4}") && Math.abs(Integer.parseInt(left) - Integer.parseInt(right)) == 2000;
    }
    private static final class Candidate {
        Catalog.InstructorIdentityMatch identity;
        // Published records or reviewed external course proof add observations; a cached LIKELY match cannot reinforce itself.
        final Map<String, Set<String>> observed = new LinkedHashMap<>();
        Candidate(Catalog.InstructorIdentityMatch identity) { this.identity = identity; }
        int tier(String number) {
            if (observed.containsKey(number)) return 0;
            if (observed.keySet().stream().anyMatch(previous -> numberFamily(previous, number))) return 1;
            return 2;
        }
        Catalog.InstructorIdentityMatch forCourse(String number, int tier) {
            Set<String> sources = new LinkedHashSet<>(identity.sourceUrls());
            observed.forEach((previous, records) -> {
                if (tier == 2 || previous.equals(number) || tier == 1 && numberFamily(previous, number)) sources.addAll(records);
            });
            return new Catalog.InstructorIdentityMatch(identity.id(), identity.name(), identity.surname(), identity.profileUrl(),
                identity.rateMyProfessorsUrl(), List.copyOf(sources), "LIKELY", identity.checkedAt());
        }
    }
}

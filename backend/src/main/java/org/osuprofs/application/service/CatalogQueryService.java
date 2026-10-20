package org.osuprofs.application.service;

import org.osuprofs.application.port.in.QueryCatalog;
import org.osuprofs.domain.model.Catalog;
import java.util.*;

public final class CatalogQueryService implements QueryCatalog {
    private final Catalog catalog;
    public CatalogQueryService(Catalog catalog) { this.catalog = catalog; }
    @Override public Catalog snapshot() { return catalog; }
    @Override public Page<Catalog.Course> search(Search p) {
        if (p.page() < 0 || p.size() < 1 || p.size() > 100)
            throw new IllegalArgumentException("page must be >= 0 and size must be between 1 and 100");
        var matches = catalog.courses().stream().filter(c ->
            (p.term().isBlank() || c.termCode().equals(p.term())) &&
            (p.subject().isBlank() || c.subject().equalsIgnoreCase(p.subject())) &&
            (p.number().isBlank() || c.catalogNumber().equalsIgnoreCase(p.number())) &&
            (p.campus().isBlank() || c.campus().equalsIgnoreCase(p.campus())) &&
            (p.instructor().isBlank() || names(c).stream().anyMatch(i -> contains(i.name(), p.instructor())) || discoveryMatches(c, p.instructor())) &&
            (p.query().isBlank() || contains(c.title(), p.query()) ||
                contains(c.subject() + c.catalogNumber(), p.query().replace(" ", "")) ||
                names(c).stream().anyMatch(i -> contains(i.name(), p.query())) || discoveryMatches(c, p.query()))).toList();
        int start = (int)Math.min((long)p.page() * p.size(), matches.size());
        return new Page<>(matches.subList(start, Math.min(start + p.size(), matches.size())), matches.size(), p.page(),
            p.size(), (matches.size() + p.size() - 1) / p.size());
    }
    @Override public Optional<Catalog.Course> course(String id) { return catalog.courses().stream().filter(c -> c.id().equals(id)).findFirst(); }
    @Override public List<Catalog.Instructor> instructors(String query) {
        Map<String, Catalog.Instructor> unique = new TreeMap<>();
        catalog.courses().forEach(c -> names(c).stream().filter(i -> contains(i.name(), query)).forEach(i -> unique.putIfAbsent(i.id(), i)));
        return List.copyOf(unique.values());
    }
    private boolean discoveryMatches(Catalog.Course c, String query) {
        return c.sections().stream().map(Catalog.Section::instructorDiscovery).filter(Objects::nonNull)
            .anyMatch(discovery -> discovery.surnames().stream().anyMatch(surname -> contains(surname, query)) ||
                discovery.fullNameMatches() != null && discovery.fullNameMatches().stream().anyMatch(identity -> contains(identity.name(), query)));
    }
    private List<Catalog.Instructor> names(Catalog.Course c) { return c.sections().stream().flatMap(s -> s.instructors().stream()).toList(); }
    private boolean contains(String value, String query) { return value != null && value.toLowerCase(Locale.ROOT).contains(query.toLowerCase(Locale.ROOT)); }
}

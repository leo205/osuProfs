package org.osuprofs.adapter.out.file;

import org.osuprofs.application.port.out.InstructorIdentityRegistry;
import org.osuprofs.domain.model.Catalog;
import tools.jackson.databind.json.JsonMapper;
import java.net.URI;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;

/** Reads a reviewed, versioned registry. Historical or directory names alone do not verify an assignment. */
public final class FileInstructorIdentityRegistry implements InstructorIdentityRegistry {
    private final JsonMapper mapper;
    private final String path;
    public FileInstructorIdentityRegistry(JsonMapper mapper, String path) { this.mapper = mapper; this.path = path; }
    private record RegistryFile(int schemaVersion, String subject, List<Catalog.InstructorIdentityMatch> identities,
                                Map<String, List<String>> courseAffinities) {}
    @Override public Registry load() throws Exception {
        if (path.isBlank()) return new Registry("", List.of());
        var file = mapper.readValue(Files.readString(Path.of(path)), RegistryFile.class);
        if (file.schemaVersion() != 1 || file.subject() == null || !file.subject().matches("[A-Z0-9&_-]{1,15}") || file.identities() == null || file.identities().isEmpty())
            throw new IllegalArgumentException("Invalid reviewed instructor identity registry");
        Set<String> ids = new HashSet<>();
        for (var identity : file.identities()) {
            if (identity.id() == null || identity.id().isBlank() || !ids.add(identity.id()) || identity.name() == null || identity.name().isBlank() ||
                identity.surname() == null || identity.surname().isBlank() || !"LIKELY".equals(identity.confidence()) ||
                identity.sourceUrls() == null || identity.sourceUrls().isEmpty())
                throw new IllegalArgumentException("Identity registry requires unique reviewed names, surnames, sources, and LIKELY confidence");
            Instant.parse(identity.checkedAt());
            requireOfficial(identity.profileUrl());
            for (String source : identity.sourceUrls()) requireOfficial(source);
            if (identity.rateMyProfessorsUrl() != null && !"www.ratemyprofessors.com".equalsIgnoreCase(requireHttps(identity.rateMyProfessorsUrl())))
                throw new IllegalArgumentException("Reviewed rating links must point to www.ratemyprofessors.com");
        }
        Map<String, List<String>> affinities = new LinkedHashMap<>();
        if (file.courseAffinities() != null) for (var entry : file.courseAffinities().entrySet()) {
            if (!ids.contains(entry.getKey()) || entry.getValue() == null || entry.getValue().isEmpty() ||
                entry.getValue().stream().anyMatch(number -> number == null || !number.matches("[0-9]{4}(?:\\.[0-9]+)?[A-Z]*")))
                throw new IllegalArgumentException("Reviewed course affinities require a known identity ID and catalog numbers");
            affinities.put(entry.getKey(), List.copyOf(entry.getValue()));
        }
        return new Registry(file.subject(), List.copyOf(file.identities()), Map.copyOf(affinities));
    }
    private void requireOfficial(String value) {
        String host = requireHttps(value).toLowerCase(Locale.ROOT);
        if (!(host.equals("osu.edu") || host.endsWith(".osu.edu") || host.equals("ohio-state.edu") || host.endsWith(".ohio-state.edu")))
            throw new IllegalArgumentException("Reviewed identity profiles and sources must be official OSU HTTPS URLs");
    }
    private String requireHttps(String value) {
        if (value == null) throw new IllegalArgumentException("Reviewed identity URLs must be HTTPS URLs");
        URI uri = URI.create(value);
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null) throw new IllegalArgumentException("Reviewed identity URLs must be HTTPS URLs");
        return uri.getHost();
    }
}

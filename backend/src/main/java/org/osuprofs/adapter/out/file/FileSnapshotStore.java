package org.osuprofs.adapter.out.file;

import org.osuprofs.application.port.out.SnapshotStore;
import org.osuprofs.domain.model.Catalog;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import java.nio.file.*;
import java.util.*;

/** Write in the destination directory then rename, so failed imports cannot truncate the published file. */
public final class FileSnapshotStore implements SnapshotStore {
    private final JsonMapper mapper;
    public FileSnapshotStore(JsonMapper mapper) { this.mapper = mapper; }
    @Override public Optional<Catalog> read(String path) throws Exception {
        Path file = Path.of(path);
        if (!Files.isRegularFile(file) && file.getFileName().toString().equals("catalog-index.json"))
            file = file.resolveSibling("catalog.json");
        if (!Files.isRegularFile(file)) return Optional.empty();
        JsonNode json = mapper.readTree(Files.readString(file));
        return Optional.of(json.has("catalogs") ? readManifest(file, json) : readCatalog(json, path));
    }
    private Catalog readCatalog(JsonNode json, String path) {
        Catalog catalog = mapper.treeToValue(json, Catalog.class);
        if (catalog.schemaVersion() != 1 || catalog.courses() == null || catalog.coverage() == null)
            throw new IllegalStateException("Unsupported or malformed catalog snapshot: " + path);
        return catalog;
    }
    private Catalog readManifest(Path manifest, JsonNode json) throws Exception {
        if (json.path("schemaVersion").asInt() != 1 || !json.path("catalogs").isArray() || json.path("catalogs").isEmpty()
                || !json.path("generatedAt").isString())
            throw new IllegalStateException("Unsupported or malformed catalog manifest: " + manifest);
        java.time.Instant.parse(json.path("generatedAt").asText());
        Path root = manifest.toAbsolutePath().getParent().toRealPath();
        List<Catalog.Course> courses = new ArrayList<>();
        List<Catalog.Coverage> coverage = new ArrayList<>();
        Map<String, Catalog.Option> terms = new TreeMap<>(), subjects = new TreeMap<>(), campuses = new TreeMap<>();
        Set<String> scopes = new HashSet<>(), courseIds = new HashSet<>();
        Catalog.Source source = null;
        for (JsonNode entry : json.path("catalogs")) {
            String url = entry.path("url").asText();
            if (!url.matches("/data/catalogs/[A-Za-z0-9._-]+\\.json"))
                throw new IllegalStateException("Catalog manifest has an invalid local shard URL");
            Path shardPath = root.resolve(url.substring("/data/".length())).normalize();
            if (!shardPath.startsWith(root) || !Files.isRegularFile(shardPath) || !shardPath.toRealPath().startsWith(root))
                throw new IllegalStateException("Catalog manifest shard is missing or outside the data directory: " + url);
            Catalog shard = readCatalog(mapper.readTree(Files.readString(shardPath)), shardPath.toString());
            String term = entry.path("termCode").asText(), campus = entry.path("campus").asText();
            Set<String> expectedSubjects = new TreeSet<>();
            if (!entry.path("subjects").isArray() || entry.path("subjects").isEmpty())
                throw new IllegalStateException("Catalog manifest shard has no subjects");
            for (JsonNode subject : entry.path("subjects")) {
                if (!subject.isString() || !expectedSubjects.add(subject.asText()) || !scopes.add(term + ":" + campus + ":" + subject.asText()))
                    throw new IllegalStateException("Catalog manifest repeats a subject scope");
            }
            if (shard.courses().size() != entry.path("courseCount").asInt(-1)
                    || shard.courses().stream().mapToInt(c -> c.sections().size()).sum() != entry.path("sectionCount").asInt(-1)
                    || shard.courses().stream().anyMatch(c -> !c.termCode().equals(term) || !c.campus().equals(campus) || !expectedSubjects.contains(c.subject()))
                    || shard.coverage().stream().anyMatch(c -> !c.complete() || !c.termCode().equals(term) || !c.campus().equals(campus)
                        || !expectedSubjects.containsAll(c.subjects())))
                throw new IllegalStateException("Catalog manifest shard does not match its declared scope or counts: " + url);
            Set<String> actualSubjects = new TreeSet<>();
            shard.coverage().forEach(c -> actualSubjects.addAll(c.subjects()));
            if (!actualSubjects.equals(expectedSubjects)) throw new IllegalStateException("Catalog manifest shard coverage is incomplete: " + url);
            for (Catalog.Course course : shard.courses()) {
                if (!courseIds.add(course.id())) throw new IllegalStateException("Catalog manifest repeats a course ID");
                courses.add(course);
            }
            coverage.addAll(shard.coverage());
            shard.terms().forEach(option -> terms.put(option.code(), option));
            shard.subjects().forEach(option -> subjects.put(option.code(), option));
            shard.campuses().forEach(option -> campuses.put(option.code(), option));
            if (source == null) source = shard.source();
        }
        return new Catalog(1, json.path("generatedAt").asText(), source, List.copyOf(terms.values()), List.copyOf(subjects.values()),
            List.copyOf(campuses.values()), coverage, courses);
    }
    @Override public void write(String path, Catalog catalog) throws Exception {
        Path destination = Path.of(path).toAbsolutePath();
        Files.createDirectories(destination.getParent());
        Path temp = Files.createTempFile(destination.getParent(), ".catalog-", ".tmp");
        try {
            Files.writeString(temp, mapper.writeValueAsString(catalog));
            Files.move(temp, destination, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(temp); }
    }
}

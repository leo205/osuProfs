package org.osuprofs.adapter.out.file;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Optional public professional-name seeds; a candidate alone is never assignment evidence. */
public final class DiscoveryCandidateFile {
    private final JsonMapper mapper;
    public DiscoveryCandidateFile(JsonMapper mapper) { this.mapper = mapper; }
    public List<String> read(String path) throws Exception {
        if (path.isBlank()) return List.of();
        String content = Files.readString(Path.of(path));
        if (path.endsWith(".txt")) {
            var surnames = content.lines().map(String::strip).filter(line -> !line.isBlank() && !line.startsWith("#")).toList();
            if (surnames.isEmpty()) throw new IllegalArgumentException("Discovery candidate file contains no surnames");
            return surnames;
        }
        JsonNode json = mapper.readTree(content);
        if (!json.isArray()) throw new IllegalArgumentException("Discovery candidate file must contain an array");
        List<String> surnames = new ArrayList<>();
        for (JsonNode item : json) {
            JsonNode surname = item.isString() ? item : item.path("surname");
            if (!surname.isString() || surname.asText().isBlank())
                throw new IllegalArgumentException("Each discovery candidate must be a surname string or have a surname field");
            surnames.add(surname.asText().strip());
        }
        if (surnames.isEmpty()) throw new IllegalArgumentException("Discovery candidate file contains no surnames");
        return surnames;
    }
}

package org.osuprofs.adapter.out.file;

import org.osuprofs.application.port.out.SnapshotStore;
import org.osuprofs.domain.model.Catalog;
import tools.jackson.databind.json.JsonMapper;
import java.nio.file.*;
import java.util.Optional;

/** Write in the destination directory then rename, so failed imports cannot truncate the published file. */
public final class FileSnapshotStore implements SnapshotStore {
    private final JsonMapper mapper;
    public FileSnapshotStore(JsonMapper mapper) { this.mapper = mapper; }
    @Override public Optional<Catalog> read(String path) throws Exception {
        Path file = Path.of(path);
        if (!Files.isRegularFile(file)) return Optional.empty();
        Catalog catalog = mapper.readValue(Files.readString(file), Catalog.class);
        if (catalog.schemaVersion() != 1 || catalog.courses() == null || catalog.coverage() == null)
            throw new IllegalStateException("Unsupported or malformed catalog snapshot: " + path);
        return Optional.of(catalog);
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

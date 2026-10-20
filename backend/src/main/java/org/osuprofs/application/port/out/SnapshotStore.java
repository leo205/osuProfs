package org.osuprofs.application.port.out;

import org.osuprofs.domain.model.Catalog;
import java.util.Optional;

public interface SnapshotStore {
    Optional<Catalog> read(String path) throws Exception;
    void write(String path, Catalog catalog) throws Exception;
}

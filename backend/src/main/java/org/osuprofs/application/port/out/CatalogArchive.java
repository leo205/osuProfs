package org.osuprofs.application.port.out;

/** Optional PostgreSQL history port; JSON serialization belongs to the adapter. */
public interface CatalogArchive {
    org.osuprofs.domain.model.Catalog latest();
    void save(org.osuprofs.domain.model.Catalog catalog);
}

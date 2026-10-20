package org.osuprofs.adapter.out.persistence;

import org.osuprofs.application.port.out.CatalogArchive;
import org.osuprofs.domain.model.Catalog;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
@Profile("postgres")
public class PostgresCatalogArchive implements CatalogArchive {
    private final CatalogSnapshotRepository repository;
    private final JsonMapper mapper;
    public PostgresCatalogArchive(CatalogSnapshotRepository repository, JsonMapper mapper) {
        this.repository = repository; this.mapper = mapper;
    }
    @Override @Transactional(readOnly=true) public Catalog latest() {
        return repository.findFirstByOrderByImportedAtDesc().map(s -> mapper.readValue(s.getPayload(), Catalog.class)).orElse(null);
    }
    @Override @Transactional public void save(Catalog catalog) {
        repository.save(new CatalogSnapshot(mapper.writeValueAsString(catalog)));
    }
}

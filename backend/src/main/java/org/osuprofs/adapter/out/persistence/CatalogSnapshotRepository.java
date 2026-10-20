package org.osuprofs.adapter.out.persistence;

import org.springframework.context.annotation.Profile;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

@Profile("postgres")
public interface CatalogSnapshotRepository extends JpaRepository<CatalogSnapshot, Long> {
    Optional<CatalogSnapshot> findFirstByOrderByImportedAtDesc();
}

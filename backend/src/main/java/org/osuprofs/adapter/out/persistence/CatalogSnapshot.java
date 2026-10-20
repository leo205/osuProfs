package org.osuprofs.adapter.out.persistence;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name="catalog_snapshots")
public class CatalogSnapshot {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
    @Column(name="imported_at", nullable=false) private Instant importedAt;
    @Column(nullable=false, columnDefinition="text") private String payload;
    protected CatalogSnapshot() {}
    public CatalogSnapshot(String payload) { this.payload = payload; this.importedAt = Instant.now(); }
    public String getPayload() { return payload; }
}

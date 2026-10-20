package org.osuprofs.application.port.out;

import org.osuprofs.domain.model.Catalog;
import java.util.List;
import java.util.Map;

/** Reviewed professional identity candidates, separate from section-assignment evidence. */
public interface InstructorIdentityRegistry {
    Registry load() throws Exception;
    record Registry(String subject, List<Catalog.InstructorIdentityMatch> identities, Map<String, List<String>> courseAffinities) {
        public Registry(String subject, List<Catalog.InstructorIdentityMatch> identities) { this(subject, identities, Map.of()); }
    }
}

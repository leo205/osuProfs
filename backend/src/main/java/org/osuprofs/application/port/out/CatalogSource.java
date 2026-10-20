package org.osuprofs.application.port.out;

import org.osuprofs.domain.model.Catalog;
import java.util.List;

public interface CatalogSource {
    Catalog fetch(String term, String campus, List<String> subjects) throws Exception;
    /** Authoritative subject options, including subjects without offerings in the selected term. */
    default List<String> subjects(String term, String campus) throws Exception {
        throw new UnsupportedOperationException("This catalog source does not support ALL subject discovery");
    }
}

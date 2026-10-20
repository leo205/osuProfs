package org.osuprofs.application.port.out;

import org.osuprofs.domain.model.Catalog;
import java.util.List;

public interface CatalogSource {
    Catalog fetch(String term, String campus, List<String> subjects) throws Exception;
}

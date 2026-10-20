package org.osuprofs.application.port.in;

import org.osuprofs.domain.model.Catalog;
import java.util.List;

public interface ImportCatalog {
    Catalog run(Request request) throws Exception;
    record Request(String term, String campus, List<String> subjects, String output, double maxDropFraction, boolean allowLargeDrop) {}
}

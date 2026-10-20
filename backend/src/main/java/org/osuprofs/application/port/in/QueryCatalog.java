package org.osuprofs.application.port.in;

import org.osuprofs.domain.model.Catalog;
import java.util.List;
import java.util.Optional;

public interface QueryCatalog {
    Catalog snapshot();
    Page<Catalog.Course> search(Search search);
    Optional<Catalog.Course> course(String id);
    List<Catalog.Instructor> instructors(String query);
    record Search(String query, String term, String subject, String number, String instructor, String campus, int page, int size) {}
    record Page<T>(List<T> items, int total, int page, int size, int totalPages) {}
}

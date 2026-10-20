package org.osuprofs.adapter.in.web;

import org.osuprofs.application.port.in.QueryCatalog;
import org.osuprofs.domain.model.Catalog;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import java.time.Duration;
import java.util.*;

@RestController
@RequestMapping("/api")
public class CatalogController {
    private final QueryCatalog catalog;
    public CatalogController(QueryCatalog catalog) { this.catalog = catalog; }
    @GetMapping("/catalog")
    public ResponseEntity<Catalog> catalog() {
        Catalog snapshot = catalog.snapshot();
        return ResponseEntity.ok().cacheControl(CacheControl.maxAge(Duration.ofMinutes(5)))
            .eTag('"' + Objects.toString(snapshot.generatedAt(), "empty") + '"').body(snapshot);
    }
    @GetMapping({"/health", "/status"}) public Map<String, Object> status() {
        Catalog c = catalog.snapshot();
        Map<String, Object> status = new LinkedHashMap<>();
        status.put("status", "UP"); status.put("dataAvailable", !c.courses().isEmpty());
        status.put("generatedAt", c.generatedAt()); status.put("courseCount", c.courses().size());
        status.put("sectionCount", c.courses().stream().mapToInt(x -> x.sections().size()).sum());
        status.put("coverage", c.coverage()); return status;
    }
    @GetMapping("/terms") public List<Catalog.Option> terms() { return catalog.snapshot().terms(); }
    @GetMapping("/subjects") public List<Catalog.Option> subjects() { return catalog.snapshot().subjects(); }
    @GetMapping("/campuses") public List<Catalog.Option> campuses() { return catalog.snapshot().campuses(); }
    @GetMapping("/courses") public QueryCatalog.Page<Catalog.Course> courses(
        @RequestParam(defaultValue="") String q, @RequestParam(defaultValue="") String term,
        @RequestParam(defaultValue="") String subject, @RequestParam(defaultValue="") String number,
        @RequestParam(defaultValue="") String instructor, @RequestParam(defaultValue="") String campus,
        @RequestParam(defaultValue="0") int page, @RequestParam(defaultValue="25") int size) {
        try { return catalog.search(new QueryCatalog.Search(q, term, subject, number, instructor, campus, page, size)); }
        catch (IllegalArgumentException e) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage()); }
    }
    @GetMapping("/courses/{id}") public Catalog.Course course(@PathVariable String id) {
        return catalog.course(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Course not found"));
    }
    @GetMapping("/instructors") public List<Catalog.Instructor> instructors(@RequestParam(defaultValue="") String q) {
        return catalog.instructors(q);
    }
}

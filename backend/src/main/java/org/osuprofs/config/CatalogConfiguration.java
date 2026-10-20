package org.osuprofs.config;

import org.osuprofs.domain.model.Catalog;
import org.osuprofs.application.port.in.*;
import org.osuprofs.application.port.out.*;
import org.osuprofs.application.service.*;
import org.osuprofs.adapter.out.file.FileSnapshotStore;
import org.osuprofs.adapter.out.file.DiscoveryCandidateFile;
import org.osuprofs.adapter.out.file.FileInstructorIdentityRegistry;
import org.osuprofs.adapter.out.osu.PeopleSoftInstructorDiscoveryAdapter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.osuprofs.adapter.out.osu.OsuCatalogClient;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import tools.jackson.databind.json.JsonMapper;
import java.util.List;

/** Composition root: the application and domain packages contain no framework code. */
@Configuration
public class CatalogConfiguration {
    @Bean JsonMapper catalogJsonMapper() { return JsonMapper.builder().build(); }
    @Bean SnapshotStore snapshotStore(JsonMapper mapper) { return new FileSnapshotStore(mapper); }
    @Bean CatalogSource catalogSource(JsonMapper mapper,
        @Value("${app.import.base-url}") String baseUrl, @Value("${app.import.timeout-seconds}") int timeout,
        @Value("${app.import.max-pages}") int pages, @Value("${app.import.delay-ms}") long delay) {
        return new OsuCatalogClient(mapper, baseUrl, timeout, pages, delay);
    }
    @Bean ImportCatalog importCatalog(CatalogSource source, SnapshotStore store, ObjectProvider<CatalogArchive> archive,
                                     ObjectProvider<InstructorEnrichmentService> enrichment, InstructorIdentityResolutionService identityResolution) {
        return new CatalogImportService(source, store, archive.getIfAvailable(), enrichment.getIfAvailable(), identityResolution);
    }
    @Bean InstructorIdentityRegistry instructorIdentityRegistry(JsonMapper mapper, @Value("${app.discovery.identity-file:}") String path) {
        return new FileInstructorIdentityRegistry(mapper, path);
    }
    @Bean InstructorIdentityResolutionService instructorIdentityResolutionService(InstructorIdentityRegistry registry,
        @Value("${app.discovery.subject:CSE}") String subject) {
        return new InstructorIdentityResolutionService(registry, subject.toUpperCase(java.util.Locale.ROOT));
    }
    @Bean @ConditionalOnProperty(name="app.discovery.enabled", havingValue="true")
    InstructorDiscoverySource instructorDiscoverySource() { return new PeopleSoftInstructorDiscoveryAdapter(); }
    @Bean @ConditionalOnProperty(name="app.discovery.enabled", havingValue="true")
    InstructorEnrichmentService instructorEnrichmentService(InstructorDiscoverySource source, JsonMapper mapper,
        @Value("${app.discovery.subject:CSE}") String subject,
        @Value("${app.discovery.catalog-number:}") String catalogNumber,
        @Value("${app.discovery.surnames:}") String surnameList,
        @Value("${app.discovery.candidate-file:}") String candidateFile,
        @Value("${app.discovery.max-candidates:200}") int maxCandidates,
        @Value("${app.discovery.include-catalog-candidates:true}") boolean includeCatalog) throws Exception {
        var surnames = new java.util.ArrayList<>(new DiscoveryCandidateFile(mapper).read(candidateFile));
        java.util.Arrays.stream(surnameList.split(",")).map(String::strip).filter(s -> !s.isBlank()).forEach(surnames::add);
        return new InstructorEnrichmentService(source, new InstructorEnrichmentService.Options(subject.toUpperCase(java.util.Locale.ROOT),
            catalogNumber, surnames, maxCandidates, includeCatalog));
    }
    @Bean QueryCatalog queryCatalog(SnapshotStore store, ObjectProvider<CatalogArchive> archive,
                                    @Value("${app.catalog.path}") String path) throws Exception {
        CatalogArchive db = archive.getIfAvailable();
        Catalog catalog = db == null ? null : db.latest();
        if (catalog == null) catalog = store.read(path).orElseGet(() -> new Catalog(1, null,
            new Catalog.Source("Ohio State Class Search", "https://classes.osu.edu/", "https://content.osu.edu/v2/classes/search"),
            List.of(), List.of(), List.of(), List.of(), List.of()));
        return new CatalogQueryService(catalog);
    }
    @Bean WebMvcConfigurer corsConfigurer(@Value("${app.cors.origins}") String origins) {
        return new WebMvcConfigurer() {
            @Override public void addCorsMappings(CorsRegistry registry) {
                registry.addMapping("/api/**").allowedOrigins(java.util.Arrays.stream(origins.split(",")).map(String::strip).filter(s -> !s.isEmpty()).toArray(String[]::new))
                    .allowedMethods("GET").maxAge(3600);
            }
        };
    }
}

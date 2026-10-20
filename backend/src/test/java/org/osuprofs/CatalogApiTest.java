package org.osuprofs;

import org.junit.jupiter.api.Test;
import org.osuprofs.adapter.out.file.FileSnapshotStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.json.JsonMapper;
import java.net.URI;
import java.net.http.*;
import java.nio.file.Files;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {"debug=false", "logging.level.org.springframework=WARN"})
class CatalogApiTest {
    @Value("${local.server.port}") int port;
    private final HttpClient http = HttpClient.newHttpClient();
    private final JsonMapper mapper = JsonMapper.builder().build();
    @DynamicPropertySource static void fixture(DynamicPropertyRegistry registry) throws Exception {
        var path = Files.createTempFile("osuprofs-api-test-", ".json"); path.toFile().deleteOnExit();
        new FileSnapshotStore(JsonMapper.builder().build()).write(path.toString(), CatalogFixtures.snapshot("1272", "CSE", 2));
        registry.add("app.catalog.path", path::toString);
    }
    private HttpResponse<String> get(String path) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET().build(), HttpResponse.BodyHandlers.ofString());
    }
    @Test void servesCanonicalCatalogAndFreshnessMetadataWithoutDatabase() throws Exception {
        var response = get("/api/catalog"); assertEquals(200, response.statusCode());
        var catalog = mapper.readTree(response.body());
        assertEquals(1, catalog.path("schemaVersion").asInt());
        assertEquals("1272", catalog.path("courses").get(0).path("termCode").asText());
        assertTrue(response.headers().firstValue("etag").isPresent());
        assertTrue(mapper.readTree(get("/api/status").body()).path("dataAvailable").asBoolean());
        assertEquals(200, get("/actuator/health").statusCode());
    }
    @Test void allowsOnlyConfiguredFrontendOrigins() throws Exception {
        for (String origin : new String[]{"http://localhost:5173", "http://localhost:4173", "http://127.0.0.1:5173", "http://127.0.0.1:4173"}) {
            var allowed = http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/catalog"))
                .header("Origin", origin).GET().build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(200, allowed.statusCode(), origin);
            assertEquals(origin, allowed.headers().firstValue("Access-Control-Allow-Origin").orElseThrow());
        }
        var denied = http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/catalog"))
            .header("Origin", "https://unconfigured.example").GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(403, denied.statusCode());
    }
    @Test void returnsPaginatedSearchAndExplicitInvalidRequestStatuses() throws Exception {
        assertEquals(1, mapper.readTree(get("/api/courses?q=CSE2421&term=1272").body()).path("total").asInt());
        assertEquals(0, mapper.readTree(get("/api/courses?number=9999").body()).path("total").asInt());
        assertEquals(400, get("/api/courses?size=1000").statusCode());
        assertEquals(404, get("/api/courses/does-not-exist").statusCode());
    }
}

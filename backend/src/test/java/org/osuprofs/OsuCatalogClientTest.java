package org.osuprofs;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import org.osuprofs.adapter.out.osu.OsuCatalogClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class OsuCatalogClientTest {
    private HttpServer server;
    private final JsonMapper mapper = JsonMapper.builder().build();
    @AfterEach void stop() { if (server != null) server.stop(0); }
    private String fixture(String name) throws Exception {
        try (var stream = getClass().getResourceAsStream("/" + name)) { return new String(stream.readAllBytes(), StandardCharsets.UTF_8); }
    }
    private OsuCatalogClient client() { return new OsuCatalogClient(mapper, "http://localhost:" + server.getAddress().getPort(), 5, 20, 0); }
    private void serve(java.util.function.Function<String, String> responder, AtomicInteger requests) throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v2/classes/search", exchange -> {
            requests.incrementAndGet();
            byte[] response = responder.apply(exchange.getRequestURI().getRawQuery()).getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            try (var output = exchange.getResponseBody()) { output.write(response); }
        }); server.start();
    }
    @Test void normalizesActualNullInstructorTimeAndEnrollmentFields() throws Exception {
        String response = fixture("osu-api-fixture.json");
        var query = new java.util.concurrent.atomic.AtomicReference<String>();
        serve(q -> { query.set(q); return response; }, new AtomicInteger());
        var catalog = client().fetch("1272", "col", List.of("CSE"));
        assertTrue(query.get().contains("subject=cse"), "OSU's subject parameter is case-sensitive");
        assertEquals(2, catalog.courses().size());
        var named = catalog.courses().stream().filter(c -> c.catalogNumber().equals("4193")).findFirst().orElseThrow();
        assertEquals("Julia Armstrong", named.sections().getFirst().instructors().getFirst().name());
        var tba = catalog.courses().stream().filter(c -> c.catalogNumber().equals("5023")).findFirst().orElseThrow().sections().getFirst();
        assertTrue(tba.instructors().isEmpty(), "An object with a null name must remain TBA");
        assertEquals("08:00", tba.meetings().getFirst().startTime());
        assertEquals(List.of("WE", "FR"), tba.meetings().getFirst().days());
        assertEquals("CLOSED", tba.enrollment().status());
        assertNull(tba.enrollment().capacity(), "Room capacity cannot be sold as enrollment capacity");
        assertNull(tba.enrollment().available());
        assertTrue(catalog.coverage().getFirst().complete());
    }
    @Test void readsEveryPageAndRejectsMissingSections() throws Exception {
        JsonNode original = mapper.readTree(fixture("osu-api-fixture.json"));
        var first = mapper.createObjectNode(); var second = mapper.createObjectNode();
        var data1 = mapper.createObjectNode(); var data2 = mapper.createObjectNode();
        for (var data : List.of(data1, data2)) { data.put("totalItems", 2); data.put("totalPages", 2); }
        data1.put("page", 1); data2.put("page", 2);
        data1.set("courses", mapper.createArrayNode().add(original.path("data").path("courses").get(0)));
        data2.set("courses", mapper.createArrayNode().add(original.path("data").path("courses").get(1)));
        first.set("data", data1); second.set("data", data2);
        AtomicInteger requests = new AtomicInteger();
        serve(q -> mapper.writeValueAsString(q.contains("&p=2&") ? second : first), requests);
        assertEquals(2, client().fetch("1272", "col", List.of("CSE")).courses().size());
        assertEquals(2, requests.get());
        data2.set("courses", mapper.createArrayNode());
        assertThrows(IllegalStateException.class, () -> client().fetch("1272", "col", List.of("CSE")));
    }
    @Test void acceptsRealMissingMetadataAndKeepsSeparateCourseOfferings() throws Exception {
        String response = fixture("osu-api-missing-course-metadata-fixture.json");
        serve(q -> response, new AtomicInteger());
        var catalog = client().fetch("1272", "col", List.of("MATH"));
        assertFalse(catalog.courses().isEmpty());
        assertTrue(catalog.courses().stream().anyMatch(c -> c.id().endsWith("-2")));
        assertTrue(catalog.courses().stream().allMatch(c -> c.title() != null && !c.title().isBlank()));
        assertTrue(catalog.courses().stream().allMatch(c -> c.credits().equals("Not published")));
    }
    @Test void mergesOneActualCourseSplitAcrossPages() throws Exception {
        JsonNode original = mapper.readTree(fixture("osu-api-missing-course-metadata-fixture.json"));
        JsonNode item = original.path("data").path("courses").get(0);
        var first = mapper.createObjectNode(); var second = mapper.createObjectNode();
        for (int page = 1; page <= 2; page++) {
            var splitItem = mapper.createObjectNode(); splitItem.set("course", item.path("course"));
            splitItem.set("sections", mapper.createArrayNode().add(item.path("sections").get(page - 1)));
            var data = mapper.createObjectNode(); data.put("totalItems", 2); data.put("totalPages", 2); data.put("page", page);
            data.set("courses", mapper.createArrayNode().add(splitItem));
            (page == 1 ? first : second).set("data", data);
        }
        serve(q -> mapper.writeValueAsString(q.contains("&p=2&") ? second : first), new AtomicInteger());
        var result = client().fetch("1272", "col", List.of("MATH"));
        assertEquals(1, result.courses().size());
        assertEquals(2, result.courses().getFirst().sections().size());
        assertEquals("1272-col-MATH-5194-153181-2", result.courses().getFirst().id());
    }
    @Test void rejectsPaginationBeyondSafetyLimit() throws Exception {
        var root = mapper.createObjectNode(); var data = mapper.createObjectNode();
        data.put("totalPages", 999); data.put("totalItems", 999); data.set("courses", mapper.createArrayNode()); root.set("data", data);
        serve(q -> mapper.writeValueAsString(root), new AtomicInteger());
        assertThrows(IllegalStateException.class, () -> client().fetch("1272", "col", List.of("CSE")));
    }
}

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
        assertTrue(query.get().contains("sort=catalogNumber"), "Stable supported ordering avoids relevance-pagination duplicates");
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
    @Test void discoversSubjectsOnlyAfterSelectingRequestedTermAndPreservingSession() throws Exception {
        serve(q -> "{}", new AtomicInteger());
        var posted = new java.util.concurrent.atomic.AtomicReference<String>();
        var cookie = new java.util.concurrent.atomic.AtomicReference<String>();
        var ignoreTermChange = new java.util.concurrent.atomic.AtomicBoolean(false);
        String prefix = "<form><input name='ICSID' value='public-token'><input name='ICStateNum' value='1'>"
            + "<select name='SSR_CLSRCH_WRK_CAMPUS$0'><option value='COL' selected>Columbus</option></select>";
        String initial = prefix + "<select name='CLASS_SRCH_WRK2_STRM$35$'><option value='1264' selected>Summer</option>"
            + "<option value='1272'>Spring</option></select><select name='SSR_CLSRCH_WRK_SUBJECT_SRCH$1'>"
            + "<option value='SUMMERONLY'>Summer subject</option></select></form>";
        String expanded = prefix + "<select name='CLASS_SRCH_WRK2_STRM$35$'><option value='1272' selected>Spring</option></select>"
            + "<select name='SSR_CLSRCH_WRK_SUBJECT_SRCH$1'><option value=''></option><option value='CSE'>Computer Science</option>"
            + "<option value='ENGRTEC'>Engineering Technology</option><option value='GENCHEM'>General Chemistry</option></select></form>";
        server.createContext("/directory", exchange -> {
            boolean post = exchange.getRequestMethod().equals("POST");
            if (post) {
                posted.set(java.net.URLDecoder.decode(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8), StandardCharsets.UTF_8));
                cookie.set(exchange.getRequestHeaders().getFirst("Cookie"));
            }
            exchange.getResponseHeaders().add("Set-Cookie", "public-session=fixed; Version=1; Path=/");
            byte[] html = (post && !ignoreTermChange.get() ? expanded : initial).getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, html.length);
            try (var out = exchange.getResponseBody()) { out.write(html); }
        });
        String base = "http://localhost:" + server.getAddress().getPort();
        var client = new OsuCatalogClient(mapper, base, 5, 20, 0, base + "/directory");
        assertEquals(List.of("CSE", "ENGRTEC", "GENCHEM"), client.subjects("1272", "col"));
        assertTrue(posted.get().contains("CLASS_SRCH_WRK2_STRM$35$=1272"));
        assertTrue(posted.get().contains("SSR_CLSRCH_WRK_CAMPUS$0=COL"));
        assertTrue(posted.get().contains("ICAction=DERIVED_CLSRCH_SSR_EXPAND_COLLAPS$149$$2"));
        assertTrue(cookie.get().contains("public-session=fixed"));
        assertFalse(cookie.get().contains("$Version"));
        ignoreTermChange.set(true);
        assertThrows(IllegalStateException.class, () -> client.subjects("1272", "col"));
    }
    @Test void regionalSubjectDiscoveryReadsAllPagesAndSectionDetailsKeepConsentCodes() throws Exception {
        var json = (tools.jackson.databind.node.ObjectNode) mapper.readTree(fixture("osu-api-fixture.json"));
        var raw = (tools.jackson.databind.node.ObjectNode) json.path("data").path("courses").get(0).path("sections").get(0);
        raw.put("sessionCode", "7W1"); raw.put("sessionDescription", "First seven weeks"); raw.put("consent", "D");
        raw.put("courseId", "123"); raw.put("courseOfferingNumber", 2); raw.put("section", "0010"); raw.put("autoEnrollSection1", "0020");
        raw.put("startDate", "2027-01-11"); raw.put("endDate", "2027-03-01");
        raw.set("attributes", mapper.createArrayNode().add(mapper.createObjectNode().put("name", "HONORS").put("description", "Honors")));
        var query = new java.util.concurrent.atomic.AtomicReference<String>();
        serve(q -> { query.set(q); return mapper.writeValueAsString(json); }, new AtomicInteger());
        assertEquals(List.of("CSE"), client().subjects("1272", "lma"));
        assertFalse(query.get().contains("subject="), "An empty subject parameter filters out every official result");
        var details = client().fetch("1272", "col", List.of("CSE")).courses().getFirst().sections().getFirst().details();
        assertEquals("D", details.consent()); assertEquals("7W1", details.sessionCode());
        assertEquals(List.of("0020"), details.autoEnrollSections()); assertEquals(List.of("Honors"), details.attributes());
        assertTrue(details.availabilityUrl().endsWith("termCode=1272&sessionCode=7W1&courseOfferingNumber=2&courseId=123&classSection=0010"));
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
    @Test void restartsOnlyInconsistentSubjectPaginationWithoutKeepingPartialRows() throws Exception {
        JsonNode original = mapper.readTree(fixture("osu-api-fixture.json"));
        var first = mapper.createObjectNode(); var second = mapper.createObjectNode();
        for (var pair : List.of(first, second)) {
            var data = mapper.createObjectNode(); data.put("totalItems", 2); data.put("totalPages", 2);
            data.put("page", pair == first ? 1 : 2);
            data.set("courses", mapper.createArrayNode().add(original.path("data").path("courses").get(pair == first ? 0 : 1)));
            pair.set("data", data);
        }
        AtomicInteger requests = new AtomicInteger();
        serve(q -> {
            if (requests.get() == 2) {
                var duplicate = second.deepCopy();
                ((tools.jackson.databind.node.ObjectNode) duplicate.path("data")).set("courses", first.path("data").path("courses"));
                return mapper.writeValueAsString(duplicate);
            }
            return mapper.writeValueAsString(q.contains("&p=2&") ? second : first);
        }, requests);
        assertEquals(2, client().fetch("1272", "col", List.of("CSE")).courses().size());
        assertEquals(4, requests.get(), "Both pages must be collected again after a duplicate/missing section");
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

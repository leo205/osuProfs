package org.osuprofs.adapter.out.osu;

import com.sun.net.httpserver.HttpServer;
import org.jsoup.Jsoup;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.osuprofs.application.port.out.InstructorDiscoverySource.Query;

import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class PeopleSoftInstructorDiscoveryAdapterTest {
    private HttpServer server;
    private final List<Map<String, String>> posts = new ArrayList<>();
    private final Clock clock = Clock.fixed(Instant.parse("2026-10-20T18:00:00Z"), ZoneOffset.UTC);
    @AfterEach void stop() { if (server != null) server.stop(0); }

    private String fixture(String name) throws Exception {
        Path root = Path.of("..").resolve("data/discovery/fixtures");
        if (!Files.exists(root)) root = Path.of("data/discovery/fixtures");
        return Files.readString(root.resolve(name + ".html"));
    }
    private Query query() { return new Query("1272", "col", "CSE", "3421", List.of("Lee")); }
    private PeopleSoftInstructorDiscoveryAdapter serve(String negative, String positive) throws Exception {
        List<String> responses = List.of(fixture("search-form"), fixture("expanded-form"), negative,
                fixture("search-form"), fixture("expanded-form"), positive);
        AtomicInteger index = new AtomicInteger();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/search", exchange -> {
            int request = index.getAndIncrement();
            if (exchange.getRequestMethod().equals("POST")) {
                Map<String, String> fields = new LinkedHashMap<>();
                for (String part : new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8).split("&")) {
                    String[] pair = part.split("=", 2);
                    fields.put(URLDecoder.decode(pair[0], StandardCharsets.UTF_8), pair.length == 1 ? "" : URLDecoder.decode(pair[1], StandardCharsets.UTF_8));
                }
                fields.put("testCookie", exchange.getRequestHeaders().getFirst("Cookie"));
                posts.add(fields);
            }
            exchange.getResponseHeaders().set("Set-Cookie", "public-session=fixed; Version=1; Path=/");
            byte[] response = responses.get(Math.min(request, responses.size() - 1)).getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            try (var output = exchange.getResponseBody()) { output.write(response); }
        });
        server.start();
        return new PeopleSoftInstructorDiscoveryAdapter(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/search"), Duration.ZERO, clock);
    }

    @Test void preservesAnonymousSessionAndChecksExactSurnameWithNegativeControl() throws Exception {
        var adapter = serve(fixture("no-results"), fixture("lee-results"));
        var result = adapter.discover(query());
        assertEquals(List.of("6248", "36012"), result.stream().map(e -> e.classNumber()).toList());
        assertTrue(result.stream().allMatch(e -> e.surname().equals("Lee") && e.termCode().equals("1272")
                && e.checkedAt().equals("2026-10-20T18:00:00Z") && e.sourceUrl().startsWith("https://courses.erppub.osu.edu/")));
        assertEquals(4, posts.size());
        assertEquals("OsuNegativeControlZzz", posts.get(1).get("SSR_CLSRCH_WRK_LAST_NAME$8"));
        var search = posts.get(3);
        assertEquals("E", search.get("SSR_CLSRCH_WRK_SSR_EXACT_MATCH2$8"));
        assertEquals("N", search.get("SSR_CLSRCH_WRK_SSR_OPEN_ONLY$chk$4"));
        assertFalse(search.containsKey("SSR_CLSRCH_WRK_SSR_OPEN_ONLY$4"));
        assertEquals("fixture-public-session-token", search.get("ICSID"));
        assertTrue(search.get("testCookie").contains("public-session=fixed"));
        assertFalse(search.get("testCookie").contains("$Version"), "PeopleSoft requires browser-style session cookies");
        assertFalse(search.get("testCookie").contains("\"fixed\""));
    }
    @Test void rejectsResultsWhenFilterWasIgnored() throws Exception {
        var adapter = serve(fixture("no-results"), fixture("lee-results").replace("'<strong>LEE</strong>'", "'<strong>SMITH</strong>'"));
        assertThrows(java.io.IOException.class, () -> adapter.discover(query()));
    }
    @Test void acceptsPeopleSoftCanonicalCompoundSurnameEchoWithoutIgnoringDifferentNames() throws Exception {
        var adapter = serve(fixture("no-results"), fixture("lee-results").replace("'<strong>LEE</strong>'", "'<strong>ABUSHATTAL</strong>'"));
        var query = new Query("1272", "col", "CSE", "3421", List.of("Abu Shattal"));
        assertEquals(2, adapter.discover(query).size());
        server.stop(0);
        var different = serve(fixture("no-results"), fixture("lee-results").replace("'<strong>LEE</strong>'", "'<strong>ABU OTHER SHATTAL</strong>'"));
        assertThrows(java.io.IOException.class, () -> different.discover(query));
    }
    @Test void rejectsNegativeControlThatReturnsAnyClass() throws Exception {
        var adapter = serve(fixture("lee-results"), fixture("lee-results"));
        assertThrows(java.io.IOException.class, () -> adapter.discover(query()));
    }
    @Test void rejectsTruncatedResultsAndWrongTerm() throws Exception {
        var truncated = serve(fixture("no-results"), fixture("lee-results").replace("2 class section(s) found", "3 class section(s) found"));
        assertThrows(java.io.IOException.class, () -> truncated.discover(query()));
        server.stop(0);
        var wrongTerm = serve(fixture("no-results"), fixture("lee-results").replace("Spring 2027", "Autumn 2026"));
        assertThrows(java.io.IOException.class, () -> wrongTerm.discover(query()));
    }
    @Test void rejectsUnrecognizedEmptyResponseAndUncheckedControls() throws Exception {
        var adapter = serve(fixture("no-results").replace("OsuNegativeControlZzz", "Lee"), fixture("lee-results"));
        assertThrows(java.io.IOException.class, () -> adapter.discover(query()));
        var fields = PeopleSoftInstructorDiscoveryAdapter.fields(Jsoup.parse(fixture("expanded-form")));
        assertFalse(fields.containsKey("CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH"));
        assertFalse(fields.containsKey("SSR_CLSRCH_WRK_SUN$7"));
    }
}

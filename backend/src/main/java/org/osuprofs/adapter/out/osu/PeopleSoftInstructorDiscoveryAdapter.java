package org.osuprofs.adapter.out.osu;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.osuprofs.application.port.out.InstructorDiscoverySource;

import java.io.IOException;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/** Uses the ordinary anonymous class-search form. It never resolves a surname to a full identity. */
public final class PeopleSoftInstructorDiscoveryAdapter implements InstructorDiscoverySource {
    public static final URI PUBLIC_SEARCH = URI.create("https://courses.erppub.osu.edu/psc/ps_1/EMPLOYEE/CAMP/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL");
    private static final String TERM = "CLASS_SRCH_WRK2_STRM$35$";
    private static final String CAMPUS = "SSR_CLSRCH_WRK_CAMPUS$0";
    private static final String SUBJECT = "SSR_CLSRCH_WRK_SUBJECT_SRCH$1";
    private static final String NUMBER = "SSR_CLSRCH_WRK_CATALOG_NBR$2";
    private static final String SURNAME = "SSR_CLSRCH_WRK_LAST_NAME$8";
    private static final String SURNAME_OPERATOR = "SSR_CLSRCH_WRK_SSR_EXACT_MATCH2$8";
    private static final String NUMBER_OPERATOR = "SSR_CLSRCH_WRK_SSR_EXACT_MATCH1$2";
    private static final String NEGATIVE_CONTROL = "OsuNegativeControlZzz";
    private static final String NO_RESULTS = "The search returns no results that match the criteria specified.";
    private final URI endpoint;
    private final Duration pause;
    private final Clock clock;

    public PeopleSoftInstructorDiscoveryAdapter() {
        this(PUBLIC_SEARCH, Duration.ofMillis(350), Clock.systemUTC());
    }

    PeopleSoftInstructorDiscoveryAdapter(URI endpoint, Duration pause, Clock clock) {
        this.endpoint = endpoint;
        this.pause = pause;
        this.clock = clock;
    }

    @Override
    public List<Evidence> discover(Query query) throws Exception {
        if (query.termCode() == null || !query.termCode().matches("\\d{4}")
                || query.campus() == null || query.subject() == null || query.surnames() == null) {
            throw new IllegalArgumentException("Discovery requires a term, campus, subject, and bounded surname list.");
        }
        Set<String> names = new LinkedHashSet<>();
        for (String surname : query.surnames()) {
            if (surname == null || surname.isBlank() || surname.length() > 100 || surname.chars().anyMatch(Character::isISOControl)) {
                throw new IllegalArgumentException("Discovery surnames must be nonempty public names.");
            }
            names.add(surname.strip());
        }
        if (names.isEmpty()) return List.of();
        if (names.size() > 200) throw new IllegalArgumentException("A discovery batch is limited to 200 surnames.");

        CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL) {
            @Override public void put(URI uri, Map<String, List<String>> responseHeaders) throws IOException {
                super.put(uri, responseHeaders);
                // PeopleSoft rejects Java's RFC2965 quoted Cookie/$Version format.
                // Browsers send these same anonymous session cookies in RFC6265 format.
                getCookieStore().getCookies().forEach(cookie -> cookie.setVersion(0));
            }
        };
        try (HttpClient client = HttpClient.newBuilder().cookieHandler(cookies)
                .connectTimeout(Duration.ofSeconds(25)).followRedirects(HttpClient.Redirect.NORMAL).build()) {
            if (!search(client, query, NEGATIVE_CONTROL).isEmpty()) {
                throw new IOException("Public instructor search ignored its negative control; no discovery will be published.");
            }
            List<Evidence> evidence = new ArrayList<>();
            for (String name : names) {
                Set<String> classes;
                try { classes = search(client, query, name); }
                catch (Exception failure) {
                    throw new IOException("Instructor search failed for " + query.subject() + " / " + query.termCode()
                        + " / exact surname '" + name + "': " + failure.getMessage(), failure);
                }
                String checkedAt = Instant.now(clock).toString();
                for (String classNumber : classes) {
                    evidence.add(new Evidence(query.termCode(), classNumber, name, PUBLIC_SEARCH.toString(), checkedAt));
                }
            }
            return List.copyOf(evidence);
        }
    }

    private Set<String> search(HttpClient client, Query query, String surname) throws Exception {
        Document initial = request(client, null);
        Map<String, String> form = fields(initial);
        String termLabel = optionLabel(initial, TERM, query.termCode());
        String campus = query.campus().toUpperCase(Locale.ROOT);
        String campusLabel = optionLabel(initial, CAMPUS, campus);
        String subject = query.subject().toUpperCase(Locale.ROOT);
        String subjectLabel = optionLabel(initial, SUBJECT, subject);
        form.put("ICAction", "DERIVED_CLSRCH_SSR_EXPAND_COLLAPS$149$$2");
        form.put(TERM, query.termCode());
        form.put(CAMPUS, campus);
        Document expanded = request(client, form);
        form = fields(expanded);
        if (!form.containsKey(SURNAME)) throw new IOException("Public instructor-search fields are unavailable.");
        form.put("ICAction", "CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH");
        form.put(TERM, query.termCode());
        form.put(CAMPUS, campus);
        form.put(SUBJECT, subject);
        form.put(NUMBER_OPERATOR, "E");
        form.put(NUMBER, query.catalogNumber() == null ? "" : query.catalogNumber());
        form.put("SSR_CLSRCH_WRK_SSR_OPEN_ONLY$chk$4", "N");
        form.remove("SSR_CLSRCH_WRK_SSR_OPEN_ONLY$4");
        form.put(SURNAME_OPERATOR, "E");
        form.put(SURNAME, surname);
        Document result = request(client, form);
        Set<String> classes = classNumbers(result);
        if (classes.isEmpty()) {
            Map<String, String> returned = fields(result);
            if (!normalized(result.text()).contains(NO_RESULTS)
                    || !query.termCode().equals(returned.get(TERM)) || !campus.equals(returned.get(CAMPUS))
                    || !subject.equals(returned.get(SUBJECT)) || !form.get(NUMBER).equals(returned.get(NUMBER))
                    || !"E".equals(returned.get(SURNAME_OPERATOR))
                    || !surname.equalsIgnoreCase(returned.getOrDefault(SURNAME, ""))) {
                throw new IOException("Public search returned an unrecognized or incomplete empty response.");
            }
            return Set.of();
        }
        String heading = textById(result, "DERIVED_CLSRCH_SSS_PAGE_KEYDESCR");
        String criteria = textById(result, "win1divDERIVED_CLSRCH_SSR_CLSRCH_CRIT");
        if (!heading.contains(termLabel)
                || !contains(criteria, "Course Subject: " + subjectLabel + ",")
                || !contains(criteria, "Campus: " + campusLabel)
                || !confirmsSurname(criteria, surname)
                || (!form.get(NUMBER).isEmpty() && !matches(criteria,
                    "Course Number is exactly\\s*'" + Pattern.quote(form.get(NUMBER)) + "'"))) {
            throw new IOException("Public search did not confirm the requested term, subject, campus, and exact surname.");
        }
        var count = Pattern.compile("(\\d+) class section\\(s\\) found", Pattern.CASE_INSENSITIVE).matcher(normalized(result.text()));
        if (!count.find() || Integer.parseInt(count.group(1)) != classes.size()) {
            throw new IOException("Public search result count does not match the returned class numbers.");
        }
        // OSU returns a warning rather than a complete result when the search is too broad.
        String text = normalized(result.text()).toLowerCase(Locale.ROOT);
        if (text.contains("search results exceed") || text.contains("maximum number of classes") || text.contains("search criteria is too broad")) {
            throw new IOException("Public instructor search was truncated; narrow the scope before publishing.");
        }
        return classes;
    }

    private Document request(HttpClient client, Map<String, String> form) throws Exception {
        if (!pause.isZero()) Thread.sleep(pause.toMillis());
        URI uri = form == null ? URI.create(endpoint + "?PAGE=SSR_CLSRCH_ENTRY&_=" + System.nanoTime()) : endpoint;
        HttpRequest.Builder request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(45))
                .header("User-Agent", "Mozilla/5.0 (compatible; OSUProfs public course planner)")
                .header("Referer", endpoint.toString()).header("Accept", "text/html");
        if (form != null) {
            String body = form.entrySet().stream().map(e -> encode(e.getKey()) + "=" + encode(e.getValue()))
                    .collect(Collectors.joining("&"));
            request.header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString(body));
        }
        HttpResponse<String> response = client.send(request.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() != 200 || response.body().length() > 2_000_000) {
            throw new IOException("Public class search failed with HTTP " + response.statusCode() + ".");
        }
        Document document = Jsoup.parse(response.body());
        if (document.getElementById("ICSID") == null) throw new IOException("Public class search returned no session form.");
        return document;
    }

    static Map<String, String> fields(Document document) throws IOException {
        Map<String, String> values = new LinkedHashMap<>();
        Element form = document.selectFirst("form");
        if (form == null) throw new IOException("Public class-search form is missing.");
        for (Element input : form.select("input[name]:not([disabled])")) {
            String type = input.attr("type").toLowerCase(Locale.ROOT);
            if (Set.of("button", "submit", "reset", "file").contains(type)) continue;
            if ((type.equals("checkbox") || type.equals("radio")) && !input.hasAttr("checked")) continue;
            values.put(input.attr("name"), input.attr("value"));
        }
        for (Element select : form.select("select[name]:not([disabled])")) {
            Element option = select.selectFirst("option[selected]");
            if (option == null) option = select.selectFirst("option");
            values.put(select.attr("name"), option == null ? "" : option.attr("value"));
        }
        if (values.getOrDefault("ICSID", "").isBlank() || !values.containsKey("ICStateNum")) {
            throw new IOException("Public class-search session fields are missing.");
        }
        return values;
    }

    static Set<String> classNumbers(Document document) throws IOException {
        Set<String> numbers = new LinkedHashSet<>();
        for (Element anchor : document.select("a[id^=MTG_CLASS_NBR$]")) {
            String number = anchor.text().strip();
            if (!number.matches("\\d{1,8}")) throw new IOException("Public result contains an invalid class number.");
            numbers.add(number);
        }
        return numbers;
    }

    private static String optionLabel(Document document, String name, String value) throws IOException {
        Element select = document.getElementsByAttributeValue("name", name).first();
        if (select != null) for (Element option : select.select("option")) {
            if (value.equals(option.attr("value"))) return normalized(option.text());
        }
        throw new IOException("Requested discovery scope is absent from public class search.");
    }

    private static String textById(Document document, String id) {
        Element element = document.getElementById(id);
        return element == null ? "" : normalized(element.text());
    }
    private static String normalized(String text) { return text.replace('\u00a0', ' ').replaceAll("\\s+", " ").strip(); }
    private static boolean confirmsSurname(String criteria, String surname) {
        var echoed = Pattern.compile("Instructor Last Name:\\s*is exactly\\s*'(.+?)'\\s*(?:,|$)",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE).matcher(criteria);
        return echoed.find() && surnameKey(echoed.group(1)).equals(surnameKey(surname));
    }
    private static String surnameKey(String surname) {
        // The public form canonicalizes compound names, e.g. Abu Shattal -> ABUSHATTAL.
        return Normalizer.normalize(surname, Normalizer.Form.NFKC).replaceAll("[\\s\\p{Pd}'’]+", "").toUpperCase(Locale.ROOT);
    }
    private static boolean contains(String text, String part) { return text.toLowerCase(Locale.ROOT).contains(part.toLowerCase(Locale.ROOT)); }
    private static boolean matches(String text, String regex) { return Pattern.compile(regex, Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE).matcher(text).find(); }
    private static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
}

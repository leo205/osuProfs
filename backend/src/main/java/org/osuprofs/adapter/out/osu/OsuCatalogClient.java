package org.osuprofs.adapter.out.osu;

import org.osuprofs.application.port.out.CatalogSource;
import org.osuprofs.domain.model.Catalog;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;

/** Public official OSU feed. Does not guess hidden/TBA instructors or treat room capacity as seat capacity. */
public final class OsuCatalogClient implements CatalogSource {
    private static final String SEARCH_PATH = "/v2/classes/search";
    private static final String PUBLIC_URL = "https://classes.osu.edu/";
    private final HttpClient http;
    private final JsonMapper mapper;
    private final String baseUrl;
    private final Duration timeout;
    private final int maxPages;
    private final long delayMs;

    public OsuCatalogClient(JsonMapper mapper, String baseUrl, int timeoutSeconds, int maxPages, long delayMs) {
        if (maxPages < 1 || timeoutSeconds < 1 || delayMs < 0) throw new IllegalArgumentException("Invalid importer limits");
        this.mapper = mapper; this.baseUrl = baseUrl.replaceAll("/$", ""); this.timeout = Duration.ofSeconds(timeoutSeconds);
        this.maxPages = maxPages; this.delayMs = delayMs;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();
    }

    @Override public Catalog fetch(String term, String campus, List<String> subjects) throws Exception {
        String timestamp = Instant.now().toString();
        Map<String, MutableCourse> courses = new LinkedHashMap<>();
        Map<String, Catalog.Option> subjectOptions = new TreeMap<>();
        String termLabel = null, campusLabel = null;
        for (String subject : subjects) {
            int pages = 1, expectedItems = -1;
            Set<String> seenSections = new HashSet<>();
            for (int page = 1; page <= pages; page++) {
                if (page > 1 || !courses.isEmpty()) Thread.sleep(delayMs);
                JsonNode data = request(term, campus, subject, page).path("data");
                if (!data.path("courses").isArray() || !data.path("totalPages").isNumber() || !data.path("totalItems").isNumber())
                    throw new IllegalStateException("OSU response lacks valid courses or pagination for " + subject);
                int actualPages = data.path("totalPages").asInt();
                int actualItems = data.path("totalItems").asInt();
                if (actualPages < 0 || actualItems < 0 || actualPages > maxPages)
                    throw new IllegalStateException("OSU pagination exceeds configured limits for " + subject);
                if (page == 1) { pages = Math.max(1, actualPages); expectedItems = actualItems; }
                else if (actualItems != expectedItems || Math.max(1, actualPages) != pages)
                    throw new IllegalStateException("OSU pagination changed during import for " + subject + "; retry later");
                if (data.path("page").isNumber() && data.path("page").asInt() != page)
                    throw new IllegalStateException("OSU returned the wrong page for " + subject);
                for (JsonNode item : data.path("courses")) {
                    JsonNode raw = item.path("course");
                    if (!subject.equalsIgnoreCase(text(raw, "subject")))
                        throw new IllegalStateException("OSU returned a course outside requested subject " + subject);
                    if (!item.path("sections").isArray()) throw new IllegalStateException("OSU course has no section array");
                    for (JsonNode section : item.path("sections")) {
                        String classNumber = required(section, "classNumber");
                        String actualTerm = text(section, "termCode");
                        if (actualTerm != null && !actualTerm.equals(term)) throw new IllegalStateException("Wrong term from OSU");
                        String actualCampus = first(text(section, "secCampus"), text(raw, "campusCode"), campus);
                        if (!actualCampus.equalsIgnoreCase(campus)) throw new IllegalStateException("Wrong campus from OSU");
                        String number = required(raw, "catalogNumber");
                        String courseId = first(text(raw, "courseId"), text(section, "courseId"));
                        if (courseId == null) throw new IllegalStateException("OSU course missing courseId");
                        String offering = first(text(section, "courseOfferingNumber"), text(raw, "offeringNumber"), "1");
                        String id = String.join("-", term, campus, subject, number, courseId, offering);
                        MutableCourse course = courses.get(id);
                        if (course == null) {
                            String title = first(text(raw, "title"), text(raw, "shortDescription"), text(section, "courseTitle"),
                                text(section, "description"), text(raw, "description"), subject + " " + number);
                            course = new MutableCourse(id, term, campus, subject, number, title,
                                first(text(raw, "description"), text(section, "courseDescription"), ""), credits(raw),
                                first(text(raw, "academicCareer"), text(section, "career"), "Not published"), attributes(raw));
                            courses.put(id, course);
                        }
                        course.sections.putIfAbsent(term + "-" + classNumber, section(section, term, timestamp));
                        seenSections.add(term + "-" + classNumber);
                        termLabel = first(termLabel, text(raw, "term"), text(section, "term"));
                        campusLabel = first(campusLabel, text(raw, "campus"), text(section, "campus"));
                        subjectOptions.putIfAbsent(subject, new Catalog.Option(subject,
                            first(text(raw, "subjectDesc"), text(section, "subjectDesc"), subject)));
                    }
                }
            }
            if (seenSections.size() != expectedItems)
                throw new IllegalStateException("Incomplete " + subject + " import: expected " + expectedItems + " sections, got " + seenSections.size());
            subjectOptions.putIfAbsent(subject, new Catalog.Option(subject, subject));
        }
        List<Catalog.Course> result = courses.values().stream().map(MutableCourse::freeze).toList();
        int sectionCount = result.stream().mapToInt(c -> c.sections().size()).sum();
        int named = result.stream().flatMap(c -> c.sections().stream()).mapToInt(s -> s.instructors().isEmpty() ? 0 : 1).sum();
        List<String> warnings = List.of("Coverage is limited to the listed subjects and campus. TBA instructors remain unpublished.",
            "Enrollment is a periodic snapshot; verify availability in OSU's official registration system.");
        return new Catalog(1, timestamp, new Catalog.Source("Ohio State Class Search", PUBLIC_URL, baseUrl + SEARCH_PATH),
            List.of(new Catalog.Option(term, first(termLabel, term))), List.copyOf(subjectOptions.values()),
            List.of(new Catalog.Option(campus, first(campusLabel, campus))),
            List.of(new Catalog.Coverage(term, campus, subjects, result.size(), sectionCount, named, true, warnings)), result);
    }

    private JsonNode request(String term, String campus, String subject, int page) throws Exception {
        String url = baseUrl + SEARCH_PATH + "?q=&term=" + encode(term) + "&campus=" + encode(campus) +
            "&subject=" + encode(subject.toLowerCase(Locale.ROOT)) + "&p=" + page + "&pagenum=200";
        for (int attempt = 0; attempt < 3; attempt++) {
            HttpResponse<String> response;
            try {
                response = http.send(HttpRequest.newBuilder(URI.create(url)).timeout(timeout)
                    .header("Accept", "application/json").header("User-Agent", "OSUProfs/0.1 public-course-catalog").GET().build(),
                    HttpResponse.BodyHandlers.ofString());
            } catch (java.io.IOException failure) {
                if (attempt == 2) throw failure;
                Thread.sleep(1000L * (attempt + 1));
                continue;
            }
            if (response.statusCode() == 200) return mapper.readTree(response.body());
            if (response.statusCode() != 429 && response.statusCode() < 500)
                throw new IllegalStateException("OSU returned HTTP " + response.statusCode() + " for " + subject + " page " + page);
            if (attempt == 2) throw new IllegalStateException("OSU remains unavailable: HTTP " + response.statusCode());
            Thread.sleep(1000L * (attempt + 1));
        }
        throw new IllegalStateException("OSU request failed");
    }

    private Catalog.Section section(JsonNode raw, String term, String timestamp) throws Exception {
        Map<String, Catalog.Instructor> instructors = new LinkedHashMap<>();
        List<Catalog.Meeting> meetings = new ArrayList<>();
        for (JsonNode meeting : raw.path("meetings")) {
            for (JsonNode instructor : meeting.path("instructors")) {
                String name = text(instructor, "displayName");
                if (name == null || Set.of("tba", "to be announced", "staff").contains(name.toLowerCase(Locale.ROOT))) continue;
                String identity = first(text(instructor, "email"), name).strip().toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");
                String id = "osu-" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(identity.getBytes(StandardCharsets.UTF_8))).substring(0, 16);
                instructors.putIfAbsent(id, new Catalog.Instructor(id, name, text(instructor, "role")));
            }
            List<String> days = new ArrayList<>();
            String[] keys = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"};
            String[] codes = {"MO", "TU", "WE", "TH", "FR", "SA", "SU"};
            for (int i = 0; i < keys.length; i++) if (meeting.path(keys[i]).asBoolean(false)) days.add(codes[i]);
            meetings.add(new Catalog.Meeting(days, time(text(meeting, "startTime")), time(text(meeting, "endTime")),
                first(text(meeting, "facilityDescription"), text(meeting, "buildingDescription")), text(meeting, "room"),
                text(meeting, "startDate"), text(meeting, "endDate")));
        }
        String status = first(text(raw, "enrollmentStatus"), "UNKNOWN").toUpperCase(Locale.ROOT);
        if (status.contains("WAIT")) status = "WAITLIST";
        if (!Set.of("OPEN", "CLOSED", "WAITLIST", "CANCELLED").contains(status)) status = "UNKNOWN";
        if (text(raw, "cancelDate") != null) status = "CANCELLED";
        Integer enrolled = integer(raw, "enrollmentTotal"), waitlist = integer(raw, "waitlistTotal");
        String classNumber = required(raw, "classNumber");
        return new Catalog.Section(term + "-" + classNumber, classNumber, first(text(raw, "section"), ""),
            first(text(raw, "component"), "Not published"), first(text(raw, "instructionMode"), "Not published"),
            List.copyOf(instructors.values()), meetings, new Catalog.Enrollment(status, enrolled, null, waitlist, null,
                status.equals("UNKNOWN") && enrolled == null && waitlist == null ? null : timestamp), PUBLIC_URL, timestamp);
    }
    private String time(String raw) {
        if (raw == null) return null;
        for (String pattern : List.of("h:mm a", "h:mma", "H:mm", "HH:mm:ss")) {
            try { return LocalTime.parse(raw.strip().toUpperCase(Locale.ROOT), DateTimeFormatter.ofPattern(pattern, Locale.US)).format(DateTimeFormatter.ofPattern("HH:mm")); }
            catch (java.time.format.DateTimeParseException ignored) { }
        }
        throw new IllegalStateException("Unsupported OSU meeting time: " + raw);
    }
    private String credits(JsonNode raw) {
        String min = text(raw, "minUnits"), max = text(raw, "maxUnits");
        if (min == null && max == null) return "Not published";
        min = first(min, max); max = first(max, min);
        min = new java.math.BigDecimal(min).stripTrailingZeros().toPlainString();
        max = new java.math.BigDecimal(max).stripTrailingZeros().toPlainString();
        return min.equals(max) ? min : min + "–" + max;
    }
    private List<String> attributes(JsonNode raw) {
        List<String> result = new ArrayList<>();
        for (JsonNode item : raw.path("courseAttributes")) {
            String description = text(item, "description"); if (description != null) result.add(description);
        }
        return result;
    }
    private Integer integer(JsonNode raw, String key) { return raw.path(key).isNumber() && raw.path(key).asInt() >= 0 ? raw.path(key).asInt() : null; }
    private String required(JsonNode raw, String key) { String value = text(raw, key); if (value == null) throw new IllegalStateException("Missing OSU field " + key); return value; }
    private String text(JsonNode raw, String key) { JsonNode v = raw.path(key); return v.isMissingNode() || v.isNull() || v.asText().isBlank() ? null : v.asText().strip(); }
    private String first(String... values) { for (String value : values) if (value != null) return value; return null; }
    private String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
    private static final class MutableCourse {
        final String id, term, campus, subject, number, title, description, credits, career;
        final List<String> attributes;
        final Map<String, Catalog.Section> sections = new LinkedHashMap<>();
        MutableCourse(String id, String term, String campus, String subject, String number, String title,
                      String description, String credits, String career, List<String> attributes) {
            this.id=id; this.term=term; this.campus=campus; this.subject=subject; this.number=number;
            this.title=title; this.description=description; this.credits=credits; this.career=career; this.attributes=attributes;
        }
        Catalog.Course freeze() { return new Catalog.Course(id, term, campus, subject, number, title, description, credits,
            career, null, attributes, List.copyOf(sections.values())); }
    }
}

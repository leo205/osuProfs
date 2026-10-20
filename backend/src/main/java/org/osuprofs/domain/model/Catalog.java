package org.osuprofs.domain.model;

import java.util.List;

/** Stable versioned contract shared by the static website, importer, and REST API. */
public record Catalog(int schemaVersion, String generatedAt, Source source, List<Option> terms,
                      List<Option> subjects, List<Option> campuses, List<Coverage> coverage, List<Course> courses) {
    public record Source(String name, String url, String endpoint) {}
    public record Option(String code, String label) {}
    public record Coverage(String termCode, String campus, List<String> subjects, int courseCount,
                           int sectionCount, int namedInstructorSections, boolean complete, List<String> warnings) {}
    public record Course(String id, String termCode, String campus, String subject, String catalogNumber,
                         String title, String description, String credits, String career, String prerequisites,
                         List<String> attributes, List<Section> sections) {}
    public record Section(String id, String classNumber, String section, String component, String instructionMode,
                          List<Instructor> instructors, List<Meeting> meetings, Enrollment enrollment,
                          String sourceUrl, String lastUpdated, InstructorDiscovery instructorDiscovery, SectionDetails details) {
        public Section(String id, String classNumber, String section, String component, String instructionMode,
                       List<Instructor> instructors, List<Meeting> meetings, Enrollment enrollment,
                       String sourceUrl, String lastUpdated, InstructorDiscovery instructorDiscovery) {
            this(id, classNumber, section, component, instructionMode, instructors, meetings, enrollment,
                sourceUrl, lastUpdated, instructorDiscovery, null);
        }
        public Section(String id, String classNumber, String section, String component, String instructionMode,
                       List<Instructor> instructors, List<Meeting> meetings, Enrollment enrollment,
                       String sourceUrl, String lastUpdated) {
            this(id, classNumber, section, component, instructionMode, instructors, meetings, enrollment,
                sourceUrl, lastUpdated, null);
        }
    }
    public record SectionDetails(String sessionCode, String sessionDescription, String startDate, String endDate,
                                 String associatedClass, List<String> autoEnrollSections, String consent,
                                 String primaryInstructorSection, String location, List<String> attributes,
                                 String availabilityUrl) {}
    public record InstructorDiscovery(String status, List<String> surnames, String sourceUrl,
                                      String checkedAt, String method, List<InstructorIdentityMatch> fullNameMatches) {
        public InstructorDiscovery(String status, List<String> surnames, String sourceUrl, String checkedAt, String method) {
            this(status, surnames, sourceUrl, checkedAt, method, null);
        }
    }
    public record InstructorIdentityMatch(String id, String name, String surname, String profileUrl,
                                          String rateMyProfessorsUrl, List<String> sourceUrls, String confidence,
                                          String checkedAt) {}
    public record Instructor(String id, String name, String role) {}
    public record Meeting(List<String> days, String startTime, String endTime, String building,
                          String room, String startDate, String endDate) {}
    public record Enrollment(String status, Integer enrolled, Integer capacity, Integer waitlist,
                             Integer available, String checkedAt) {}
}

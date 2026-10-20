package org.osuprofs.application.port.out;

import java.util.List;

/** Public instructor-specific searches provide surname evidence, never an inferred full identity. */
public interface InstructorDiscoverySource {
    List<Evidence> discover(Query query) throws Exception;
    record Query(String termCode, String campus, String subject, String catalogNumber, List<String> surnames) {}
    record Evidence(String termCode, String classNumber, String surname, String sourceUrl, String checkedAt) {}
}

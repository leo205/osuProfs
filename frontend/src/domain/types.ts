export interface CodeLabel {
  code: string;
  label: string;
}
export interface Instructor {
  id: string;
  name: string;
  role: string | null;
}
export interface InstructorIdentityMatch {
  id: string;
  name: string;
  surname: string;
  profileUrl: string;
  rateMyProfessorsUrl: string | null;
  sourceUrls: string[];
  confidence: "LIKELY";
  checkedAt: string;
}
export type InstructorProfile = Instructor | InstructorIdentityMatch;
export interface InstructorDiscovery {
  status: "SURNAME_MATCH" | "AMBIGUOUS";
  surnames: string[];
  sourceUrl: string;
  checkedAt: string;
  method: "PEOPLESOFT_EXACT_LAST_NAME";
  fullNameMatches?: InstructorIdentityMatch[];
}
export interface Meeting {
  days: string[];
  startTime: string | null;
  endTime: string | null;
  building: string | null;
  room: string | null;
  startDate: string | null;
  endDate: string | null;
}
export interface SectionDetails {
  sessionCode: string | null;
  sessionDescription: string | null;
  startDate: string | null;
  endDate: string | null;
  associatedClass: string | null;
  consent: string | null;
  primaryInstructorSection: string | null;
  location: string | null;
  availabilityUrl: string | null;
  autoEnrollSections: string[];
  attributes: string[];
}
export interface Section {
  id: string;
  classNumber: string;
  section: string;
  component: string;
  instructionMode: string;
  instructors: Instructor[];
  instructorDiscovery?: InstructorDiscovery | null;
  details?: SectionDetails | null;
  meetings: Meeting[];
  enrollment: {
    status: "OPEN" | "CLOSED" | "WAITLIST" | "UNKNOWN" | "CANCELLED";
    enrolled: number | null;
    capacity: number | null;
    waitlist: number | null;
    available: number | null;
    checkedAt: string | null;
  };
  sourceUrl: string;
  lastUpdated: string;
}
export interface Course {
  id: string;
  termCode: string;
  campus: string;
  subject: string;
  catalogNumber: string;
  title: string;
  description: string;
  credits: string;
  career: string;
  prerequisites: string | null;
  attributes: string[];
  sections: Section[];
}
export interface Coverage {
  termCode: string;
  campus: string;
  subjects: string[];
  courseCount: number;
  sectionCount: number;
  namedInstructorSections: number;
  complete: boolean;
  warnings: string[];
}
export interface Catalog {
  schemaVersion: number;
  generatedAt: string;
  source: { name: string; url: string; endpoint: string };
  terms: CodeLabel[];
  subjects: CodeLabel[];
  campuses: CodeLabel[];
  coverage: Coverage[];
  courses: Course[];
}
export type View = "search" | "instructors" | "schedule" | "status";
export interface Filters {
  termCode: string;
  campus: string;
  subject: string;
  number: string;
  instructor: string;
  query: string;
}
export interface SectionFilters {
  component: string;
  delivery: string;
  day: string;
  namedOnly: boolean;
  hideClosed: boolean;
}
export interface PlannedSection {
  course: Course;
  section: Section;
}
export interface SavedReference {
  termCode: string;
  courseId: string;
  sectionId: string;
}

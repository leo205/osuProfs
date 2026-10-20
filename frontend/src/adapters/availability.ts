export interface SeatAvailability {
  enrollmentStatus: string;
  enrollmentCapacity: number | null;
  enrollmentTotal: number | null;
  availableSeats: number | null;
  waitlistCapacity: number | null;
  waitlistTotal: number | null;
  checkedAt: string;
}

export function isAvailabilityUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const required = [
      "termCode",
      "sessionCode",
      "courseOfferingNumber",
      "courseId",
      "classSection",
    ];
    return (
      url.protocol === "https:" &&
      url.hostname === "content.osu.edu" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.pathname === "/v2/classes/availability" &&
      [...url.searchParams.keys()].length === required.length &&
      required.every((key) =>
        (key === "sessionCode" || key === "classSection"
          ? /^[a-zA-Z0-9_-]+$/
          : /^\d+$/
        ).test(url.searchParams.get(key) ?? ""),
      )
    );
  } catch {
    return false;
  }
}

export async function fetchAvailability(
  url: string,
): Promise<SeatAvailability> {
  if (!isAvailabilityUrl(url))
    throw new Error("This section has no valid official availability link.");
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
    credentials: "omit",
  });
  if (!response.ok)
    throw new Error(
      "OSU’s seat availability service could not be reached. Try again shortly.",
    );
  const value = await response.json();
  const availability = value?.data?.availability;
  if (
    value?.status !== "success" ||
    !availability ||
    typeof availability !== "object" ||
    typeof availability.enrollmentStatus !== "string" ||
    !availability.enrollmentStatus.trim()
  )
    throw new Error(
      "OSU’s response did not include seat availability for this section.",
    );
  function count(key: string, allowNegative = false): number | null {
    const result = availability[key];
    if (result === null || result === undefined) return null;
    if (!Number.isSafeInteger(result) || (!allowNegative && result < 0))
      throw new Error(
        "OSU’s response included an invalid seat count. Please check BuckeyeLink.",
      );
    return result;
  }
  return {
    enrollmentStatus: availability.enrollmentStatus,
    enrollmentCapacity: count("enrollmentCapacity"),
    enrollmentTotal: count("enrollmentTotal"),
    availableSeats: count("availableSeats", true),
    waitlistCapacity: count("waitlistCapacity"),
    waitlistTotal: count("waitlistTotal"),
    checkedAt: new Date().toISOString(),
  };
}

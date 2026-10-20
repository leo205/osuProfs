import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAvailability, isAvailabilityUrl } from "./availability";

const url =
  "https://content.osu.edu/v2/classes/availability?termCode=1272&sessionCode=7W1&courseOfferingNumber=4&courseId=147068&classSection=0010";
const source = {
  status: "success",
  data: {
    availability: {
      isOpen: true,
      enrollmentStatus: "Open",
      enrollmentCapacity: 25,
      enrollmentTotal: 12,
      availableSeats: 13,
      waitlistCapacity: 999,
      waitlistTotal: 0,
    },
  },
};
afterEach(() => vi.unstubAllGlobals());

describe("official current seat availability", () => {
  it("accepts OSU session codes and preserves actual zero and available seat counts with a new check time", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => source }));
    vi.stubGlobal("fetch", fetch);
    const result = await fetchAvailability(url);
    expect(result).toMatchObject({
      enrollmentStatus: "Open",
      enrollmentCapacity: 25,
      enrollmentTotal: 12,
      availableSeats: 13,
      waitlistTotal: 0,
    });
    expect(Number.isFinite(Date.parse(result.checkedAt))).toBe(true);
    expect(fetch.mock.calls[0]).toEqual([
      url,
      expect.objectContaining({ credentials: "omit", cache: "no-store" }),
    ]);
  });
  it.each([
    url.replace("content.osu.edu", "other.example"),
    url.replace("https:", "http:"),
    `${url}&redirect=https://other.example`,
    url.replace("/availability?", "/search?"),
    url.replace("?termCode", "?otherKey"),
    url.replace("https://", "https://user:pass@"),
  ])(
    "does not request an unsafe or unrelated endpoint: %s",
    async (invalid) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      expect(isAvailabilityUrl(invalid)).toBe(false);
      await expect(fetchAvailability(invalid)).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("rejects missing availability and invalid counts instead of showing false zero seats", async () => {
    const malformed = structuredClone(source);
    malformed.data.availability.enrollmentCapacity = -1;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => malformed })),
    );
    await expect(fetchAvailability(url)).rejects.toThrow(/invalid seat count/);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: "error", data: {} }),
      })),
    );
    await expect(fetchAvailability(url)).rejects.toThrow(/did not include/);
  });
  it("keeps unknown seat counts unknown and preserves an official over-capacity count", async () => {
    const partial = {
      status: "success",
      data: {
        availability: { enrollmentStatus: "Closed", availableSeats: -2 },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => partial })),
    );
    expect(await fetchAvailability(url)).toMatchObject({
      enrollmentStatus: "Closed",
      enrollmentCapacity: null,
      availableSeats: -2,
      waitlistTotal: null,
    });
  });
});

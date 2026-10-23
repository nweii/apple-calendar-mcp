// Verifies canonical CalDAV reads for expanded results without contacting iCloud.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDAVClient } from "tsdav";
import { listEvents } from "../src/calendar";
import { buildEventCalendar } from "../src/ical";
import { encodeDavId } from "../src/security";

vi.mock("tsdav", () => ({ createDAVClient: vi.fn() }));

const calendar = { url: "https://caldav.icloud.com/fixture/calendars/personal/", components: ["VEVENT"] };
const objectUrl = `${calendar.url}screening.ics`;
const credentials = { username: "owner@example.com", password: "fixture-password", defaultTimeZone: "America/New_York" };

describe("expanded calendar reads", () => {
  beforeEach(() => vi.mocked(createDAVClient).mockReset());

  it("fetches the canonical source even when expansion has no recurrence ID", async () => {
    const source = buildEventCalendar({ title: "Screening", start: "2026-10-20T18:00:00-04:00", end: "2026-10-20T20:25:00-04:00", timeZone: "America/New_York" }, credentials.username).data;
    const expanded = source.replace("DTSTART;TZID=America/New_York:20261020T180000", "DTSTART:20261020T180000Z").replace("DTEND;TZID=America/New_York:20261020T202500", "DTEND:20261020T202500Z");
    const fetchCalendarObjects = vi.fn()
      .mockResolvedValueOnce([{ url: objectUrl, data: expanded }])
      .mockResolvedValueOnce([{ url: objectUrl, data: source }]);
    vi.mocked(createDAVClient).mockResolvedValue({ fetchCalendars: vi.fn().mockResolvedValue([calendar]), fetchCalendarObjects } as unknown as Awaited<ReturnType<typeof createDAVClient>>);
    const events = await listEvents(credentials, encodeDavId(calendar.url), "2026-10-20T00:00:00-04:00", "2026-10-21T00:00:00-04:00", 20);
    expect(events[0]).toMatchObject({ start: "2026-10-20T22:00:00.000Z", startLocal: "2026-10-20T18:00:00-04:00" });
    expect(fetchCalendarObjects).toHaveBeenNthCalledWith(2, expect.objectContaining({ objectUrls: [objectUrl], useMultiGet: true }));
  });

  it.each(["", ";TZID=America/New_York"])("resolves canonical wall times with parameter '%s' before listing", async (parameter) => {
    const source = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:wall-time-fixture", `DTSTART${parameter}:20261020T090000`, `DTEND${parameter}:20261020T100000`, "SUMMARY:Review", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const expanded = source.replace(`DTSTART${parameter}:20261020T090000`, "DTSTART:20261020T130000Z").replace(`DTEND${parameter}:20261020T100000`, "DTEND:20261020T140000Z");
    const fetchCalendarObjects = vi.fn()
      .mockResolvedValueOnce([{ url: objectUrl, data: expanded }])
      .mockResolvedValueOnce([{ url: objectUrl, data: source }]);
    vi.mocked(createDAVClient).mockResolvedValue({ fetchCalendars: vi.fn().mockResolvedValue([calendar]), fetchCalendarObjects } as unknown as Awaited<ReturnType<typeof createDAVClient>>);
    const events = await listEvents(credentials, encodeDavId(calendar.url), "2026-10-20T00:00:00-04:00", "2026-10-21T00:00:00-04:00", 20);
    expect(events[0]).toMatchObject({ start: "2026-10-20T13:00:00.000Z", end: "2026-10-20T14:00:00.000Z", startLocal: "2026-10-20T09:00:00-04:00" });
  });

  it("rejects an expanded result whose canonical resource is missing", async () => {
    const expanded = buildEventCalendar({ title: "Screening", start: "2026-10-20T18:00:00-04:00", end: "2026-10-20T20:25:00-04:00" }, credentials.username).data;
    const fetchCalendarObjects = vi.fn()
      .mockResolvedValueOnce([{ url: objectUrl, data: expanded }])
      .mockResolvedValueOnce([]);
    vi.mocked(createDAVClient).mockResolvedValue({ fetchCalendars: vi.fn().mockResolvedValue([calendar]), fetchCalendarObjects } as unknown as Awaited<ReturnType<typeof createDAVClient>>);
    await expect(listEvents(credentials, encodeDavId(calendar.url), "2026-10-20T00:00:00-04:00", "2026-10-21T00:00:00-04:00", 20)).rejects.toThrow("canonical event");
  });
});

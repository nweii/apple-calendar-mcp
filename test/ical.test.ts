// Verifies rich event parsing and lossless iCalendar mutation without making network requests.

import ICAL from "ical.js";
import { describe, expect, it } from "vitest";
import { buildEventCalendar, calendarTimeZoneId, cancelEventOccurrence, parseExpandedIcsEvents, parseIcsEvents, patchEventCalendar, recurringEventTimeZoneId, respondToInvitation } from "../src/ical";

const context = {
  calendarId: "calendar-id",
  eventId: "event-id",
  selfEmail: "owner@example.com",
  etag: '"etag-1"',
};

const newYorkTimeZone = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VTIMEZONE\r
TZID:America/New_York\r
X-LIC-LOCATION:America/New_York\r
BEGIN:DAYLIGHT\r
DTSTART:19700308T020000\r
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU\r
TZOFFSETFROM:-0500\r
TZOFFSETTO:-0400\r
TZNAME:EDT\r
END:DAYLIGHT\r
BEGIN:STANDARD\r
DTSTART:19701101T020000\r
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU\r
TZOFFSETFROM:-0400\r
TZOFFSETTO:-0500\r
TZNAME:EST\r
END:STANDARD\r
END:VTIMEZONE\r
END:VCALENDAR`;

describe("iCalendar event model", () => {
  it.each([
    { name: "floating calendar time", parameter: "", suffix: "", zone: "America/New_York", start: "2026-10-20T13:00:00.000Z", end: "2026-10-20T14:00:00.000Z", local: "2026-10-20T09:00:00-04:00" },
    { name: "declared IANA time without VTIMEZONE", parameter: ";TZID=America/New_York", suffix: "", zone: "America/New_York", start: "2026-10-20T13:00:00.000Z", end: "2026-10-20T14:00:00.000Z", local: "2026-10-20T09:00:00-04:00" },
    { name: "declared zone before calendar fallback", parameter: ";TZID=America/Los_Angeles", suffix: "", zone: "America/Los_Angeles", start: "2026-10-20T16:00:00.000Z", end: "2026-10-20T17:00:00.000Z", local: "2026-10-20T09:00:00-07:00" },
    { name: "UTC instant with calendar display zone", parameter: "", suffix: "Z", zone: "America/New_York", start: "2026-10-20T09:00:00.000Z", end: "2026-10-20T10:00:00.000Z", local: "2026-10-20T05:00:00-04:00" },
  ])("resolves $name before canonical serialization", ({ parameter, suffix, zone, start, end, local }) => {
    const source = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:zone-fixture",
      `DTSTART${parameter}:20261020T090000${suffix}`, `DTEND${parameter}:20261020T100000${suffix}`,
      `RECURRENCE-ID${parameter}:20261020T090000${suffix}`, "CREATED:20261001T120000Z", "SUMMARY:Review", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    expect(parseIcsEvents(source, { ...context, defaultTimeZone: "America/New_York" })[0]).toMatchObject({
      start, end, startLocal: local, timeZone: zone, recurrenceId: start, created: "2026-10-01T12:00:00.000Z", allDay: false,
    });
  });

  it("creates and parses recurring events with attendees and reminders", () => {
    const built = buildEventCalendar({
      title: "Weekly review",
      start: "2026-08-27T09:00:00-04:00",
      end: "2026-08-27T09:30:00-04:00",
      location: "Studio",
      description: "Review the current cut",
      attendees: [{ email: "editor@example.com", name: "Editor", role: "required" }],
      reminders: [{ minutesBefore: 15 }],
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TH"],
      availability: "busy",
    }, "owner@example.com", {
      now: new Date("2026-08-26T17:00:00Z"),
      uid: "event-uid",
      defaultTimeZone: "America/New_York",
      timeZoneData: newYorkTimeZone,
    });

    const event = parseIcsEvents(built.data, { ...context, defaultTimeZone: "America/New_York" })[0];
    expect(built.filename).toBe("event-uid.ics");
    expect(event).toMatchObject({
      uid: "event-uid",
      title: "Weekly review",
      start: "2026-08-27T13:00:00.000Z",
      end: "2026-08-27T13:30:00.000Z",
      timeZone: "America/New_York",
      startLocal: "2026-08-27T09:00:00-04:00",
      endLocal: "2026-08-27T09:30:00-04:00",
      allDay: false,
      availability: "busy",
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TH"],
      organizer: { email: "owner@example.com" },
      attendees: [{ email: "editor@example.com", name: "Editor", role: "required", status: "needs-action", isSelf: false }],
      reminders: [{ action: "display", minutesBefore: 15, description: "Weekly review" }],
      etag: '"etag-1"',
    });
    expect(built.data).toContain("DTSTART;TZID=America/New_York:20260827T090000");
    expect(built.data).toContain("DTEND;TZID=America/New_York:20260827T093000");
  });

  it("preserves unknown calendar data while patching modeled fields", () => {
    const source = `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//Fixture//EN\r
X-WR-CALNAME:Private\r
BEGIN:VTIMEZONE\r
TZID:America/New_York\r
END:VTIMEZONE\r
BEGIN:VEVENT\r
UID:fixture-1\r
DTSTAMP:20260826T120000Z\r
DTSTART:20260827T130000Z\r
DTEND:20260827T140000Z\r
SUMMARY:Old title\r
DESCRIPTION:Old description\r
X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC\r
END:VEVENT\r
END:VCALENDAR`;
    const patched = patchEventCalendar(source, {
      title: "New title",
      description: null,
      location: "Screening room",
      reminders: [{ minutesBefore: 30 }],
    }, "owner@example.com", new Date("2026-08-26T18:00:00Z"));

    expect(patched).toContain("X-WR-CALNAME:Private");
    expect(patched).toContain("BEGIN:VTIMEZONE");
    expect(patched).toContain("X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC");
    expect(patched).toContain("SUMMARY:New title");
    expect(patched).not.toContain("DESCRIPTION:Old description");
    expect(patched).toContain("LOCATION:Screening room");
    expect(patched).toContain("SEQUENCE:1");
    expect(patched).toContain("TRIGGER:-PT30M");
  });

  it("preserves attachments and unsupported alarms during unrelated updates", () => {
    const source = `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//Fixture//EN\r
BEGIN:VEVENT\r
UID:fixture-attachments\r
DTSTAMP:20260826T120000Z\r
DTSTART:20260827T130000Z\r
DTEND:20260827T140000Z\r
SUMMARY:Original title\r
ATTACH;FMTTYPE=application/pdf:https://example.com/private/document.pdf\r
BEGIN:VALARM\r
ACTION:AUDIO\r
TRIGGER:-PT10M\r
END:VALARM\r
END:VEVENT\r
END:VCALENDAR`;
    const patched = patchEventCalendar(source, { title: "Updated title" }, "owner@example.com");

    expect(patched).toContain("ATTACH;FMTTYPE=application/pdf:https://example.com/private/document.pdf");
    expect(patched).toContain("ACTION:AUDIO");
    expect(patched).toContain("TRIGGER:-PT10M");
  });

  it("keeps recurring wall-clock time stable across daylight-saving changes", () => {
    const built = buildEventCalendar({
      title: "Weekly review",
      start: "2026-10-29T09:00:00-04:00",
      end: "2026-10-29T09:30:00-04:00",
      timeZone: "America/New_York",
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TH"],
    }, "owner@example.com", {
      uid: "dst-series",
      defaultTimeZone: "America/New_York",
    });
    const root = ICAL.Component.fromString(built.data);
    const component = root.getFirstSubcomponent("vevent");
    expect(component).not.toBeNull();
    const event = new ICAL.Event(component ?? undefined);
    const iterator = event.iterator();
    iterator.next();
    const afterDst = iterator.next();

    expect(calendarTimeZoneId(newYorkTimeZone)).toBe("America/New_York");
    expect(built.data).toContain("BEGIN:VTIMEZONE");
    expect(built.data).toContain("TZID:America/New_York");
    expect(afterDst?.toString()).toBe("2026-11-05T09:00:00");
    expect(new Date((afterDst?.toUnixTime() ?? 0) * 1000).toISOString()).toBe("2026-11-05T14:00:00.000Z");
  });

  it("supplies timezone definitions for explicit IANA zones", () => {
    const built = buildEventCalendar({
      title: "London call",
      start: "2026-10-22T09:00:00+01:00",
      end: "2026-10-22T09:30:00+01:00",
      timeZone: "Europe/London",
      recurrence: ["RRULE:FREQ=WEEKLY;COUNT=2"],
    }, "owner@example.com", { uid: "london-series" });
    const root = ICAL.Component.fromString(built.data);
    const event = new ICAL.Event(root.getFirstSubcomponent("vevent") ?? undefined);
    const iterator = event.iterator();
    iterator.next();
    const afterDst = iterator.next();

    expect(built.data).toContain("TZID:Europe/London");
    expect(afterDst?.toString()).toBe("2026-10-29T09:00:00");
    expect(new Date((afterDst?.toUnixTime() ?? 0) * 1000).toISOString()).toBe("2026-10-29T09:00:00.000Z");
  });

  it("normalizes iCloud-expanded recurrence wall times using the source timezone", () => {
    const source = buildEventCalendar({
      title: "DST canary",
      start: "2026-10-29T09:00:00-04:00",
      end: "2026-10-29T09:30:00-04:00",
      timeZone: "America/New_York",
      recurrence: ["RRULE:FREQ=WEEKLY;COUNT=2"],
    }, "owner@example.com", { uid: "expanded-series" }).data;
    const expanded = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:expanded-series\r
DTSTART:20261029T090000Z\r
DTEND:20261029T093000Z\r
RECURRENCE-ID:20261029T130000Z\r
SUMMARY:DST canary\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:expanded-series\r
DTSTART:20261105T090000Z\r
DTEND:20261105T093000Z\r
RECURRENCE-ID:20261105T140000Z\r
SUMMARY:DST canary\r
END:VEVENT\r
END:VCALENDAR`;
    const events = parseExpandedIcsEvents(expanded, source, { ...context, defaultTimeZone: "America/New_York" }, "America/New_York");
    const normalizedSource = source
      .replace("DTSTART;TZID=America/New_York:20261029T090000", "DTSTART:20261029T130000Z")
      .replace("DTEND;TZID=America/New_York:20261029T093000", "DTEND:20261029T133000Z");

    expect(recurringEventTimeZoneId(source, "UTC")).toBe("America/New_York");
    expect(recurringEventTimeZoneId(normalizedSource, "UTC")).toBe("America/New_York");
    expect(events.map(({ start, startLocal, recurrenceId }) => ({ start, startLocal, recurrenceId }))).toEqual([
      { start: "2026-10-29T13:00:00.000Z", startLocal: "2026-10-29T09:00:00-04:00", recurrenceId: "2026-10-29T13:00:00.000Z" },
      { start: "2026-11-05T14:00:00.000Z", startLocal: "2026-11-05T09:00:00-05:00", recurrenceId: "2026-11-05T14:00:00.000Z" },
    ]);

    const movedSource = source.replace("END:VCALENDAR", `BEGIN:VEVENT\r
UID:expanded-series\r
DTSTART;TZID=America/New_York:20261105T110000\r
DTEND;TZID=America/New_York:20261105T113000\r
RECURRENCE-ID;TZID=America/New_York:20261105T090000\r
SUMMARY:Moved DST canary\r
END:VEVENT\r
END:VCALENDAR`);
    const movedExpanded = expanded
      .replace("DTSTART:20261105T090000Z", "DTSTART:20261105T110000Z")
      .replace("DTEND:20261105T093000Z", "DTEND:20261105T113000Z");
    const moved = parseExpandedIcsEvents(movedExpanded, movedSource, { ...context, defaultTimeZone: "America/New_York" }, "America/New_York");
    expect(moved[1]).toMatchObject({
      start: "2026-11-05T16:00:00.000Z",
      end: "2026-11-05T16:30:00.000Z",
      startLocal: "2026-11-05T11:00:00-05:00",
      recurrenceId: "2026-11-05T14:00:00.000Z",
    });
  });

  it("uses canonical timestamps for non-recurring expanded events", () => {
    const source = buildEventCalendar({ title: "Screening", start: "2026-10-20T18:00:00-04:00", end: "2026-10-20T20:25:00-04:00", timeZone: "America/New_York" }, "owner@example.com").data;
    const expanded = source.replace("DTSTART;TZID=America/New_York:20261020T180000", "DTSTART:20261020T180000Z").replace("DTEND;TZID=America/New_York:20261020T202500", "DTEND:20261020T202500Z");
    expect(parseExpandedIcsEvents(expanded, source, context)[0]).toMatchObject({ start: "2026-10-20T22:00:00.000Z", end: "2026-10-21T00:25:00.000Z", startLocal: "2026-10-20T18:00:00-04:00" });
  });

  it("normalizes mixed expanded all-day recurrence types before date arithmetic", () => {
    const source = buildEventCalendar({ title: "Monthly reminder", start: "2026-09-20", end: "2026-09-21", allDay: true, recurrence: ["RRULE:FREQ=MONTHLY"] }, "owner@example.com").data;
    const expanded = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:all-day-fixture\r
DTSTART;VALUE=DATE:20261020\r
DTEND;VALUE=DATE:20261021\r
RECURRENCE-ID:20261020T000000Z\r
SUMMARY:Monthly reminder\r
END:VEVENT\r
END:VCALENDAR`;
    expect(parseExpandedIcsEvents(expanded, source, context)[0]).toMatchObject({ start: "2026-10-20", end: "2026-10-21", recurrenceId: "2026-10-20", allDay: true });
    const timedExpansion = expanded.replace("DTSTART;VALUE=DATE:20261020", "DTSTART:20261020T000000Z").replace("DTEND;VALUE=DATE:20261021", "DTEND:20261021T000000Z");
    expect(parseExpandedIcsEvents(timedExpansion, source, context)[0]).toMatchObject({ start: "2026-10-20", end: "2026-10-21", recurrenceId: "2026-10-20", allDay: true });
  });

  it("preserves moved all-day exceptions and exclusive multiday ends", () => {
    const source = buildEventCalendar({ title: "Trip", start: "2026-09-20", end: "2026-09-23", allDay: true, recurrence: ["RRULE:FREQ=MONTHLY"] }, "owner@example.com").data;
    const moved = patchEventCalendar(source, { start: "2026-10-22", end: "2026-10-26", allDay: true }, "owner@example.com", new Date("2026-09-01T00:00:00Z"), "this_instance", "2026-10-20");
    const expanded = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:all-day-fixture\r
DTSTART:20261022T000000Z\r
DTEND:20261026T000000Z\r
RECURRENCE-ID:20261020T000000Z\r
SUMMARY:Trip\r
END:VEVENT\r
END:VCALENDAR`;
    expect(parseExpandedIcsEvents(expanded, moved, context)[0]).toMatchObject({ start: "2026-10-22", end: "2026-10-26", recurrenceId: "2026-10-20", allDay: true });
    expect(parseExpandedIcsEvents(expanded, source, context)[0]).toMatchObject({ start: "2026-10-20", end: "2026-10-23", recurrenceId: "2026-10-20", allDay: true });
  });

  it("preserves timed exceptions to all-day series and inherited expanded metadata", () => {
    const source = buildEventCalendar({
      title: "Monthly review", start: "2026-09-20", end: "2026-09-21", allDay: true,
      recurrence: ["RRULE:FREQ=MONTHLY"],
    }, "owner@example.com", { uid: "type-changing-series" }).data;
    const moved = patchEventCalendar(source, {
      allDay: false, start: "2026-10-20T14:00:00-07:00", end: "2026-10-20T15:00:00-07:00", timeZone: "America/Los_Angeles",
    }, "owner@example.com", new Date("2026-09-01T00:00:00Z"), "this_instance", "2026-10-20");
    const root = ICAL.Component.fromString(moved);
    const exception = root.getAllSubcomponents("vevent")[1];
    exception?.removeAllProperties("summary");
    const expanded = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:type-changing-series\r
DTSTART:20261020T140000Z\r
DTEND:20261020T150000Z\r
RECURRENCE-ID:20261020T000000Z\r
SUMMARY:Monthly review\r
BEGIN:VALARM\r
ACTION:DISPLAY\r
TRIGGER:-PT15M\r
DESCRIPTION:Reminder\r
END:VALARM\r
END:VEVENT\r
END:VCALENDAR`;
    expect(parseExpandedIcsEvents(expanded, root.toString(), context, "America/New_York")[0]).toMatchObject({
      title: "Monthly review", allDay: false,
      start: "2026-10-20T21:00:00.000Z", end: "2026-10-20T22:00:00.000Z",
      timeZone: "America/Los_Angeles", startLocal: "2026-10-20T14:00:00-07:00", endLocal: "2026-10-20T15:00:00-07:00",
      recurrenceId: "2026-10-20", reminders: [{ action: "display", minutesBefore: 15, description: "Reminder" }],
    });
  });

  it("preserves all-day exceptions to timed series without stale local timestamps", () => {
    const source = buildEventCalendar({
      title: "Weekly review", start: "2026-10-20T09:00:00-04:00", end: "2026-10-20T10:00:00-04:00", timeZone: "America/New_York",
      recurrence: ["RRULE:FREQ=WEEKLY"],
    }, "owner@example.com", { uid: "timed-series" }).data;
    const moved = patchEventCalendar(source, {
      allDay: true, start: "2026-10-28", end: "2026-10-30",
    }, "owner@example.com", new Date("2026-10-01T00:00:00Z"), "this_instance", "2026-10-27T13:00:00Z");
    const expanded = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:timed-series\r
DTSTART:20261028T000000Z\r
DTEND:20261030T000000Z\r
RECURRENCE-ID:20261027T130000Z\r
SUMMARY:Weekly review\r
END:VEVENT\r
END:VCALENDAR`;
    const event = parseExpandedIcsEvents(expanded, moved, context, "America/New_York")[0];
    expect(event).toMatchObject({ allDay: true, start: "2026-10-28", end: "2026-10-30", recurrenceId: "2026-10-27T13:00:00.000Z" });
    expect(event).not.toHaveProperty("timeZone");
    expect(event).not.toHaveProperty("startLocal");
    expect(event).not.toHaveProperty("endLocal");
  });

  it("uses a timed exception's zone instead of the series zone", () => {
    const source = buildEventCalendar({
      title: "Weekly review", start: "2026-10-20T09:00:00-04:00", end: "2026-10-20T10:00:00-04:00", timeZone: "America/New_York",
      recurrence: ["RRULE:FREQ=WEEKLY"],
    }, "owner@example.com", { uid: "zone-changing-series" }).data;
    const moved = patchEventCalendar(source, {
      start: "2026-10-27T14:00:00-07:00", end: "2026-10-27T15:00:00-07:00", timeZone: "America/Los_Angeles",
    }, "owner@example.com", new Date("2026-10-01T00:00:00Z"), "this_instance", "2026-10-27T13:00:00Z");
    const expanded = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:zone-changing-series\r
DTSTART:20261027T140000Z\r
DTEND:20261027T150000Z\r
RECURRENCE-ID:20261027T130000Z\r
SUMMARY:Weekly review\r
END:VEVENT\r
END:VCALENDAR`;
    expect(parseExpandedIcsEvents(expanded, moved, context, "America/New_York")[0]).toMatchObject({
      allDay: false, start: "2026-10-27T21:00:00.000Z", end: "2026-10-27T22:00:00.000Z",
      timeZone: "America/Los_Angeles", startLocal: "2026-10-27T14:00:00-07:00", endLocal: "2026-10-27T15:00:00-07:00",
      recurrenceId: "2026-10-27T13:00:00.000Z",
    });
  });

  it.each([
    {
      title: "all-day range duration", allDay: true,
      patch: { allDay: true, start: "2026-10-27", end: "2026-10-30" },
      identity: "2026-10-27", laterIdentity: "20261110",
      expandedStart: "20261110", expandedEnd: "20261113",
      expected: { allDay: true, start: "2026-11-10", end: "2026-11-13", recurrenceId: "2026-11-10" }
    },
    {
      title: "all-day to timed range across DST", allDay: true,
      patch: { allDay: false, start: "2026-10-27T14:00:00-04:00", end: "2026-10-27T15:00:00-04:00", timeZone: "America/New_York" },
      identity: "2026-10-27", laterIdentity: "20261110",
      expandedStart: "20261110T140000Z", expandedEnd: "20261110T150000Z",
      expected: { allDay: false, start: "2026-11-10T19:00:00.000Z", end: "2026-11-10T20:00:00.000Z", startLocal: "2026-11-10T14:00:00-05:00", recurrenceId: "2026-11-10" }
    },
    {
      title: "timed to all-day range with a start shift", allDay: false,
      patch: { allDay: true, start: "2026-10-28", end: "2026-10-29" },
      identity: "2026-10-27T13:00:00Z", laterIdentity: "20261110T140000Z",
      expandedStart: "20261111", expandedEnd: "20261112",
      expected: { allDay: true, start: "2026-11-11", end: "2026-11-12", recurrenceId: "2026-11-10T14:00:00.000Z" }
    },
    {
      title: "timed range with a different zone across DST", allDay: false,
      patch: { allDay: false, start: "2026-10-27T14:00:00-07:00", end: "2026-10-27T15:00:00-07:00", timeZone: "America/Los_Angeles" },
      identity: "2026-10-27T13:00:00Z", laterIdentity: "20261110T140000Z",
      expandedStart: "20261110T140000Z", expandedEnd: "20261110T150000Z",
      expected: { allDay: false, start: "2026-11-10T22:00:00.000Z", end: "2026-11-10T23:00:00.000Z", startLocal: "2026-11-10T14:00:00-08:00", timeZone: "America/Los_Angeles", recurrenceId: "2026-11-10T14:00:00.000Z" }
    },
  ])("preserves effective $title on later provider-selected occurrences", ({ allDay, patch, identity, laterIdentity, expandedStart, expandedEnd, expected }) => {
    const source = buildEventCalendar({
      title: "Weekly review", start: allDay ? "2026-10-20" : "2026-10-20T09:00:00-04:00", end: allDay ? "2026-10-21" : "2026-10-20T10:00:00-04:00", allDay,
      ...(allDay ? {} : { timeZone: "America/New_York" }), recurrence: ["RRULE:FREQ=WEEKLY"],
    }, "owner@example.com", { uid: "range-series" }).data;
    const changed = patchEventCalendar(source, patch, "owner@example.com", new Date("2026-10-01T00:00:00Z"), "this_and_following", identity).replace("RANGE=THISANDFUTURE", "RANGE=thisandfuture");
    const property = (name: string, value: string) => `${name}${value.length === 8 ? ";VALUE=DATE" : ""}:${value}`;
    const expanded = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:range-series", property("DTSTART", expandedStart), property("DTEND", expandedEnd), property("RECURRENCE-ID", laterIdentity), "SUMMARY:Weekly review", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const event = parseExpandedIcsEvents(expanded, changed, context, "America/New_York")[0];
    expect(event).toMatchObject(expected);
    if (expected.allDay) expect(event).not.toHaveProperty("startLocal");
  });

  it("prefers exact exceptions and the latest applicable range", () => {
    const source = buildEventCalendar({ title: "Weekly review", start: "2026-10-20", end: "2026-10-21", allDay: true, recurrence: ["RRULE:FREQ=WEEKLY"] }, "owner@example.com", { uid: "multiple-ranges" }).data;
    const first = patchEventCalendar(source, { start: "2026-10-27", end: "2026-10-30" }, "owner@example.com", new Date("2026-10-01T00:00:00Z"), "this_and_following", "2026-10-27");
    const latest = patchEventCalendar(first, { start: "2026-11-03", end: "2026-11-08" }, "owner@example.com", new Date("2026-10-01T00:00:00Z"), "this_and_following", "2026-11-03");
    const exact = patchEventCalendar(latest, { start: "2026-11-12", end: "2026-11-14" }, "owner@example.com", new Date("2026-10-01T00:00:00Z"), "this_instance", "2026-11-10");
    const expanded = ["BEGIN:VCALENDAR", "VERSION:2.0", ...["20261110", "20261117"].flatMap((id) => ["BEGIN:VEVENT", "UID:multiple-ranges", `DTSTART;VALUE=DATE:${id}`, `DTEND;VALUE=DATE:${id}`, `RECURRENCE-ID;VALUE=DATE:${id}`, "SUMMARY:Weekly review", "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");
    expect(parseExpandedIcsEvents(expanded, exact, context).map(({ start, end, recurrenceId }) => ({ start, end, recurrenceId }))).toEqual([
      { start: "2026-11-12", end: "2026-11-14", recurrenceId: "2026-11-10" },
      { start: "2026-11-17", end: "2026-11-22", recurrenceId: "2026-11-17" },
    ]);
  });

  it.each([
    { zone: "America/New_York", offset: "-04:00", recurrenceId: "2026-10-27T13:00:00.000Z", start: "2026-10-27T15:00:00.000Z" },
    { zone: "America/Los_Angeles", offset: "-07:00", recurrenceId: "2026-10-27T16:00:00.000Z", start: "2026-10-27T18:00:00.000Z" },
  ])("normalizes expanded recurrence identity before matching moved $zone exceptions", ({ zone, offset, recurrenceId, start }) => {
    const source = buildEventCalendar({
      title: "Weekly review", start: `2026-10-20T09:00:00${offset}`, end: `2026-10-20T10:00:00${offset}`, timeZone: zone, recurrence: ["RRULE:FREQ=WEEKLY"],
    }, "owner@example.com", { uid: "identity-zone" }).data;
    const moved = patchEventCalendar(source, {
      start: `2026-10-27T11:00:00${offset}`, end: `2026-10-27T12:00:00${offset}`, timeZone: zone,
    }, "owner@example.com", new Date("2026-10-01T00:00:00Z"), "this_instance", recurrenceId);
    const root = ICAL.Component.fromString(moved);
    root.removeAllSubcomponents("vtimezone");
    for (const parameter of ["", `;TZID=${zone}`]) {
      const expanded = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:identity-zone", "DTSTART:20261027T110000Z", "DTEND:20261027T120000Z", `RECURRENCE-ID${parameter}:20261027T090000`, "SUMMARY:Weekly review", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
      expect(parseExpandedIcsEvents(expanded, root.toString(), { ...context, defaultTimeZone: "America/New_York" }, zone)[0]).toMatchObject({
        start, recurrenceId, timeZone: zone, startLocal: `2026-10-27T11:00:00${offset}`,
      });
    }
  });

  it("uses the resolved recurrence zone for normalized UTC range masters across DST", () => {
    const source = buildEventCalendar({
      title: "Weekly review", start: "2026-10-20T09:00:00-04:00", end: "2026-10-20T10:00:00-04:00", timeZone: "America/New_York", recurrence: ["RRULE:FREQ=WEEKLY"],
    }, "owner@example.com", { uid: "normalized-range" }).data;
    const changed = patchEventCalendar(source, {
      start: "2026-10-27T14:00:00-07:00", end: "2026-10-27T15:00:00-07:00", timeZone: "America/Los_Angeles",
    }, "owner@example.com", new Date("2026-10-01T00:00:00Z"), "this_and_following", "2026-10-27T13:00:00Z");
    const normalized = changed
      .replace("DTSTART;TZID=America/New_York:20261020T090000", "DTSTART:20261020T130000Z")
      .replace("DTEND;TZID=America/New_York:20261020T100000", "DTEND:20261020T140000Z");
    const expanded = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:normalized-range", "DTSTART:20261110T140000Z", "DTEND:20261110T150000Z", "RECURRENCE-ID:20261110T140000Z", "SUMMARY:Weekly review", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    for (const data of [changed, normalized]) {
      const zone = recurringEventTimeZoneId(data, "UTC");
      expect(zone).toBe("America/New_York");
      expect(parseExpandedIcsEvents(expanded, data, context, zone)[0]).toMatchObject({
        start: "2026-11-10T22:00:00.000Z", end: "2026-11-10T23:00:00.000Z", startLocal: "2026-11-10T14:00:00-08:00", timeZone: "America/Los_Angeles",
      });
    }
  });

  it("reads, writes, clears, and otherwise preserves Apple structured locations", () => {
    const built = buildEventCalendar({
      title: "Appointment",
      start: "2026-08-27T14:30:00-04:00",
      end: "2026-08-27T16:15:00-04:00",
      structuredLocation: {
        title: "Perelman Center for Advanced Medicine",
        address: "3400 Civic Center Blvd, Philadelphia, PA 19104",
        latitude: 39.9474,
        longitude: -75.1936,
        radius: 75,
      },
    }, "owner@example.com", { uid: "location-1" });
    const event = parseIcsEvents(built.data, { ...context, defaultTimeZone: "America/New_York" })[0];

    expect(event).toMatchObject({
      location: "3400 Civic Center Blvd, Philadelphia, PA 19104",
      structuredLocation: {
        title: "Perelman Center for Advanced Medicine",
        address: "3400 Civic Center Blvd, Philadelphia, PA 19104",
        latitude: 39.9474,
        longitude: -75.1936,
        radius: 75,
      },
    });
    expect(built.data).toContain("X-APPLE-STRUCTURED-LOCATION;");
    expect(built.data).toContain("VALUE=URI:geo:39.9474,-75.1936");

    const renamed = patchEventCalendar(built.data, { title: "Renamed appointment" }, "owner@example.com");
    expect(renamed).toContain("X-APPLE-STRUCTURED-LOCATION;");
    const cleared = patchEventCalendar(renamed, { structuredLocation: null }, "owner@example.com");
    expect(cleared).not.toContain("X-APPLE-STRUCTURED-LOCATION;");
    expect(cleared).toContain("LOCATION:3400 Civic Center Blvd\\, Philadelphia\\, PA 19104");
  });

  it("updates only the authenticated attendee when responding", () => {
    const source = `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//Fixture//EN\r
BEGIN:VEVENT\r
UID:invite-1\r
DTSTAMP:20260826T120000Z\r
DTSTART:20260827T130000Z\r
DTEND:20260827T140000Z\r
SUMMARY:Invitation\r
ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:owner@example.com\r
ATTENDEE;PARTSTAT=ACCEPTED:mailto:other@example.com\r
END:VEVENT\r
END:VCALENDAR`;
    const updated = respondToInvitation(source, "owner@example.com", "tentative", new Date("2026-08-26T18:00:00Z"));
    const event = parseIcsEvents(updated, context)[0];

    expect(event?.attendees).toEqual([
      { email: "owner@example.com", role: "required", status: "tentative", isSelf: true },
      { email: "other@example.com", role: "required", status: "accepted", isSelf: false },
    ]);
  });

  it("keeps all-day events as exclusive date ranges", () => {
    const built = buildEventCalendar({
      title: "Away",
      start: "2026-09-01",
      end: "2026-09-03",
      allDay: true,
    }, "owner@example.com", { uid: "away-1" });
    expect(parseIcsEvents(built.data, context)[0]).toMatchObject({ start: "2026-09-01", end: "2026-09-03", allDay: true });
  });

  it("updates one occurrence without changing the recurring master", () => {
    const built = buildEventCalendar({
      title: "Weekly review",
      start: "2026-08-27T13:00:00Z",
      end: "2026-08-27T14:00:00Z",
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TH"],
    }, "owner@example.com", { uid: "series-1" });
    const updated = patchEventCalendar(
      built.data,
      { title: "Moved review", start: "2026-09-03T15:00:00Z", end: "2026-09-03T16:30:00Z" },
      "owner@example.com",
      new Date("2026-08-26T18:00:00Z"),
      "this_instance",
      "2026-09-03T13:00:00Z",
    );
    const [master, exception] = parseIcsEvents(updated, context);

    expect(master).toMatchObject({ title: "Weekly review", start: "2026-08-27T13:00:00.000Z", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TH"] });
    expect(exception).toMatchObject({
      title: "Moved review",
      start: "2026-09-03T15:00:00.000Z",
      end: "2026-09-03T16:30:00.000Z",
      recurrenceId: "2026-09-03T13:00:00.000Z",
      recurrence: [],
    });
  });

  it("cancels this and later occurrences with a range exception", () => {
    const built = buildEventCalendar({
      title: "Weekly review",
      start: "2026-08-27T13:00:00Z",
      end: "2026-08-27T14:00:00Z",
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TH"],
    }, "owner@example.com", { uid: "series-2" });
    const cancelled = cancelEventOccurrence(
      built.data,
      "2026-09-03T13:00:00Z",
      "this_and_following",
      new Date("2026-08-26T18:00:00Z"),
    );
    const events = parseIcsEvents(cancelled, context);

    expect(events[0]).toMatchObject({ status: "confirmed", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TH"] });
    expect(events[1]).toMatchObject({ status: "cancelled", recurrenceId: "2026-09-03T13:00:00.000Z", recurrence: [] });
    expect(cancelled).toContain("RECURRENCE-ID;RANGE=THISANDFUTURE:20260903T130000Z");
  });

  it("rejects unbounded recurrence input and ambiguous timed values", () => {
    expect(() => buildEventCalendar({ title: "Bad", start: "2026-09-01T09:00:00", end: "2026-09-01T10:00:00" }, "owner@example.com")).toThrow("explicit UTC offset");
    expect(() => buildEventCalendar({
      title: "Bad",
      start: "2026-09-01T09:00:00Z",
      end: "2026-09-01T10:00:00Z",
      recurrence: ["SUMMARY:Injected"],
    }, "owner@example.com")).toThrow("complete RRULE");
  });
});

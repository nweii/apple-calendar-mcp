// Exercises mutation recovery, recurring scope, and pagination through the CalDAV and MCP boundaries.

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEvent, deleteEvent, listEvents, RecoverableMutationError, respondToInvitation, updateEvent } from "../src/calendar";
import { createCalendarServer } from "../src/mcp";
import { encodeDavId } from "../src/security";

const dav = vi.hoisted(() => ({
  fetchCalendars: vi.fn(), fetchCalendarObjects: vi.fn(), createCalendarObject: vi.fn(),
  updateCalendarObject: vi.fn(), deleteCalendarObject: vi.fn(),
}));
vi.mock("tsdav", () => ({ createDAVClient: vi.fn(async () => dav) }));
const credentials = { username: "owner@example.com", password: "test-password", defaultTimeZone: "UTC" };
const calendarUrl = "https://caldav.icloud.com/calendars/test/";
const calendarId = encodeDavId(calendarUrl);
const eventId = encodeDavId(`${calendarUrl}event.ics`);
const selector = { calendarId, eventId, etag: '"1"' };
const draft = { title: "Lunch", start: "2026-11-13T12:00:00Z", end: "2026-11-13T13:00:00Z" };
function eventData(extra = "") {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test\r\nSUMMARY:Lunch\r\nDTSTART:20261113T120000Z\r\nDTEND:20261113T130000Z\r\nATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:owner@example.com\r\n${extra}END:VEVENT\r\nEND:VCALENDAR\r\n`;
}
function object(extra = "") { return { url: `${calendarUrl}event.ics`, etag: '"1"', data: eventData(extra) }; }

beforeEach(() => {
  vi.resetAllMocks();
  dav.fetchCalendars.mockResolvedValue([{ url: calendarUrl, components: ["VEVENT"] }]);
  dav.fetchCalendarObjects.mockResolvedValue([object()]);
  dav.createCalendarObject.mockResolvedValue(new Response(null, { status: 201 }));
  dav.updateCalendarObject.mockResolvedValue(new Response(null, { status: 204 }));
  dav.deleteCalendarObject.mockResolvedValue(new Response(null, { status: 204 }));
});

describe("mutation recovery", () => {
  it("returns the exact generated resource after a create transport failure without retrying", async () => {
    dav.createCalendarObject.mockRejectedValue(new Error("secret upstream payload"));
    const error = await createEvent(credentials, calendarId, draft).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(RecoverableMutationError);
    const filename = dav.createCalendarObject.mock.calls[0]![0].filename;
    expect(error).toMatchObject({ recovery: {
      code: "write_outcome_unknown", operation: "create", calendarId,
      eventId: encodeDavId(new URL(filename, calendarUrl).href), retrySafe: false,
    } });
    expect(JSON.stringify(error)).not.toContain("secret upstream payload");
    expect(dav.createCalendarObject).toHaveBeenCalledTimes(1);
  });

  it.each(["create", "update", "respond"] as const)("reports acknowledged %s writes when readback fails", async (operation) => {
    if (operation !== "create") dav.fetchCalendarObjects.mockResolvedValueOnce([object()]);
    dav.fetchCalendarObjects.mockRejectedValue(new Error("read failed"));
    const call = operation === "create" ? createEvent(credentials, calendarId, draft)
      : operation === "update" ? updateEvent(credentials, selector, { title: "Changed" })
      : respondToInvitation(credentials, selector, "accepted");
    await expect(call).rejects.toMatchObject({ recovery: { operation, code: "write_succeeded_readback_failed", retrySafe: false } });
    expect(operation === "create" ? dav.createCalendarObject : dav.updateCalendarObject).toHaveBeenCalledTimes(1);
  });

  it.each([408, 500, 503])("marks HTTP %i as an uncertain write", async (status) => {
    dav.deleteCalendarObject.mockResolvedValue(new Response(null, { status }));
    await expect(deleteEvent(credentials, selector)).rejects.toMatchObject({ recovery: { operation: "delete", code: "write_outcome_unknown", eventId } });
    expect(dav.deleteCalendarObject).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 404, 409, 412])("keeps HTTP %i rejection definitive", async (status) => {
    dav.updateCalendarObject.mockResolvedValue(new Response(null, { status }));
    const error = await updateEvent(credentials, selector, { title: "Changed" }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RecoverableMutationError);
    expect(dav.fetchCalendarObjects).toHaveBeenCalledTimes(1);
  });

  it("keeps preflight and stale ETag failures outside recovery", async () => {
    await expect(updateEvent(credentials, { ...selector, etag: '"stale"' }, { title: "Changed" })).rejects.toThrow("changed since");
    expect(dav.updateCalendarObject).not.toHaveBeenCalled();
    dav.fetchCalendars.mockRejectedValue(new Error("discovery failed"));
    await expect(createEvent(credentials, calendarId, draft)).rejects.toThrow("discovery failed");
    expect(dav.createCalendarObject).not.toHaveBeenCalled();
  });

  it("includes occurrence selectors for uncertain cancellation PUTs", async () => {
    dav.fetchCalendarObjects.mockResolvedValue([object("RRULE:FREQ=DAILY\r\n")]);
    dav.updateCalendarObject.mockRejectedValue(new Error("connection lost"));
    await expect(deleteEvent(credentials, selector, { scope: "this_instance", recurrenceId: draft.start })).rejects.toMatchObject({ recovery: {
      operation: "delete", scope: "this_instance", recurrenceId: draft.start, code: "write_outcome_unknown",
    } });
    expect(dav.updateCalendarObject).toHaveBeenCalledTimes(1);
    expect(dav.deleteCalendarObject).not.toHaveBeenCalled();
  });
});

describe("explicit recurring scope", () => {
  it.each(["RRULE:FREQ=DAILY\r\n", "RDATE:20261114T120000Z\r\n", "RECURRENCE-ID:20261113T120000Z\r\n"])("rejects omitted scope for %s", async (recurrence) => {
    dav.fetchCalendarObjects.mockResolvedValue([object(recurrence)]);
    await expect(updateEvent(credentials, selector, { title: "Changed" })).rejects.toThrow("updateScope is required");
    await expect(deleteEvent(credentials, selector)).rejects.toThrow("updateScope is required");
    expect(dav.updateCalendarObject).not.toHaveBeenCalled();
    expect(dav.deleteCalendarObject).not.toHaveBeenCalled();
  });

  it("allows omitted scope for one-time events and explicit whole-series deletion", async () => {
    await expect(deleteEvent(credentials, selector)).resolves.toMatchObject({ deleted: true });
    dav.fetchCalendarObjects.mockResolvedValue([object("RRULE:FREQ=DAILY\r\n")]);
    await expect(deleteEvent(credentials, selector, { scope: "entire_series" })).resolves.toMatchObject({ deleted: true });
  });

  it("rejects contradictory targets before writing", async () => {
    await expect(deleteEvent(credentials, selector, { recurrenceId: draft.start })).rejects.toThrow("requires this_instance");
    await expect(deleteEvent(credentials, selector, { scope: "entire_series", recurrenceId: draft.start })).rejects.toThrow("requires this_instance");
    await expect(deleteEvent(credentials, selector, { scope: "this_instance" })).rejects.toThrow("recurrenceId is required");
    expect(dav.deleteCalendarObject).not.toHaveBeenCalled();
    expect(dav.updateCalendarObject).not.toHaveBeenCalled();
  });
});

describe("pagination and MCP serialization", () => {
  it("returns every tied-time event over list pages in stable order", async () => {
    const events = ["z", "a", "m"].map((name) => ({ ...object(), url: `${calendarUrl}${name}.ics` }));
    dav.fetchCalendarObjects.mockResolvedValueOnce(events).mockResolvedValueOnce([...events].reverse());
    const first = await listEvents(credentials, calendarId, draft.start, "2026-11-14T00:00:00Z", 2);
    const last = await listEvents(credentials, calendarId, draft.start, "2026-11-14T00:00:00Z", 2, first.nextOffset);
    expect(first).toMatchObject({ total: 3, offset: 0, hasMore: true, nextOffset: 2 });
    expect(last).toMatchObject({ total: 3, offset: 2, hasMore: false });
    expect(last.nextOffset).toBeUndefined();
    expect(new Set([...first.events, ...last.events].map((event) => event.id)).size).toBe(3);
  });

  it("delivers recoverable JSON errors and accepts continuation offsets through MCP", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createCalendarServer({ ICLOUD_USERNAME: credentials.username, ICLOUD_APP_PASSWORD: credentials.password, CALENDAR_TIME_ZONE: "UTC" }, ["calendar:read", "calendar:write"]);
    const client = new Client({ name: "recovery-test", version: "1" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      dav.createCalendarObject.mockRejectedValue(new Error("test-password private error"));
      const response = await client.callTool({ name: "calendar_create_event", arguments: { calendarId, ...draft } });
      expect(response.isError).toBe(true);
      expect(response.structuredContent).toBeUndefined();
      expect(response.content).toEqual([expect.objectContaining({ type: "text", text: expect.stringContaining('"code":"write_outcome_unknown"') })]);
      expect(JSON.stringify(response)).not.toContain("test-password");
      for (const name of ["calendar_list_events", "calendar_search_events"]) {
        const page = await client.callTool({ name, arguments: { ...(name === "calendar_list_events" ? { calendarId } : { calendarIds: [calendarId] }), start: draft.start, end: "2026-11-14T00:00:00Z", offset: 10_001 } });
        expect(page.isError).not.toBe(true);
        expect(page.structuredContent).toMatchObject({ events: [], total: 1, offset: 10_001, hasMore: false });
      }
      const invalid = await client.callTool({ name: "calendar_delete_event", arguments: { ...selector, recurrenceId: draft.start } });
      expect(invalid.isError).toBe(true);
      expect(dav.deleteCalendarObject).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });
});

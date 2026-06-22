import { describe, expect, it } from "vitest";
import {
  createMessage,
  extractText,
  formatAddress,
  parseAddress,
} from "../src/index.ts";
import type { ConnectAddress, ContentPart } from "../src/index.ts";

const from: ConnectAddress = { host: "studio", persona: "nova" };
const to: ConnectAddress = { host: "work", persona: "wren" };

describe("createMessage", () => {
  it("fills id and timestamp imperatively", () => {
    const before = Date.now();
    const m = createMessage({ from, to, content: "hello" });
    expect(typeof m.id).toBe("string");
    expect(m.id.length).toBeGreaterThan(0);
    expect(m.timestamp).toBeGreaterThanOrEqual(before);
    expect(m.from).toEqual(from);
    expect(m.to).toEqual(to);
  });

  it("auto-wraps string content into a single text part", () => {
    const m = createMessage({ from, to, content: "hi there" });
    expect(m.content).toEqual([{ type: "text", text: "hi there" }]);
  });

  it("passes ContentPart[] through unchanged", () => {
    const parts: ContentPart[] = [
      { type: "text", text: "a" },
      { type: "image", url: "http://x/y.png", mimeType: "image/png" },
    ];
    const m = createMessage({ from, to, content: parts });
    expect(m.content).toBe(parts);
  });

  it("honors an explicit id and timestamp", () => {
    const m = createMessage({ from, to, content: "x", id: "fixed", timestamp: 42 });
    expect(m.id).toBe("fixed");
    expect(m.timestamp).toBe(42);
  });

  it("generates distinct ids across calls", () => {
    const a = createMessage({ from, to, content: "x" });
    const b = createMessage({ from, to, content: "x" });
    expect(a.id).not.toBe(b.id);
  });

  it("omits optional fields that are not provided (exactOptionalPropertyTypes)", () => {
    const m = createMessage({ from, to, content: "x" });
    expect("conversationId" in m).toBe(false);
    expect("replyTo" in m).toBe(false);
    expect("transportMeta" in m).toBe(false);
  });

  it("carries optional fields when provided", () => {
    const m = createMessage({
      from,
      to,
      content: "x",
      conversationId: "conv-1",
      replyTo: "m0",
      isGroup: true,
      isMentioned: false,
      transportMeta: { clientId: "abc" },
    });
    expect(m.conversationId).toBe("conv-1");
    expect(m.replyTo).toBe("m0");
    expect(m.isGroup).toBe(true);
    expect(m.isMentioned).toBe(false);
    expect(m.transportMeta).toEqual({ clientId: "abc" });
  });
});

describe("extractText", () => {
  it("concatenates text parts with newlines, skipping non-text", () => {
    const parts: ContentPart[] = [
      { type: "text", text: "line1" },
      { type: "image", url: "u", mimeType: "image/png" },
      { type: "text", text: "line2" },
    ];
    expect(extractText(parts)).toBe("line1\nline2");
  });

  it("returns empty string when there are no text parts", () => {
    expect(extractText([{ type: "reaction", emoji: "👍", targetMessageId: "m1" }])).toBe("");
  });
});

describe("ConnectAddress parse/format round-trip", () => {
  it("round-trips a session-scoped address (scope implicit)", () => {
    const a: ConnectAddress = { host: "studio", persona: "nova" };
    const s = formatAddress(a);
    expect(s).toBe("nova@studio");
    expect(parseAddress(s)).toEqual(a);
  });

  it("round-trips a scoped address", () => {
    const a: ConnectAddress = { host: "work", persona: "wren", scope: "project" };
    const s = formatAddress(a);
    expect(s).toBe("wren@work#project");
    expect(parseAddress(s)).toEqual(a);
  });

  it("treats an explicit session scope as the implicit default (stable round-trip)", () => {
    const a: ConnectAddress = { host: "studio", persona: "nova", scope: "session" };
    const s = formatAddress(a);
    expect(s).toBe("nova@studio"); // session is not appended
    const parsed = parseAddress(s);
    expect(parsed).toEqual({ host: "studio", persona: "nova" });
    expect(formatAddress(parsed)).toBe(s); // format→parse→format is stable
  });

  it("round-trips every non-session scope", () => {
    for (const scope of ["global", "persona", "project", "directory"] as const) {
      const a: ConnectAddress = { host: "h", persona: "p", scope };
      expect(parseAddress(formatAddress(a))).toEqual(a);
    }
  });

  it("throws on a malformed address", () => {
    expect(() => parseAddress("nohost")).toThrow();
    expect(() => parseAddress("@host")).toThrow();
    expect(() => parseAddress("persona@")).toThrow();
    expect(() => parseAddress("a@b#bogus")).toThrow();
  });
});

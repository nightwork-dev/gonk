import { describe, expect, it, vi } from "vitest";
import {
  VerbPickerTuiComponent,
  type Verb,
  type PiTuiHostHooks,
  type VerbPickerTuiOptions,
} from "../src/verb-picker-tui.ts";
import type { PiTheme } from "../src/pi-types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTheme(): PiTheme {
  // Stub: returns text as-is so assertions work on plain strings.
  return {
    fg: (_color: string, text: string) => text,
  };
}

const VERBS: readonly Verb[] = [
  { id: "listen", description: "Record from mic until silence" },
  { id: "speak", label: "speak", description: "Synthesize and play TTS", requiresArg: true, exampleArg: "Hello world" },
  { id: "recall", description: "Semantic search", requiresArg: true, exampleArg: "my query" },
];

function makeOpts(
  overrides: Partial<VerbPickerTuiOptions> = {},
): VerbPickerTuiOptions {
  return {
    verbs: VERBS,
    header: "Available test commands:",
    onSelect: vi.fn(),
    onCancel: vi.fn(),
    // Plain (no-ANSI) truncation; the stub theme emits no escapes, so a
    // string's length equals its visible width here.
    truncate: (t, w, _ellipsis, pad) =>
      t.length > w ? t.slice(0, w) : pad ? t.padEnd(w, " ") : t,
    ...overrides,
  };
}

function makeHooks(inputResult: string | undefined = "typed arg"): PiTuiHostHooks {
  return {
    input: vi.fn().mockResolvedValue(inputResult),
  };
}

// Key data strings that match the component's key detection.
const ENTER = "\r";
const ESC = "\x1b";
const UP = "\x1b[A";
const DOWN = "\x1b[B";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VerbPickerTuiComponent", () => {
  it("renders header, all verbs, and footer", () => {
    const comp = new VerbPickerTuiComponent(makeOpts(), makeTheme(), makeHooks());
    const lines = comp.render(80);
    const joined = lines.join("\n");

    expect(joined).toContain("Available test commands:");
    for (const verb of VERBS) {
      expect(joined).toContain(verb.description);
    }
    // Default footer
    expect(joined).toContain("↑↓ navigate · Enter run · q quit");
  });

  it("↑↓ moves cursor and render shows highlighted row", () => {
    const theme: PiTheme = {
      fg: (color, text) => (color === "accent" ? `[${text}]` : text),
    };
    const comp = new VerbPickerTuiComponent(makeOpts(), theme, makeHooks());

    // Initial state: cursor on first verb (listen)
    let lines = comp.render(80);
    let joined = lines.join("\n");
    expect(joined).toContain("[▶ ]"); // cursor indicator on first item

    // Move down to speak
    comp.handleInput(DOWN);
    lines = comp.render(80);
    joined = lines.join("\n");
    // cursor row should highlight "speak" in accent color
    expect(joined).toContain("[speak");

    // Move up back to listen
    comp.handleInput(UP);
    lines = comp.render(80);
    joined = lines.join("\n");
    expect(joined).toContain("[listen");
  });

  it("number key 1-9 selects verb at that position directly", () => {
    const onSelect = vi.fn();
    const comp = new VerbPickerTuiComponent(
      makeOpts({ onSelect, verbs: [
        { id: "alpha", description: "first" },
        { id: "beta", description: "second" },
        { id: "gamma", description: "third" },
      ] }),
      makeTheme(),
      makeHooks(),
    );

    // Press "2" — should move cursor to index 1 (beta) and select it
    comp.handleInput("2");
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "beta" }),
      undefined,
    );
  });

  it("Enter on a no-arg verb calls onSelect with undefined arg", () => {
    const onSelect = vi.fn();
    const comp = new VerbPickerTuiComponent(
      makeOpts({ onSelect }),
      makeTheme(),
      makeHooks(),
    );

    // Cursor starts on first verb (listen), which has no requiresArg
    comp.handleInput(ENTER);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "listen" }),
      undefined,
    );
  });

  it("Enter on a requiresArg verb calls hostHooks.input then onSelect with resolved string", async () => {
    const onSelect = vi.fn();
    const inputFn = vi.fn().mockResolvedValue("Hello world");
    const hooks: PiTuiHostHooks = { input: inputFn };

    const comp = new VerbPickerTuiComponent(
      makeOpts({ onSelect }),
      makeTheme(),
      hooks,
    );

    // Move to speak (index 1, requiresArg=true)
    comp.handleInput(DOWN);
    comp.handleInput(ENTER);

    // Give the Promise microtask queue a tick to resolve
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(inputFn).toHaveBeenCalledWith("speak", "Hello world");
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "speak" }),
      "Hello world",
    );
  });

  it("q key calls onCancel", () => {
    const onCancel = vi.fn();
    const comp = new VerbPickerTuiComponent(
      makeOpts({ onCancel }),
      makeTheme(),
      makeHooks(),
    );

    comp.handleInput("q");
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("Esc calls onCancel", () => {
    const onCancel = vi.fn();
    const comp = new VerbPickerTuiComponent(
      makeOpts({ onCancel }),
      makeTheme(),
      makeHooks(),
    );

    comp.handleInput(ESC);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("bounds every rendered line to the terminal width", () => {
    // pi-tui >=0.75.5 throws on any rendered line wider than the terminal.
    // A long verb description + a long header at a narrow width would have
    // slipped through the old no-op `_truncate`.
    const comp = new VerbPickerTuiComponent(
      makeOpts({
        header:
          "A very long header that definitely exceeds a narrow terminal width here",
        verbs: [
          {
            id: "viz",
            description:
              "Switch visualization mode (spectrograph|level|waveform|rainbow|pulse|meter)",
            requiresArg: true,
            exampleArg: "spectrograph",
          },
        ],
      }),
      makeTheme(),
      makeHooks(),
    );
    const width = 40;
    for (const line of comp.render(width)) {
      expect(line.length).toBeLessThanOrEqual(width);
    }
  });
});

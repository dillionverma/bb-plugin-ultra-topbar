import { describe, expect, it } from "vitest";
import { buildHandoffInput, DEFAULT_MESSAGE, mentionToken } from "./handoff";

const SOURCE = {
  id: "thr_z4bpq6z32q",
  projectId: "proj_6zu2snakxw",
  label: "is there any way to make a quick handoff button here?",
};

describe("buildHandoffInput", () => {
  it("produces the same text item the composer records for a typed mention", () => {
    // Offsets match a real `Continue from @thread:…` turn recorded by BB.
    expect(buildHandoffInput(DEFAULT_MESSAGE, SOURCE)).toEqual({
      type: "text",
      text: "Continue from @thread:thr_z4bpq6z32q",
      mentions: [
        {
          start: 14,
          end: 36,
          resource: {
            kind: "thread",
            threadId: "thr_z4bpq6z32q",
            projectId: "proj_6zu2snakxw",
            label: "is there any way to make a quick handoff button here?",
          },
        },
      ],
    });
  });

  it("falls back to the default message when the template is blank", () => {
    expect(buildHandoffInput("   \n", SOURCE).text).toBe(
      `Continue from ${mentionToken(SOURCE.id)}`,
    );
  });

  it("appends the mention when the template dropped the placeholder", () => {
    const input = buildHandoffInput("Pick up where this left off.", SOURCE);
    expect(input.text).toBe("Pick up where this left off. @thread:thr_z4bpq6z32q");
    expect(input.mentions).toEqual([
      expect.objectContaining({ start: 29, end: 51 }),
    ]);
  });

  it("expands every placeholder with its own offsets", () => {
    const input = buildHandoffInput("{thread} then reread {thread}", SOURCE);
    expect(input.text).toBe(
      "@thread:thr_z4bpq6z32q then reread @thread:thr_z4bpq6z32q",
    );
    expect(input.mentions.map(({ start, end }) => [start, end])).toEqual([
      [0, 22],
      [35, 57],
    ]);
    for (const mention of input.mentions) {
      expect(input.text.slice(mention.start, mention.end)).toBe(
        "@thread:thr_z4bpq6z32q",
      );
    }
  });
});

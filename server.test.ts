import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const SOURCE_ID = "thr_source";
const NEW_ID = "thr_next";

const EXECUTION = {
  model: "claude-opus-5",
  reasoningLevel: "high" as const,
  permissionMode: "auto" as const,
  serviceTier: "default" as const,
  source: "client/turn/requested" as const,
};

const EXPECTED_INPUT = [
  {
    type: "text",
    text: "Continue from @thread:thr_source",
    mentions: [
      {
        start: 14,
        end: 32,
        resource: {
          kind: "thread",
          threadId: SOURCE_ID,
          projectId: "proj_1",
          label: "Fix the flaky login test",
        },
      },
    ],
  },
];

async function setup(
  options: {
    thread?: Partial<Parameters<typeof makeThreadResponse>[0]>;
    execution?: typeof EXECUTION | null | (() => never);
    settings?: Record<string, string | boolean>;
    getFails?: boolean;
  } = {},
) {
  const thread = makeThreadResponse({
    id: SOURCE_ID,
    projectId: "proj_1",
    environmentId: "env_1",
    providerId: "claude-code",
    title: "Fix the flaky login test",
    ...options.thread,
  });
  const execution = options.execution === undefined ? EXECUTION : options.execution;
  const { bb, harness } = createFakePluginHost({
    pluginId: "handoff",
    ...(options.settings ? { settings: options.settings } : {}),
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => {
          if (options.getFails || threadId !== SOURCE_ID) {
            throw new Error(`Thread not found: ${threadId}`);
          }
          return thread;
        },
        defaultExecutionOptions: async () =>
          typeof execution === "function" ? execution() : execution,
        spawn: async () => makeThreadResponse({ id: NEW_ID, projectId: "proj_1" }),
      },
    },
  });
  await plugin(bb);
  const spawns = () =>
    harness.inspection.sdk
      .callsTo("threads.spawn")
      .map((args) => args[0] as Record<string, unknown>);
  return { harness, spawns };
}

describe("handoff rpc", () => {
  it("starts a successor in the same environment on the same agent, with a real mention", async () => {
    const { harness, spawns } = await setup();

    const result = await harness.behavior.callRpc("handoff", { threadId: SOURCE_ID });

    expect(result).toEqual({ threadId: NEW_ID });
    expect(spawns()).toEqual([
      {
        projectId: "proj_1",
        environment: { type: "reuse", environmentId: "env_1" },
        input: EXPECTED_INPUT,
        pluginMetadata: { sourceThreadId: SOURCE_ID },
        providerId: "claude-code",
        model: "claude-opus-5",
        reasoningLevel: "high",
        permissionMode: "auto",
        serviceTier: "default",
        executionInputSources: {
          providerId: "explicit",
          model: "explicit",
          reasoningLevel: "explicit",
          permissionMode: "explicit",
          serviceTier: "explicit",
        },
        origin: "plugin",
        originPluginId: "handoff",
      },
    ]);
  });

  it("uses the project default environment when the source has none", async () => {
    const { harness, spawns } = await setup({ thread: { environmentId: null } });
    await harness.behavior.callRpc("handoff", { threadId: SOURCE_ID });
    expect(spawns()[0]).toMatchObject({ environment: { type: "project-default" } });
  });

  it("labels the mention with the fallback title when none was set", async () => {
    const { harness, spawns } = await setup({
      thread: { title: null, titleFallback: "first prompt text" },
    });
    await harness.behavior.callRpc("handoff", { threadId: SOURCE_ID });
    expect(spawns()[0]).toMatchObject({
      input: [{ mentions: [{ resource: { label: "first prompt text" } }] }],
    });
  });

  it("keeps the provider but not the model when execution options are unknown", async () => {
    const { harness, spawns } = await setup({
      execution: () => {
        throw new Error("no runs yet");
      },
    });
    await harness.behavior.callRpc("handoff", { threadId: SOURCE_ID });
    const [spawn] = spawns();
    expect(spawn).toMatchObject({
      providerId: "claude-code",
      executionInputSources: { providerId: "explicit" },
    });
    expect(spawn).not.toHaveProperty("model");
    expect(spawn).not.toHaveProperty("permissionMode");
  });

  it("leaves the agent to the project defaults when reuse is off", async () => {
    const { harness, spawns } = await setup({ settings: { reuseAgent: false } });
    await harness.behavior.callRpc("handoff", { threadId: SOURCE_ID });
    const [spawn] = spawns();
    expect(spawn).not.toHaveProperty("providerId");
    expect(spawn).not.toHaveProperty("model");
    expect(spawn).not.toHaveProperty("executionInputSources");
    expect(harness.inspection.sdk.callsTo("threads.defaultExecutionOptions")).toEqual([]);
  });

  it("opens with the configured message", async () => {
    const { harness, spawns } = await setup({
      settings: { message: "Carry on from {thread}. Summarise first." },
    });
    await harness.behavior.callRpc("handoff", { threadId: SOURCE_ID });
    expect(spawns()[0]).toMatchObject({
      input: [
        {
          text: "Carry on from @thread:thr_source. Summarise first.",
          mentions: [{ start: 14, end: 32 }],
        },
      ],
    });
  });

  it("rejects with the lookup error and creates nothing", async () => {
    const { harness, spawns } = await setup({ getFails: true });
    await expect(
      harness.behavior.callRpc("handoff", { threadId: SOURCE_ID }),
    ).rejects.toThrow("Thread not found: thr_source");
    expect(spawns()).toEqual([]);
  });
});

describe("bb handoff", () => {
  it("hands off the current thread by default", async () => {
    const { harness, spawns } = await setup();
    const result = await harness.behavior.runCli([], { threadId: SOURCE_ID });
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "Handed off thr_source to thr_next\n",
    });
    expect(spawns()).toHaveLength(1);
  });

  it("accepts an explicit thread id and --json", async () => {
    const { harness } = await setup();
    const result = await harness.behavior.runCli([SOURCE_ID, "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout ?? "")).toEqual({
      sourceThreadId: SOURCE_ID,
      threadId: NEW_ID,
    });
  });

  it("previews the request with --dry-run and creates nothing", async () => {
    const { harness, spawns } = await setup();
    const result = await harness.behavior.runCli(["--dry-run"], { threadId: SOURCE_ID });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "Project:      proj_1",
        "Environment:  env_1",
        "Agent:        claude-code / claude-opus-5 / high / auto",
        "Message:      Continue from @thread:thr_source",
        "",
      ].join("\n"),
    );
    expect(spawns()).toEqual([]);

    const asJson = await harness.behavior.runCli(["--dry-run", "--json"], {
      threadId: SOURCE_ID,
    });
    expect(JSON.parse(asJson.stdout ?? "")).toMatchObject({
      sourceThreadId: SOURCE_ID,
      plan: { projectId: "proj_1", input: EXPECTED_INPUT },
    });
  });

  it("explains when there is no thread to hand off", async () => {
    const { harness, spawns } = await setup();
    const result = await harness.behavior.runCli([]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("No thread to hand off");
    expect(spawns()).toEqual([]);
  });

  it("prints usage for unknown flags or extra arguments", async () => {
    const { harness } = await setup();
    expect((await harness.behavior.runCli(["--bogus"])).exitCode).toBe(2);
    expect((await harness.behavior.runCli(["a", "b"])).exitCode).toBe(2);
    const help = await harness.behavior.runCli(["--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("Usage: bb handoff");
  });

  it("reports a failed handoff on stderr with exit 1", async () => {
    const { harness } = await setup({ getFails: true });
    const result = await harness.behavior.runCli(["thr_missing"]);
    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toBe(
      "Could not hand off thr_missing: Thread not found: thr_missing\n",
    );
  });
});

describe("handoff to another model", () => {
  it("validates on the source machine and uses the new model's reasoning default", async () => {
    const { harness, spawns } = await setup();
    harness.inspection.sdk.stub("providers.models", async () => ({ models: [{ model: "gpt-6", defaultReasoningEffort: "medium" }], modelLoadError: null }));
    try {
      await harness.behavior.callRpc("handoff", { threadId: SOURCE_ID, target: { providerId: "codex", model: "gpt-6" } });
      expect(harness.inspection.sdk.callsTo("providers.models")[0]).toEqual([{ environmentId: "env_1", providerId: "codex" }]);
      expect(spawns()[0]).toMatchObject({ environment: { type: "reuse", environmentId: "env_1" }, providerId: "codex", model: "gpt-6", reasoningLevel: "medium" });
      expect(spawns()[0]).not.toHaveProperty("permissionMode");
    } finally { await harness.lifecycle.dispose(); }
  });
  it("rejects a stale model before creating a successor", async () => {
    const { harness, spawns } = await setup();
    harness.inspection.sdk.stub("providers.models", async () => ({ models: [], modelLoadError: null }));
    try {
      await expect(harness.behavior.callRpc("handoff", { threadId: SOURCE_ID, target: { providerId: "codex", model: "removed" } })).rejects.toThrow("no longer available");
      expect(spawns()).toEqual([]);
    } finally { await harness.lifecycle.dispose(); }
  });
  it("accepts provider and model flags through the CLI", async () => {
    const { harness, spawns } = await setup();
    harness.inspection.sdk.stub("providers.models", async () => ({ models: [{ model: "gpt-6", defaultReasoningEffort: "medium" }], modelLoadError: null }));
    try {
      const result = await harness.behavior.runCli([SOURCE_ID, "--provider", "codex", "--model", "gpt-6", "--json"]);
      expect(result.exitCode).toBe(0);
      expect(spawns()[0]).toMatchObject({ providerId: "codex", model: "gpt-6" });
    } finally { await harness.lifecycle.dispose(); }
  });
});

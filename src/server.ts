// bb-plugin-handoff — backend entry.
//
// One job: `handoff` takes a thread and starts a fresh thread that continues
// it. The new thread reuses the source's project and environment and, by
// default, the provider, model, reasoning level and permission mode its
// prompts last ran with. It opens with the handoff message — a real @thread
// mention of the source — so the agent there reads the old transcript with
// the bb CLI and picks the work up on a clean context window.
//
// Reachable three ways: the header button (app.tsx) over RPC, `bb handoff`
// from a shell or an agent, and the skill in skills/handoff/SKILL.md.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { hostContract, prMethods } from "./pr-contract";
import { buildHandoffInput, DEFAULT_MESSAGE } from "./handoff";

export const rpcContract = defineRpcContract({
  ...prMethods,
  handoff: {
    input: z.object({ threadId: z.string().min(1), target: z.object({ providerId: z.string().min(1), model: z.string().min(1) }).optional() }),
    output: z.object({ threadId: z.string() }),
  },
});

type SpawnArgs = Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0];

const USAGE = [
  "Usage: bb handoff [thread-id] [--provider ID --model ID] [--dry-run] [--json]",
  "",
  "Continue a thread in a fresh one. Defaults to the current thread.",
  "PR review: bb handoff pr status|preview|create (see bb handoff pr --help)",
  "  --dry-run   Print the resolved request without creating a thread",
  "  --json      Machine-readable output",
].join("\n");

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const settings = bb.settings.define({
    message: {
      type: "string",
      label: "Handoff message",
      description:
        "First message of the new thread. {thread} becomes a mention of the thread being handed off.",
      default: DEFAULT_MESSAGE,
      experimental_multiline: true,
    },
    reuseAgent: {
      type: "boolean",
      label: "Reuse the current agent",
      description:
        "Start the new thread on the same provider, model, reasoning level and permission mode as the thread it continues. Off: the project's remembered defaults.",
      default: true,
    },
  });

  /** Resolve everything a handoff needs; nothing is created yet. */
  async function planHandoff(threadId: string, target?: { providerId: string; model: string }): Promise<SpawnArgs> {
    const source = await bb.sdk.threads.get({ threadId });
    const { message, reuseAgent } = await settings.get();
    const input = buildHandoffInput(message, {
      id: source.id,
      projectId: source.projectId,
      label: source.title ?? source.titleFallback ?? source.id,
    });
    const base: SpawnArgs = {
      projectId: source.projectId,
      // A handoff continues work in place: same checkout or worktree.
      environment:
        source.environmentId === null
          ? { type: "project-default" }
          : { type: "reuse", environmentId: source.environmentId },
      input: [input],
      pluginMetadata: { sourceThreadId: source.id },
    };
    if (target) {
      const catalog = await bb.sdk.providers.models(source.environmentId
        ? { providerId: target.providerId, environmentId: source.environmentId }
        : { providerId: target.providerId });
      if (catalog.modelLoadError) throw new Error(`Could not load models: ${catalog.modelLoadError.code}`);
      const model = catalog.models.find(entry => entry.model === target.model);
      if (!model) throw new Error("This model is no longer available. Choose another model.");
      return {
        ...base,
        providerId: model.routeProviderId ?? target.providerId,
        model: model.model,
        reasoningLevel: model.defaultReasoningEffort,
        executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit" },
      };
    }
    if (!reuseAgent) return base;

    // The source's resolved execution options are what its prompts last ran
    // with. Without provenance the server drops a requested provider/model
    // and re-derives both from the project defaults.
    const execution = await bb.sdk.threads
      .defaultExecutionOptions({ threadId })
      .catch(() => null);
    return {
      ...base,
      providerId: source.providerId,
      ...(execution === null
        ? {}
        : {
            model: execution.model,
            reasoningLevel: execution.reasoningLevel,
            permissionMode: execution.permissionMode,
            serviceTier: execution.serviceTier,
          }),
      executionInputSources: {
        providerId: "explicit",
        ...(execution === null
          ? {}
          : {
              model: "explicit",
              reasoningLevel: "explicit",
              permissionMode: "explicit",
              serviceTier: "explicit",
            }),
      },
    };
  }

  async function handoff(threadId: string, target?: { providerId: string; model: string }): Promise<{ threadId: string }> {
    const plan = await planHandoff(threadId, target);
    const thread = await bb.sdk.threads.spawn(plan);
    bb.log.info(`handed off ${threadId} to ${thread.id}`);
    return { threadId: thread.id };
  }

  const host = bb.hosts.experimental_client({ contract: hostContract });
  async function checkout(threadId: string) {
    const thread = await bb.sdk.threads.get({ threadId });
    if (!thread.environmentId) return null;
    const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    return environment.isGitRepo && environment.path ? { cwd: environment.path, hostId: environment.hostId } : null;
  }
  async function requireCheckout(threadId: string) {
    const result = await checkout(threadId);
    if (!result) throw new Error("This thread has no Git checkout.");
    return result;
  }
  const prHandlers = {
    pr_status: async ({ threadId }: { threadId: string }) => {
      const target = await checkout(threadId);
      if (!target) return { isGit: false, pullRequest: null };
      const pullRequest = await host.call("status", { cwd: target.cwd }, { hostId: target.hostId }).catch(() => null);
      return { isGit: true, pullRequest };
    },
    pr_preview: async ({ threadId, base }: { threadId: string; base?: string }) => {
      const target = await requireCheckout(threadId);
      return host.call("preview", { cwd: target.cwd, base }, { hostId: target.hostId });
    },
    pr_create: async ({ threadId, ...input }: z.infer<typeof prMethods.pr_create.input>) => {
      const target = await requireCheckout(threadId);
      return host.call("create", { ...input, cwd: target.cwd }, { hostId: target.hostId });
    },
  };
  bb.rpc.register(rpcContract, {
    ...prHandlers,
    handoff: ({ threadId, target }) => handoff(threadId, target),
  });

  const prCli: Parameters<BbPluginApi["cli"]["register"]>[0] = {
    name: "handoff",
    summary: "Review and create a pull request for a thread",
    async run(argv, ctx) {
      const [command = "status", ...args] = argv;
      if (command === "--help") return { exitCode: 0, stdout: "bb handoff pr status|preview [thread-id]\nbb handoff pr create <review-json> [thread-id]\nCreate accepts the preview branch/sha/base plus edited title/body and draft boolean." };
      try {
        const threadId = (command === "create" ? args[1] : args[0]) ?? ctx.threadId;
        if (!threadId) throw new Error("Pass a thread id.");
        const result = command === "status" ? await prHandlers.pr_status({ threadId })
          : command === "preview" ? await prHandlers.pr_preview({ threadId })
          : command === "create" ? await prHandlers.pr_create(prMethods.pr_create.input.parse({ ...JSON.parse(args[0] ?? "{}"), threadId }))
          : (() => { throw new Error("Expected status, preview, or create."); })();
        return { exitCode: 0, stdout: JSON.stringify(result) };
      } catch (error) { return { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) }; }
    },
  };

  function describePlan(plan: SpawnArgs): string {
    const text = plan.input?.[0];
    const environment =
      plan.environment.type === "reuse"
        ? plan.environment.environmentId
        : "project default";
    const agent =
      plan.providerId === undefined
        ? "project defaults"
        : [plan.providerId, plan.model, plan.reasoningLevel, plan.permissionMode]
            .filter((part) => part !== undefined)
            .join(" / ");
    return [
      `Project:      ${plan.projectId}`,
      `Environment:  ${environment}`,
      `Agent:        ${agent}`,
      `Message:      ${text?.type === "text" ? text.text : ""}`,
    ].join("\n");
  }

  bb.cli.register({
    name: "handoff",
    summary: "Continue a thread in a fresh one",
    commands: [
      {
        name: "handoff",
        summary: "Hand off the current thread, or the given one, to a new thread",
        usage: "bb handoff [thread-id] [--provider ID --model ID] [--dry-run] [--json]",
      },
    ],
    async run(argv, ctx) {
      if (argv[0] === "pr") return prCli.run(argv.slice(1), ctx);
      const values: Record<string, string> = {};
      const rest: string[] = [];
      for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--provider" || argv[i] === "--model") {
          const key = argv[i];
          const value = argv[++i];
          if (!value || value.startsWith("--")) return { exitCode: 2, stderr: `${key} needs a value\n` };
          values[key] = value;
        } else rest.push(argv[i]);
      }
      if (Boolean(values["--provider"]) !== Boolean(values["--model"])) return { exitCode: 2, stderr: "Pass --provider and --model together\n" };
      const target = values["--provider"] ? { providerId: values["--provider"], model: values["--model"] } : undefined;
      argv = rest;
      const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
      const positional = argv.filter((arg) => !arg.startsWith("--"));
      const unknown = [...flags].filter(
        (flag) => !["--dry-run", "--json", "--help"].includes(flag),
      );
      if (flags.has("--help") || positional.length > 1 || unknown.length > 0) {
        return { exitCode: flags.has("--help") ? 0 : 2, stdout: `${USAGE}\n` };
      }
      const json = flags.has("--json");
      const threadId = positional[0] ?? ctx.threadId;
      if (threadId === undefined) {
        return {
          exitCode: 2,
          stderr: "No thread to hand off: pass a thread id or run inside a thread.\n",
        };
      }
      try {
        if (flags.has("--dry-run")) {
          const plan = await planHandoff(threadId, target);
          return {
            exitCode: 0,
            stdout: json
              ? `${JSON.stringify({ sourceThreadId: threadId, plan })}\n`
              : `${describePlan(plan)}\n`,
          };
        }
        const result = await handoff(threadId, target);
        return {
          exitCode: 0,
          stdout: json
            ? `${JSON.stringify({ sourceThreadId: threadId, threadId: result.threadId })}\n`
            : `Handed off ${threadId} to ${result.threadId}\n`,
        };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: `Could not hand off ${threadId}: ${error instanceof Error ? error.message : String(error)}\n`,
        };
      }
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}

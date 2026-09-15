import { execFile } from "node:child_process";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { hostContract, prSchema, type Preview } from "./pr-contract";

export type Runner = (file: string, args: string[], cwd: string) => Promise<string>;
export const run: Runner = (file, args, cwd) => new Promise((resolve, reject) => {
  execFile(file, args, { cwd, timeout: 60000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" } }, (error, stdout, stderr) => {
    if (error) reject(new Error(stderr.trim() || error.message));
    else resolve(stdout.trim());
  });
});
const repoSchema = z.object({ nameWithOwner: z.string(), url: z.url(), defaultBranchRef: z.object({ name: z.string() }) });
const locks = new Set<string>();
export function handlers(exec: Runner = run) {
  async function status({ cwd }: { cwd: string }) {
    const branch = await exec("git", ["symbolic-ref", "--short", "HEAD"], cwd);
    const entries = z.array(prSchema).parse(JSON.parse(await exec("gh", ["pr", "list", "--head", branch, "--state", "open", "--json", "number,url,state", "--limit", "1"], cwd)));
    return entries[0] ?? null;
  }
  async function preview({ cwd, base: requestedBase }: { cwd: string; base?: string }): Promise<Preview> {
    const repo = repoSchema.parse(JSON.parse(await exec("gh", ["repo", "view", "--json", "nameWithOwner,url,defaultBranchRef"], cwd)));
    const branch = await exec("git", ["symbolic-ref", "--short", "HEAD"], cwd);
    const base = requestedBase ?? repo.defaultBranchRef.name;
    await exec("git", ["check-ref-format", "--branch", base], cwd);
    if (base.startsWith("-") || branch.startsWith("-")) throw new Error("Invalid branch name.");
    const sha = await exec("git", ["rev-parse", "HEAD"], cwd);
    const dirty = Boolean(await exec("git", ["status", "--porcelain"], cwd));
    const pullRequest = await status({ cwd });
    const log = await exec("git", ["log", "--format=%s", `refs/remotes/origin/${base}..HEAD`, "--"], cwd);
    const commits = log.split("\n").filter(Boolean);
    return { repo: repo.nameWithOwner, branch, sha, base, dirty, pullRequest,
      title: commits[0] ?? branch,
      body: `## Changes\n\n${commits.map(subject => `- ${subject}`).join("\n")}\n\n## Verification\n\nDescribe the checks you ran.\n\n> AGENT GENERATED`,
      manualUrl: `${repo.url}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?expand=1`,
    };
  }
  async function create(input: z.infer<typeof hostContract.create.input>) {
    if (locks.has(input.cwd)) throw new Error("PR creation is already in progress for this checkout.");
    locks.add(input.cwd);
    try {
      const current = await preview({ cwd: input.cwd, base: input.base });
      if (current.branch !== input.branch || current.sha !== input.sha) throw new Error("The branch changed. Close this review and open it again.");
      if (current.pullRequest) return current.pullRequest;
      if (current.dirty) throw new Error("Commit your changes before creating a PR.");
      if (input.base === input.branch) throw new Error("Choose a base branch different from your current branch.");
      const count = await exec("git", ["rev-list", "--count", `refs/remotes/origin/${input.base}..HEAD`], input.cwd);
      if (count === "0") throw new Error("This branch has no commits to propose.");
      const remote = await exec("git", ["remote", "get-url", "--push", "origin"], input.cwd);
      const expected = current.repo.toLowerCase();
      const normalized = remote.replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
      if (!normalized.endsWith(`/${expected}`) && !normalized.endsWith(`:${expected}`)) throw new Error("Origin does not match the GitHub repository. Configure the correct push remote first.");
      await exec("git", ["push", "origin", `${input.sha}:refs/heads/${input.branch}`], input.cwd);
      await exec("gh", ["pr", "create", "--repo", current.repo, "--head", input.branch, "--base", input.base, "--title", input.title, "--body", input.body, ...(input.draft ? ["--draft"] : [])], input.cwd);
      const result = await status({ cwd: input.cwd });
      if (!result) throw new Error("PR submitted, but could not reload it. Check GitHub before retrying.");
      return result;
    } finally { locks.delete(input.cwd); }
  }
  return { status, preview, create };
}
export default experimental_defineHostEntry({ contract: hostContract, handlers: handlers() });

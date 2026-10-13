import { describe, expect, it } from "vitest";
import { handlers, type Runner } from "./host";

function fixture(options: { dirty?: boolean; sha?: string; existing?: boolean; count?: string; failPush?: boolean } = {}) {
  const calls: { file: string; args: string[] }[] = [];
  let created = false;
  const exec: Runner = async (file, args) => {
    calls.push({ file, args });
    const command = args.slice(0, 2).join(" ");
    if (file === "gh") {
      if (command === "repo view") return JSON.stringify({ nameWithOwner: "owner/repo", url: "https://github.com/owner/repo", defaultBranchRef: { name: "main" } });
      if (command === "pr list") return JSON.stringify(options.existing || created ? [{ number: 7, state: "OPEN", url: "https://github.com/owner/repo/pull/7" }] : []);
      if (command === "pr create") { created = true; return "https://github.com/owner/repo/pull/7"; }
    }
    if (args[0] === "symbolic-ref") return "feature";
    if (args[0] === "rev-parse") return options.sha ?? "abc";
    if (args[0] === "status") return options.dirty ? "M file.ts" : "";
    if (args[0] === "log") return "Improve toolbar\nAdd review";
    if (args[0] === "rev-list") return options.count ?? "2";
    if (args[0] === "remote") return "git@github.com:owner/repo.git";
    if (args[0] === "push" && options.failPush) throw new Error("Push rejected");
    if (["push", "check-ref-format"].includes(args[0])) return "";
    throw new Error(`Unexpected ${file} ${args.join(" ")}`);
  };
  return { ...handlers(exec), calls };
}
const input = { cwd: "/checkout", branch: "feature", sha: "abc", base: "main", title: "User title $(do not execute)", body: "User\nbody", draft: true };
describe("PR publishing", () => {
  it("generates an editable review from commits without writes", async () => {
    const f = fixture();
    const result = await f.preview({ cwd: input.cwd });
    expect(result.title).toBe("Improve toolbar");
    expect(result.body).toContain("- Add review");
    expect(f.calls.some(call => call.args[0] === "push" || call.args[1] === "create")).toBe(false);
  });
  it("pushes the reviewed SHA and preserves literal user content and draft mode", async () => {
    const f = fixture();
    expect((await f.create(input)).number).toBe(7);
    expect(f.calls.find(call => call.args[0] === "push")?.args).toEqual(["push", "origin", "abc:refs/heads/feature"]);
    expect(f.calls.find(call => call.args[1] === "create")?.args).toContain(input.title);
    expect(f.calls.find(call => call.args[1] === "create")?.args).toContain(input.body);
    expect(f.calls.find(call => call.args[1] === "create")?.args).toContain("--draft");
  });
  for (const [name, options] of [ ["dirty checkout", { dirty: true }], ["changed commit", { sha: "different" }], ["empty branch", { count: "0" }] ] as const) {
    it(`rejects ${name} before pushing`, async () => {
      const f = fixture(options);
      await expect(f.create(input)).rejects.toThrow();
      expect(f.calls.some(call => call.args[0] === "push")).toBe(false);
    });
  }
  it("does not create duplicates", async () => {
    const f = fixture({ existing: true });
    expect((await f.create(input)).number).toBe(7);
    expect(f.calls.some(call => call.args[0] === "push" || call.args[1] === "create")).toBe(false);
  });
  it("stops on push failure and releases its lock for retry", async () => {
    const f = fixture({ failPush: true });
    await expect(f.create(input)).rejects.toThrow("Push rejected");
    await expect(f.create(input)).rejects.toThrow("Push rejected");
    expect(f.calls.some(call => call.args[1] === "create")).toBe(false);
  });
});

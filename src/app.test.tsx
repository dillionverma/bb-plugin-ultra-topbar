// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "./server";

beforeAll(() => {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true, media: "", onchange: null });
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(cleanup);
const preview = { repo: "owner/repo", branch: "feature", sha: "abc", base: "main", title: "Improve toolbar", body: "Changes", dirty: false, pullRequest: null, manualUrl: "https://github.com/owner/repo/compare/main...feature?expand=1" };
async function render(overrides: Partial<PluginRpcTestHandlers<typeof rpcContract>> = {}) {
  const app = await loadPluginApp(() => import("./app"));
  return renderSlot<{ threadId: string; projectId: string; isCompactViewport: boolean }, typeof rpcContract>(app.threadHeaderActions[0]!, { threadId: "thr_1", projectId: "proj_1", isCompactViewport: false }, { rpc: {
    handoff: () => ({ threadId: "thr_2" }), pr_status: () => ({ isGit: false, pullRequest: null }),
    pr_preview: () => preview, pr_create: () => ({ number: 12, url: "https://github.com/owner/repo/pull/12", state: "OPEN" }), ...overrides,
  } });
}
describe("thread toolbar", () => {
  it("opens a fresh thread in the same project and hides PR for non-git threads", async () => {
    const slot = await render();
    fireEvent.click(slot.getByRole("button", { name: "New thread" }));
    expect(slot.inspection.sidebarActionCalls).toEqual([{ method: "openNewThread", options: { projectId: "proj_1", focusPrompt: true } }]);
    expect(slot.queryByRole("button", { name: "Create PR" })).toBeNull();
    expect(slot.queryByRole("button", { name: "Continue in new thread" })).toBeNull();
  });
  it("keeps handoff in the overflow", async () => {
    const slot = await render();
    fireEvent.click(slot.getByRole("button", { name: "More thread actions" }));
    fireEvent.click(await slot.findByRole("button", { name: "Continue in new thread" }));
    await waitFor(() => expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_2" }]));
  });
  it("reviews before creating, sends edited details, then shows View PR", async () => {
    const slot = await render({ pr_status: () => ({ isGit: true, pullRequest: null }) });
    fireEvent.click(await slot.findByRole("button", { name: "Create PR" }));
    const title = await slot.findByLabelText("Title");
    expect(slot.inspection.rpcCalls.some(call => call.method === "pr_create")).toBe(false);
    fireEvent.change(title, { target: { value: "Reviewed title" } });
    fireEvent.click(slot.getByRole("button", { name: "Publish PR" }));
    await slot.findByRole("link", { name: "View PR #12" });
    expect(slot.inspection.rpcCalls.find(call => call.method === "pr_create")?.input).toMatchObject({ title: "Reviewed title", draft: false, sha: "abc", threadId: "thr_1" });
  });
  it("opens manual flow without publishing", async () => {
    const slot = await render({ pr_status: () => ({ isGit: true, pullRequest: null }) });
    fireEvent.click(await slot.findByRole("button", { name: "PR options" }));
    fireEvent.click(await slot.findByRole("button", { name: "Create PR manually" }));
    expect((await slot.findByRole("link", { name: "Continue on GitHub" })).getAttribute("href")).toBe(preview.manualUrl);
    expect(slot.queryByRole("button", { name: "Publish PR" })).toBeNull();
    expect(slot.inspection.rpcCalls.some(call => call.method === "pr_create")).toBe(false);
  });
  it("offers draft creation and blocks publishing uncommitted changes", async () => {
    const slot = await render({ pr_status: () => ({ isGit: true, pullRequest: null }), pr_preview: () => ({ ...preview, dirty: true }) });
    fireEvent.click(await slot.findByRole("button", { name: "PR options" }));
    fireEvent.click(await slot.findByRole("button", { name: "Create draft PR" }));
    expect((await slot.findByRole("button", { name: "Publish draft PR" })).hasAttribute("disabled")).toBe(true);
  });
});

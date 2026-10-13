import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const prSchema = z.object({ number: z.number().int(), url: z.url(), state: z.string() });
export const previewSchema = z.object({
  branch: z.string(), sha: z.string(), base: z.string(), repo: z.string(),
  title: z.string(), body: z.string(), dirty: z.boolean(),
  pullRequest: prSchema.nullable(), manualUrl: z.url(),
});
export const createSchema = z.object({
  branch: z.string().min(1), sha: z.string().min(1), base: z.string().min(1),
  title: z.string().trim().min(1).max(256), body: z.string().max(65000), draft: z.boolean(),
});
export const prMethods = {
  pr_status: { input: z.object({ threadId: z.string() }), output: z.object({ isGit: z.boolean(), pullRequest: prSchema.nullable() }) },
  pr_preview: { input: z.object({ threadId: z.string(), base: z.string().optional() }), output: previewSchema },
  pr_create: { input: createSchema.extend({ threadId: z.string() }), output: prSchema },
};
export const hostContract = defineRpcContract({
  status: { input: z.object({ cwd: z.string() }), output: prSchema.nullable() },
  preview: { input: z.object({ cwd: z.string(), base: z.string().optional() }), output: previewSchema },
  create: { input: createSchema.extend({ cwd: z.string() }), output: prSchema },
});
export type Preview = z.infer<typeof previewSchema>;

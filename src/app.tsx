import { useEffect, useRef, useState } from "react";
import { definePluginApp, useBbNavigate, useRpc, experimental_useSidebarThreadActions, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import type { Preview } from "./pr-contract";
import { Button } from "./components/ui/button";
import { Icon } from "./components/ui/icon";
import { Popover, PopoverTrigger, PopoverContent } from "./components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./components/ui/dialog";
import { Input } from "./components/ui/input";

function Toolbar({ threadId, projectId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const nav = useBbNavigate();
  const actions = experimental_useSidebarThreadActions();
  const [status, setStatus] = useState<{ isGit: boolean; pullRequest: Preview["pullRequest"] }>({ isGit: false, pullRequest: null });
  const [menu, setMenu] = useState(false);
  const [prMenu, setPrMenu] = useState(false);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => { void rpc.call("pr_status", { threadId }).then(value => { if (active) setStatus(value); }).catch(() => {}); };
    refresh();
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [rpc, threadId]);
  async function task(run: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null);
    try { await run(); }
    catch (e) { const message = e instanceof Error ? e.message : String(e); setError(message); toast.error(message); }
    finally { busy.current = false; setPending(false); }
  }
  function review(isDraft: boolean) {
    setPrMenu(false); setManual(false); setDraft(isDraft); setPreview(null); setOpen(true);
    void task(async () => { setPreview(await rpc.call("pr_preview", { threadId })); });
  }
  return <div className="flex items-center gap-1">
    <Button size="sm" variant="ghost" className="h-7 gap-1 px-2" onClick={() => actions.openNewThread({ projectId, focusPrompt: true })}>
      <Icon name="Plus" className="size-4" />New thread
    </Button>
    {status.isGit && (status.pullRequest ? <a href={status.pullRequest.url} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center rounded-md border px-2 text-sm">View PR #{status.pullRequest.number}</a> : <div className="flex items-center">
      <Button size="sm" variant="outline" className="h-7 rounded-r-none px-2" disabled={pending} onClick={() => review(false)}>Create PR</Button>
      <Popover open={prMenu} onOpenChange={setPrMenu}>
        <PopoverTrigger asChild><Button size="icon" variant="outline" className="size-7 rounded-l-none border-l-0" aria-label="PR options" disabled={pending}><Icon name="ChevronDown" className="size-4" /></Button></PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-1">
          <Button variant="ghost" className="w-full justify-start" onClick={() => review(true)}>Create draft PR</Button>
          <Button variant="ghost" className="w-full justify-start" onClick={() => { setPrMenu(false); setManual(true); setDraft(false); setPreview(null); setOpen(true); void task(async () => { setPreview(await rpc.call("pr_preview", { threadId })); }); }}>Create PR manually</Button>
        </PopoverContent>
      </Popover>
    </div>)}
    <Popover open={menu} onOpenChange={setMenu}>
      <PopoverTrigger asChild><Button variant="ghost" size="icon" className="size-7" aria-label="More thread actions">⋯</Button></PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1">
        <Button variant="ghost" className="w-full justify-start" disabled={pending} onClick={() => { setMenu(false); void task(async () => { const next = await rpc.call("handoff", { threadId }); nav.toThread(next.threadId); }); }}>Continue in new thread</Button>
      </PopoverContent>
    </Popover>
    <Dialog open={open} onOpenChange={value => { if (!pending) setOpen(value); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{manual ? "Create PR manually" : draft ? "Create draft PR" : "Create PR"}</DialogTitle><DialogDescription>Review the branch and PR details before publishing.</DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm">{error}</p>}
        {!preview && !error && <p role="status">Preparing review…</p>}
        {preview && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void task(async () => {
          const result = await rpc.call("pr_create", { threadId, branch: preview.branch, sha: preview.sha, base: preview.base, title: preview.title, body: preview.body, draft });
          setStatus({ isGit: true, pullRequest: result }); setOpen(false); toast.success(`Created PR #${result.number}`);
        }); }}>
          <p className="text-sm">{preview.repo} · {preview.branch}</p>
          {preview.dirty && <p role="status" className="text-sm">Commit your changes before publishing this PR.</p>}
          <label className="block space-y-1 text-sm">Base branch<Input required value={preview.base} onChange={event => setPreview({ ...preview, base: event.target.value })} /></label>
          {!manual && <><label className="block space-y-1 text-sm">Title<Input required maxLength={256} value={preview.title} onChange={event => setPreview({ ...preview, title: event.target.value })} /></label>
          <label className="block space-y-1 text-sm">Description<textarea className="min-h-48 w-full rounded-md border bg-transparent p-2 text-sm" value={preview.body} onChange={event => setPreview({ ...preview, body: event.target.value })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft} onChange={event => setDraft(event.target.checked)} />Draft PR</label></>}
          <p className="text-sm text-muted-foreground">{manual ? "Open GitHub’s compare page to write and create the PR there. The branch must already be pushed." : "Publishing pushes this branch to origin and creates the PR on GitHub."}</p>
          <DialogFooter>
            <a className="text-sm underline" href={preview.manualUrl.replace(/\/compare\/.*$/, `/compare/${encodeURIComponent(preview.base)}...${encodeURIComponent(preview.branch)}?expand=1`)} target="_blank" rel="noreferrer">Continue on GitHub</a>
            {!manual && <Button type="submit" disabled={pending || preview.dirty || !preview.title.trim()}>{pending ? "Creating…" : draft ? "Publish draft PR" : "Publish PR"}</Button>}
          </DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
  </div>;
}
export default definePluginApp(app => {
  app.slots.experimental_threadHeaderAction({ id: "handoff", title: "Ultra Topbar", component: Toolbar });
});

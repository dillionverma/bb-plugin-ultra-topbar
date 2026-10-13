// Pure handoff logic: the first message of the successor thread.
//
// The message is the user's template with every `{thread}` placeholder
// replaced by an @thread mention of the thread being handed off — the same
// structured text item BB's composer produces when you type `@` and pick a
// thread. The new thread renders a real mention chip, and the agent there
// resolves it with `bb thread log <id>`.

export const THREAD_PLACEHOLDER = "{thread}";
export const DEFAULT_MESSAGE = `Continue from ${THREAD_PLACEHOLDER}`;

export interface HandoffSource {
  id: string;
  projectId: string;
  /** What the mention chip shows: the thread's title or its fallback. */
  label: string;
}

export interface ThreadMention {
  start: number;
  end: number;
  resource: {
    kind: "thread";
    threadId: string;
    projectId: string;
    label: string;
  };
}

export interface HandoffTextInput {
  type: "text";
  text: string;
  mentions: ThreadMention[];
}

/** The mention token as it appears in message text. */
export function mentionToken(threadId: string): string {
  return `@thread:${threadId}`;
}

/**
 * Expand the message template for one source thread. An empty template
 * falls back to the default, and a template without the placeholder gets
 * the mention appended: without it the new agent has nothing to continue
 * from.
 */
export function buildHandoffInput(
  template: string,
  source: HandoffSource,
): HandoffTextInput {
  let body = template.trim();
  if (body === "") body = DEFAULT_MESSAGE;
  if (!body.includes(THREAD_PLACEHOLDER)) body = `${body} ${THREAD_PLACEHOLDER}`;

  const token = mentionToken(source.id);
  const resource = {
    kind: "thread" as const,
    threadId: source.id,
    projectId: source.projectId,
    label: source.label,
  };
  const mentions: ThreadMention[] = [];
  let text = "";
  let cursor = 0;
  for (
    let at = body.indexOf(THREAD_PLACEHOLDER);
    at !== -1;
    at = body.indexOf(THREAD_PLACEHOLDER, cursor)
  ) {
    text += body.slice(cursor, at);
    mentions.push({ start: text.length, end: text.length + token.length, resource });
    text += token;
    cursor = at + THREAD_PLACEHOLDER.length;
  }
  text += body.slice(cursor);
  return { type: "text", text, mentions };
}

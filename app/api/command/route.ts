import { isStepCount, streamText } from "ai";
import { buildTools, selectModel, NO_KEY_ERROR, SYSTEM_PROMPT } from "@/lib/copilot";
import { hydrateState } from "@/lib/hydrate";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/** Agent command as a live SSE stream: natural language in; `tool` (call
 * started), `action` (tool executed — includes payment amounts), `text`
 * (assistant deltas), then `done`. Powers the inline command bars. Errors
 * before the stream starts return plain JSON (client checks content-type). */
export async function POST(req: Request) {
  await hydrateState();
  const model = selectModel();
  if (!model) {
    return Response.json({ error: NO_KEY_ERROR }, { status: 500 });
  }

  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text?.trim()) {
    return Response.json({ error: "Tell the agent what to do." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // stream already closed (client went away) — drop the event
        }
      };
      try {
        const result = streamText({
          model,
          system:
            SYSTEM_PROMPT +
            "\n\nThis request comes from an inline command bar, not a chat. Reply with 1-2 short sentences reporting exactly what you did.",
          prompt: text.trim(),
          stopWhen: isStepCount(5),
          tools: buildTools((a) => send("action", a)),
        });
        for await (const part of result.stream) {
          switch (part.type) {
            case "text-delta":
              send("text", { delta: part.text });
              break;
            case "tool-call":
              send("tool", { name: part.toolName, input: part.input });
              break;
            case "error":
              send("error", {
                message: part.error instanceof Error ? part.error.message : String(part.error),
              });
              break;
          }
        }
        send("done", {});
      } catch (err: unknown) {
        send("error", { message: err instanceof Error ? err.message : String(err) });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

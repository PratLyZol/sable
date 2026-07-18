import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { buildTools, selectModel, NO_KEY_ERROR, SYSTEM_PROMPT } from "@/lib/copilot";
import { hydrateState } from "@/lib/hydrate";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await hydrateState();
  const model = selectModel();
  if (!model) {
    return Response.json({ error: NO_KEY_ERROR }, { status: 500 });
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    stopWhen: isStepCount(6),
    tools: buildTools(),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}

import { generateText, isStepCount } from "ai";
import { buildTools, selectModel, NO_KEY_ERROR, SYSTEM_PROMPT, type ActionReport } from "@/lib/copilot";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/** One-shot agent command: natural language in, executed actions + a terse
 * report out. Powers the inline command bars (e.g. agent payroll). */
export async function POST(req: Request) {
  const model = selectModel();
  if (!model) {
    return Response.json({ error: NO_KEY_ERROR }, { status: 500 });
  }

  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text?.trim()) {
    return Response.json({ error: "Tell the agent what to do." }, { status: 400 });
  }

  const actions: ActionReport[] = [];
  try {
    const result = await generateText({
      model,
      system:
        SYSTEM_PROMPT +
        "\n\nThis request comes from an inline command bar, not a chat. Reply with 1-2 short sentences reporting exactly what you did.",
      prompt: text.trim(),
      stopWhen: isStepCount(5),
      tools: buildTools((a) => actions.push(a)),
    });
    return Response.json({ text: result.text, actions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg, actions }, { status: 500 });
  }
}

import { authHeader } from "@/firebase";

// Every /api/pd-* Gemini call in Product Design goes through this. Every
// call site used to do `const data = await res.json()` directly — fine when
// the server responds with the JSON it's supposed to, but the moment it
// doesn't (a platform-level timeout/crash page instead of our own edge
// function's JSON error body, a cold-start hiccup, anything upstream of our
// own try/catch), `res.json()` throws a raw browser SyntaxError straight
// into the UI. Seen live (Eddie, 2026-09-19) on a Tweak call: the error
// message was literally `Unexpected token 'h', "the edge fu"... is not
// valid JSON` — a fragment of whatever the actual response body was,
// surfaced verbatim instead of a real explanation.
//
// Reads the body as text first and parses it defensively, so any failure
// mode collapses to one clear, actionable message instead of a leaked
// parser exception.
export async function pdApiFetch<T = Record<string, unknown>>(
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let data: Record<string, unknown> = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        res.ok
          ? "The server sent back something unexpected — please try again."
          : `Request failed (${res.status}) — please try again, or try a shorter/simpler instruction.`,
      );
    }
  }
  if (!res.ok) throw new Error((data.error as string) || `Request failed (${res.status})`);
  return data as T;
}

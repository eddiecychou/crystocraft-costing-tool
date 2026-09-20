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
//
// A non-JSON 5xx (as opposed to our own edge function's JSON error body)
// means the platform/upstream killed the request before our own try/catch
// ran — a Netlify edge function execution-time cutoff tripped by Gemini
// being slow that particular call, not a real fault with the request.
// Confirmed live (Eddie, 2026-09-20): a Tweak call 500'd with a non-JSON
// body, and retrying the EXACT SAME instruction immediately succeeded — so
// one silent automatic retry turns that class of hiccup into a non-event
// instead of making the owner click Apply again themselves.
async function attempt(path: string, body: unknown): Promise<{ res: Response; raw: string }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  return { res, raw };
}

function parseOrNull(raw: string): Record<string, unknown> | null {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function pdApiFetch<T = Record<string, unknown>>(
  path: string,
  body: unknown,
): Promise<T> {
  let { res, raw } = await attempt(path, body);
  let data = parseOrNull(raw);

  // Only the platform-error shape (non-JSON body) gets the silent retry —
  // a real 4xx/5xx with a proper JSON error body (bad input, access denied,
  // Gemini genuinely rejecting the request) is a real answer, not a fluke,
  // and retrying it would just waste a second Gemini call for the same
  // failure.
  if (data === null && !res.ok) {
    ({ res, raw } = await attempt(path, body));
    data = parseOrNull(raw);
  }

  if (data === null) {
    throw new Error(
      res.ok
        ? "The server sent back something unexpected — please try again."
        : `Request failed (${res.status}) — please try again, or try a shorter/simpler instruction.`,
    );
  }
  if (!res.ok) throw new Error((data.error as string) || `Request failed (${res.status})`);
  return data as T;
}

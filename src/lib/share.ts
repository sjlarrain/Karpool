// Browser-only. One share affordance for the whole app: the OS share sheet wherever the platform
// has one (a phone — WhatsApp, Messages, whatever is installed), the clipboard everywhere else.
//
// A cancelled share is a deliberate user action, not a failure — it reports "shared" so callers
// stay quiet rather than flashing an error at someone who simply changed their mind.

export type ShareOutcome = "shared" | "copied" | "failed";

export interface SharePayload {
  title: string;
  text?: string;
  url: string;
}

export async function shareOrCopy(payload: SharePayload): Promise<ShareOutcome> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share(payload);
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "shared";
      // Anything else (no permission, unsupported payload) falls through to the clipboard.
    }
  }

  try {
    await navigator.clipboard.writeText(payload.url);
    return "copied";
  } catch {
    return "failed";
  }
}

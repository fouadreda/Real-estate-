/** Where the chat page keeps the open conversation in the browser (until the tab is closed or the person signs out). */
export const ASSISTANT_STORAGE_KEY = "cocotiers-assistant";

/** Forgets the open conversation, e.g. on sign-out, so the next person on the same phone does not see it. */
export function clearAssistantConversation() {
  try {
    sessionStorage.removeItem(ASSISTANT_STORAGE_KEY);
  } catch {
    // storage blocked: nothing was kept anyway
  }
}

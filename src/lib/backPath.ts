const BASE = "http://app.invalid";

/**
 * Where to go back after saving a correction (e.g. a filtered Reports or Expenses page). Only pages of
 * this app are accepted: the path is resolved the way a browser would ("/./", "/x/..", "%2e" included)
 * and refused if it would leave the app, so a link can never send staff to another site.
 */
export function safeBackPath(raw: FormDataEntryValue | string | null | undefined): string | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value) || value.length > 500) return null;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE || url.pathname.startsWith("//") || url.pathname.includes("\\")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

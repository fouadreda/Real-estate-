/** Red message shown at the top of a form when the server sent it back with ?error=<code>. */
export default function FormError({ code, messages }: { code?: string; messages: Record<string, string> }) {
  const message = code ? messages[code] : undefined;
  if (!message) return null;
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
      {message}
    </p>
  );
}

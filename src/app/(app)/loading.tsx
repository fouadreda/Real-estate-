/** Shown at once while the next page loads, so a tap on a slow phone connection visibly does something. */
export default function Loading() {
  return (
    <div className="flex justify-center py-16" role="status" aria-live="polite">
      <span className="h-8 w-8 animate-spin rounded-full border-4 border-stone-200 border-t-brand-600" />
      <span className="sr-only">…</span>
    </div>
  );
}

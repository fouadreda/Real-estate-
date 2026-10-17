"use client";

import { useEffect, useState } from "react";

const ARMED_MS = 8000;

export default function ConfirmSubmitButton({
  confirmMessage,
  confirmLabel,
  cancelLabel,
  className,
  children,
}: {
  confirmMessage: string;
  confirmLabel: string;
  cancelLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!asking) return;
    const timer = setTimeout(() => setAsking(false), ARMED_MS);
    return () => clearTimeout(timer);
  }, [asking]);

  if (!asking) {
    return (
      <button type="button" className={className} onClick={() => setAsking(true)}>
        {children}
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2" role="alertdialog" aria-label={confirmMessage}>
      <span className="text-xs font-medium text-red-700">{confirmMessage}</span>
      <button
        type="submit"
        className="inline-flex min-h-9 items-center rounded-lg bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700"
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        className="inline-flex min-h-9 items-center rounded-lg px-3 text-sm text-stone-600 hover:bg-stone-100"
        onClick={() => setAsking(false)}
      >
        {cancelLabel}
      </button>
    </span>
  );
}

"use client";

import { useFormStatus } from "react-dom";

/** Submit button that shows it is working (and cannot be pressed twice) while the form is being saved. */
export default function SubmitButton({
  className,
  children,
  pendingLabel,
  disabled = false,
}: {
  className?: string;
  children: React.ReactNode;
  pendingLabel?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled} aria-busy={pending}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

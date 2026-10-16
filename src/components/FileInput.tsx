"use client";

import { MAX_UPLOAD_BYTES, UPLOAD_EXTENSIONS } from "@/lib/uploads";

/**
 * File picker for receipts, invoices and documents. A file that is too big or of the wrong type is
 * refused right away (the browser shows `invalidMessage` and will not submit the form), so nothing
 * half-saved can happen on the server.
 */
export default function FileInput({
  id,
  name = "file",
  required = false,
  invalidMessage,
}: {
  id?: string;
  name?: string;
  required?: boolean;
  invalidMessage: string;
}) {
  return (
    <input
      className="input"
      id={id}
      name={name}
      type="file"
      required={required}
      accept={Object.keys(UPLOAD_EXTENSIONS).join(",")}
      onChange={(e) => {
        const input = e.currentTarget;
        const file = input.files?.[0];
        const ok = !file || (file.type in UPLOAD_EXTENSIONS && file.size <= MAX_UPLOAD_BYTES);
        input.setCustomValidity(ok ? "" : invalidMessage);
        if (!ok) input.reportValidity();
      }}
    />
  );
}

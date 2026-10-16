/** Files staff can attach (receipts, invoices, lease documents). Vercel refuses requests above about 4.5 MB. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const UPLOAD_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
};

export function isAllowedUpload(file: File): boolean {
  return file.type in UPLOAD_EXTENSIONS && file.size <= MAX_UPLOAD_BYTES;
}

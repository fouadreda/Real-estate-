type AttachmentItem = {
  id: string;
  filename: string;
  fileType: string;
  url: string;
};

export default function AttachmentGallery({
  attachments,
  deleteAction,
  emptyLabel,
  removeLabel,
}: {
  attachments: AttachmentItem[];
  deleteAction: (id: string) => Promise<void>;
  emptyLabel: string;
  removeLabel: string;
}) {
  if (attachments.length === 0) {
    return <p className="text-sm text-stone-500">{emptyLabel}</p>;
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {attachments.map((attachment) => {
        const removeThisAttachment = deleteAction.bind(null, attachment.id);
        const isImage = attachment.fileType.startsWith("image/");
        return (
          <li key={attachment.id} className="overflow-hidden rounded-lg border border-stone-200 bg-stone-50">
            <a href={attachment.url} target="_blank" rel="noreferrer" className="block aspect-square">
              {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={attachment.url} alt={attachment.filename} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-1 text-stone-500">
                  <span className="text-xs font-semibold uppercase tracking-wide">PDF</span>
                </div>
              )}
            </a>
            <p className="truncate px-2 pt-1.5 text-xs text-stone-600" title={attachment.filename}>
              {attachment.filename}
            </p>
            <form action={removeThisAttachment} className="px-2 pb-2">
              <button type="submit" className="text-xs text-red-600 hover:underline">
                {removeLabel}
              </button>
            </form>
          </li>
        );
      })}
    </ul>
  );
}

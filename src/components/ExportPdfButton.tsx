"use client";

import { useState } from "react";

export default function ExportPdfButton({
  label,
  fileName,
  docTitle,
  subtitle,
  columns,
  rows,
  totalLabel,
  totalValue,
  footer,
}: {
  label: string;
  fileName: string;
  docTitle: string;
  subtitle: string;
  columns: string[];
  rows: string[][];
  totalLabel?: string;
  totalValue?: string;
  footer: string;
}) {
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBusy(true);
    try {
      const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
      const doc = new jsPDF({ orientation: columns.length > 4 ? "landscape" : "portrait", unit: "pt" });

      doc.setFontSize(16);
      doc.text(docTitle, 40, 44);
      doc.setFontSize(10);
      doc.setTextColor(110, 110, 110);
      doc.text(subtitle, 40, 62);

      autoTable(doc, {
        startY: 78,
        head: [columns],
        body: rows,
        styles: { fontSize: 9, cellPadding: 6 },
        headStyles: { fillColor: [69, 90, 69], textColor: 255 },
        alternateRowStyles: { fillColor: [246, 245, 240] },
        margin: { left: 40, right: 40 },
      });

      const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

      if (totalLabel && totalValue) {
        doc.setFontSize(11);
        doc.setTextColor(30, 30, 30);
        doc.text(`${totalLabel}: ${totalValue}`, 40, finalY + 24);
      }

      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        const pageSize = doc.internal.pageSize;
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(footer, 40, pageSize.getHeight() - 20);
        doc.text(String(i), pageSize.getWidth() - 40, pageSize.getHeight() - 20, { align: "right" });
      }

      doc.save(fileName);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={handleExport} disabled={busy || rows.length === 0} className="btn-secondary shrink-0">
      {busy ? "…" : label}
    </button>
  );
}

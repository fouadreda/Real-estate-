"use client";

import { useState } from "react";

export default function ExportPdfButton({
  label,
  fileName,
  docTitle,
  subtitle,
  columns,
  rows,
  amountColumnIndex,
  amountColumnIndexes,
  totalLabel,
  totalValue,
  totals,
  footer,
}: {
  label: string;
  fileName: string;
  docTitle: string;
  subtitle: string;
  columns: string[];
  rows: string[][];
  /** Column that holds a formatted money value — right-aligned and given a fixed width so it never wraps. Defaults to the last column. */
  amountColumnIndex?: number;
  /** Several money columns (e.g. inflow and outflow); takes precedence over amountColumnIndex. */
  amountColumnIndexes?: number[];
  totalLabel?: string;
  totalValue?: string;
  /** Several total lines, stacked under the table; takes precedence over totalLabel/totalValue. */
  totals?: { label: string; value: string }[];
  footer: string;
}) {
  const [busy, setBusy] = useState(false);
  const moneyCols = amountColumnIndexes ?? [amountColumnIndex ?? columns.length - 1];
  const totalLines = totals ?? (totalLabel && totalValue ? [{ label: totalLabel, value: totalValue }] : []);

  async function handleExport() {
    setBusy(true);
    try {
      const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
      const landscape = columns.length > 4;
      const doc = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "pt" });
      const pageWidth = doc.internal.pageSize.getWidth();

      doc.setFontSize(16);
      doc.setTextColor(30, 30, 30);
      doc.text(docTitle, 40, 44);
      doc.setFontSize(10);
      doc.setTextColor(110, 110, 110);
      doc.text(subtitle, 40, 62);
      doc.setDrawColor(225, 222, 214);
      doc.line(40, 72, pageWidth - 40, 72);

      autoTable(doc, {
        startY: 84,
        head: [columns],
        body: rows,
        styles: { fontSize: 9, cellPadding: 7, valign: "middle", overflow: "linebreak" },
        headStyles: { fillColor: [69, 90, 69], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [246, 245, 240] },
        columnStyles: Object.fromEntries(
          moneyCols.map((col) => [col, { halign: "right" as const, cellWidth: 100, fontStyle: "bold" as const }]),
        ),
        margin: { left: 40, right: 40 },
        didParseCell: (data) => {
          if (data.section === "head" && moneyCols.includes(data.column.index)) {
            data.cell.styles.halign = "right";
          }
        },
      });

      const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

      if (totalLines.length > 0) {
        doc.setFontSize(11);
        doc.setTextColor(30, 30, 30);
        doc.setFont("helvetica", "bold");
        totalLines.forEach((line, i) => {
          doc.text(`${line.label}: ${line.value}`, pageWidth - 40, finalY + 26 + i * 16, { align: "right" });
        });
        doc.setFont("helvetica", "normal");
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

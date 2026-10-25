"use client";

import Link from "next/link";
import { Fragment, useState, type ReactNode } from "react";

type CopyLabels = { copy: string; copied: string };

/**
 * Shows the assistant's answers: the small part of Markdown it is asked to use (bold, lists,
 * "###" headings, tables, quotes, links). Built from React elements, never raw HTML, and links
 * only go to pages of the app. A quote holds a message for a tenant and gets its own copy button.
 */
export default function ChatMarkdown({ text, labels }: { text: string; labels: CopyLabels }) {
  return <div className="min-w-0 space-y-2 break-words text-sm leading-relaxed text-stone-800">{blocks(text, labels)}</div>;
}

/** Copies text to the clipboard and says so for a moment. */
export function CopyButton({ text, labels, className }: { text: string; labels: CopyLabels; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className ?? "inline-flex min-h-8 items-center rounded-md px-2 text-xs font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-800"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard refused (old browser or no permission): the text can still be selected by hand
        }
      }}
    >
      {copied ? labels.copied : labels.copy}
    </button>
  );
}

type Block =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "code"; text: string }
  | { kind: "rule" };

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parse(text: string): Block[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      i += 1;
      out.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    if (/^#{1,4}\s+/.test(line)) {
      out.push({ kind: "heading", text: line.replace(/^#{1,4}\s+/, "") });
      i += 1;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push({ kind: "rule" });
      i += 1;
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])) {
      const header = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      out.push({ kind: "table", header, rows });
      continue;
    }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = NUMBERED.test(line);
      const marker = ordered ? NUMBERED : BULLET;
      const items: string[] = [];
      while (i < lines.length && marker.test(lines[i])) {
        let item = lines[i++].replace(marker, "");
        // an indented line under an item continues it
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i])) {
          item += ` ${lines[i++].trim()}`;
        }
        items.push(item);
      }
      out.push({ kind: "list", ordered, items });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quoted.push(lines[i++].replace(/^>\s?/, ""));
      out.push({ kind: "quote", lines: quoted });
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !BULLET.test(lines[i]) &&
      !NUMBERED.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !lines[i].trim().startsWith("```") &&
      !(lines[i].trim().startsWith("|") && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]))
    ) {
      paragraph.push(lines[i++]);
    }
    out.push({ kind: "paragraph", lines: paragraph });
  }
  return out;
}

function withBreaks(lines: string[]): ReactNode {
  return lines.map((line, index) => (
    <Fragment key={index}>
      {index > 0 && <br />}
      {inline(line)}
    </Fragment>
  ));
}

function blocks(text: string, labels: CopyLabels): ReactNode {
  return parse(text).map((block, index) => {
    switch (block.kind) {
      case "heading":
        return (
          <h3 key={index} className="pt-1 font-sans text-sm font-semibold text-stone-900">
            {inline(block.text)}
          </h3>
        );
      case "paragraph":
        return <p key={index}>{withBreaks(block.lines)}</p>;
      case "list": {
        const items = block.items.map((item, n) => <li key={n}>{inline(item)}</li>);
        return block.ordered ? (
          <ol key={index} className="list-decimal space-y-1 pl-5">{items}</ol>
        ) : (
          <ul key={index} className="list-disc space-y-1 pl-5">{items}</ul>
        );
      }
      case "quote":
        return (
          <div key={index} className="rounded-r-lg border-l-4 border-brand-200 bg-brand-50/60 py-2 pl-3 pr-2">
            <blockquote className="text-stone-800">{withBreaks(block.lines)}</blockquote>
            <div className="mt-1 flex justify-end">
              <CopyButton text={plainText(block.lines.join("\n"))} labels={labels} />
            </div>
          </div>
        );
      case "table":
        return (
          <div key={index} className="overflow-x-auto rounded-lg border border-stone-200">
            <table className="min-w-full text-left text-xs sm:text-sm">
              <thead className="bg-stone-50 text-stone-600">
                <tr>
                  {block.header.map((cell, n) => (
                    <th key={n} className="whitespace-nowrap px-3 py-2 font-medium">{inline(cell)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, n) => (
                      <td key={n} className="px-3 py-1.5 align-top">{inline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "code":
        return (
          <pre key={index} className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-stone-100 p-3 text-xs">
            {block.text}
          </pre>
        );
      case "rule":
        return <hr key={index} className="border-stone-200" />;
    }
  });
}

const INLINE = /(\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\)|`[^`\n]+`)/g;

function inline(text: string): ReactNode {
  return text.split(INLINE).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index} className="font-semibold text-stone-900">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={index} className="rounded bg-stone-100 px-1 text-xs">{part.slice(1, -1)}</code>;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const [, label, href] = link;
      // only pages of the app (a path such as /leases/…), never another site
      return href.startsWith("/") && !href.startsWith("//") ? (
        <Link key={index} href={href} className="font-medium text-brand-600 underline-offset-2 hover:underline">
          {label}
        </Link>
      ) : (
        <Fragment key={index}>{label}</Fragment>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

/** The answer as plain text, for pasting into WhatsApp, an SMS or an email. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .trim();
}

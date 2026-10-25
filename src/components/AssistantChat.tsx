"use client";

import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n";
import ChatMarkdown, { CopyButton, plainText } from "@/components/ChatMarkdown";
import { ASSISTANT_STORAGE_KEY, clearAssistantConversation } from "@/lib/assistant/storage";

type Labels = Dictionary["assistant"];

interface ChatItem {
  role: "user" | "assistant";
  text: string;
  tools: string[];
  state: "streaming" | "done" | "failed";
  notice?: string;
}

/** The conversation as Claude's API needs it back; the browser keeps it as it came and never edits it. */
type ApiHistory = unknown[];

interface Conversation {
  history: ApiHistory;
  /** The server's signature of `history`: it only accepts a conversation it handed out to this person. */
  signature: string;
  items: ChatItem[];
  /** The conversation reached its size limit: a new one is needed for the next question. */
  full: boolean;
}

const EMPTY: Conversation = { history: [], signature: "", items: [], full: false };

/** The saved conversation, only when it belongs to the person signed in now. */
function readSaved(userId: string): Conversation | null {
  try {
    const raw = sessionStorage.getItem(ASSISTANT_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved?.userId !== userId || !Array.isArray(saved.history) || !Array.isArray(saved.items)) return null;
    return { history: saved.history, signature: String(saved.signature ?? ""), items: saved.items, full: saved.full === true };
  } catch {
    return null;
  }
}

function save(userId: string, conversation: Conversation) {
  if (conversation.items.length === 0) {
    clearAssistantConversation();
    return;
  }
  try {
    sessionStorage.setItem(ASSISTANT_STORAGE_KEY, JSON.stringify({ userId, ...conversation }));
  } catch {
    // storage full or blocked: drop the older copy too, so it is never brought back as if it were current
    clearAssistantConversation();
  }
}

const joinSteps = (a: string, b: string) => (a && b ? `${a}\n\n${b}` : a + b);

export default function AssistantChat({ t, userId }: { t: Labels; userId: string }) {
  const [conversation, setConversation] = useState<Conversation>(EMPTY);
  const { history, signature, items, full } = conversation;
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [restored, setRestored] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // the latest values, for saving when the page is left in the middle of an answer
  const latest = useRef({ conversation, t, userId });
  useEffect(() => {
    latest.current = { conversation, t, userId };
  });
  const copyLabels = { copy: t.copy, copied: t.copied };

  // the conversation stays while moving around the app (until the tab is closed or the person signs out)
  useEffect(() => {
    const saved = readSaved(userId);
    if (saved) {
      setConversation({ ...saved, items: saved.items.map((item) => (item.state === "streaming" ? { ...item, state: "failed" } : item)) });
    }
    setRestored(true);
  }, [userId]);

  useEffect(() => {
    if (restored && !busy) save(userId, conversation);
  }, [restored, busy, userId, conversation]);

  // leaving the page (or reloading / closing the tab) mid-answer stops the answer, so it isn't paid
  // for, and keeps the question visible as not kept
  useEffect(() => {
    const stopAndSave = () => {
      if (!abortRef.current) return;
      abortRef.current.abort();
      abortRef.current = null;
      const { conversation: current, t: labels, userId: owner } = latest.current;
      save(owner, {
        ...current,
        items: current.items.map((item, index) =>
          index === current.items.length - 1 && item.state === "streaming"
            ? { ...item, state: "failed", notice: `${labels.stopped} ${labels.notKept}` }
            : item,
        ),
      });
    };
    window.addEventListener("pagehide", stopAndSave);
    return () => {
      window.removeEventListener("pagehide", stopAndSave);
      stopAndSave();
    };
  }, []);

  // keep the newest text in view while it is written, unless the person scrolled up to read
  useEffect(() => {
    const onScroll = () => {
      followRef.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (followRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [items]);

  const updateLast = (patch: Partial<ChatItem>) =>
    setConversation((prev) => {
      if (prev.items.length === 0) return prev; // the conversation was cleared meanwhile
      const next = [...prev.items];
      next[next.length - 1] = { ...next[next.length - 1], ...patch };
      return { ...prev, items: next };
    });

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy || full) return;
    const controller = new AbortController();
    abortRef.current = controller;
    followRef.current = true;
    setBusy(true);
    setInput("");
    setStatus("");
    setConversation((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        { role: "user", text, tools: [], state: "done" },
        { role: "assistant", text: "", tools: [], state: "streaming" },
      ],
    }));

    let committed = "";
    let step = "";
    const tools: string[] = [];
    let finished = false;
    const fail = (notice: string, extra?: Partial<Conversation>) => {
      finished = true;
      const message = `${notice} ${t.notKept}`;
      updateLast({ text: joinSteps(committed, step), state: "failed", notice: message });
      if (extra) setConversation((prev) => ({ ...prev, ...extra }));
      setStatus(message);
    };

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history, signature, question: text }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        if (body?.error === "signedOut") clearAssistantConversation();
        const known: Record<string, string> = {
          signedOut: t.errors.signedOut,
          tooLong: t.errors.tooLongConversation,
          invalidConversation: t.errors.invalidConversation,
          notConfigured: t.errors.notConfigured,
        };
        const needsNew = body?.error === "tooLong" || body?.error === "invalidConversation";
        fail(known[body?.error] ?? t.errors.internal, needsNew ? { full: true } : undefined);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          switch (event.type) {
            case "text":
              step += event.text;
              updateLast({ text: joinSteps(committed, step) });
              break;
            case "tool":
              if (!tools.includes(event.name)) tools.push(event.name);
              updateLast({ tools: [...tools] });
              break;
            case "step_discard":
              step = "";
              updateLast({ text: committed });
              break;
            case "step_end":
              committed = joinSteps(committed, step);
              step = "";
              break;
            case "done": {
              finished = true;
              const notes = [
                event.note === "truncated" ? t.truncated : event.note === "too_many_steps" ? t.tooManySteps : "",
                event.full ? t.errors.tooLongConversation : "",
              ].filter(Boolean);
              setConversation((prev) => ({ ...prev, history: event.history, signature: event.signature ?? "", full: event.full === true }));
              updateLast({ text: joinSteps(committed, step), state: "done", notice: notes.join(" ") || undefined });
              setStatus(t.answerReady);
              break;
            }
            case "refusal":
              committed = "";
              step = "";
              fail(t.refusal);
              break;
            case "error": {
              const messages: Record<string, string> = {
                auth: t.errors.auth,
                billing: t.errors.billing,
                rate: t.errors.rate,
                overloaded: t.errors.overloaded,
                network: t.errors.network,
                timeout: t.errors.timeout,
                conversation_too_long: t.errors.tooLongConversation,
                request: t.errors.request,
                too_long: t.errors.tooLongAnswer,
              };
              fail(
                [messages[event.code] ?? t.errors.internal, event.detail ? `(${event.detail})` : ""].filter(Boolean).join(" "),
                event.code === "conversation_too_long" ? { full: true } : undefined,
              );
              break;
            }
          }
        }
      }
      if (!finished) fail(t.errors.network);
    } catch {
      if (controller.signal.aborted) {
        finished = true;
        updateLast({ text: joinSteps(committed, step), state: "failed", notice: `${t.stopped} ${t.notKept}` });
      } else if (!finished) {
        fail(t.errors.network);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function newConversation() {
    abortRef.current?.abort();
    abortRef.current = null;
    setConversation(EMPTY);
    setInput("");
    setStatus("");
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-stone-900">{t.title}</h1>
          <p className="mt-1 text-sm text-stone-500">{t.subtitle}</p>
        </div>
        {items.length > 0 && (
          <button type="button" className="btn-secondary" onClick={newConversation}>
            {t.newChat}
          </button>
        )}
      </div>

      {restored && items.length === 0 && (
        <div className="card space-y-3">
          <p className="text-sm font-medium text-stone-700">{t.suggestionsHeading}</p>
          <div className="flex flex-col gap-2">
            {t.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => ask(suggestion)}
                className="rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-left text-sm text-stone-700 hover:border-brand-200 hover:bg-brand-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
          <p className="text-xs text-stone-500">{t.disclaimer}</p>
        </div>
      )}

      {/* screen readers hear a short line when an answer is ready or fails, not every word as it streams */}
      <p role="status" className="sr-only">
        {status}
      </p>

      <div className="flex flex-col gap-4">
        {items.map((item, index) =>
          item.role === "user" ? (
            <div key={index} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-sm text-white">
                {item.text}
              </div>
            </div>
          ) : (
            <div key={index} className="card space-y-2 !p-4" aria-busy={item.state === "streaming"}>
              {item.tools.length > 0 && (
                <p className="text-xs text-stone-400">
                  {t.lookedAt} {item.tools.map((name) => t.tools[name as keyof Labels["tools"]] ?? name).join(", ")}
                </p>
              )}
              {item.text ? (
                <ChatMarkdown text={item.text} labels={copyLabels} />
              ) : item.state === "streaming" ? (
                <p className="flex items-center gap-2 text-sm text-stone-500">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" />
                  {t.thinking}
                </p>
              ) : null}
              {item.notice && (
                <p className={`text-sm ${item.state === "failed" ? "text-red-700" : "text-stone-500"}`}>{item.notice}</p>
              )}
              {item.state === "done" && item.text && (
                <div className="flex justify-end border-t border-stone-100 pt-1">
                  <CopyButton text={plainText(item.text)} labels={copyLabels} />
                </div>
              )}
            </div>
          ),
        )}
      </div>

      <form
        className="sticky bottom-0 -mx-2 bg-paper px-2 pb-4 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        {full ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2">
            <p className="text-sm text-stone-600">{t.errors.tooLongConversation}</p>
            <button type="button" className="btn-primary min-h-[44px]" onClick={newConversation}>
              {t.newChat}
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              className="input min-h-[44px] flex-1 resize-none"
              rows={Math.min(6, Math.max(1, input.split("\n").length))}
              value={input}
              maxLength={4000}
              placeholder={t.placeholder}
              aria-label={t.placeholder}
              enterKeyHint="enter"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // with a keyboard, Enter sends (Shift+Enter for a new line); on a phone, Return makes a new line and the button sends
                const keyboard = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
                if (keyboard && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  ask(input);
                }
              }}
            />
            {busy ? (
              <button type="button" className="btn-secondary min-h-[44px]" onClick={() => abortRef.current?.abort()}>
                {t.stop}
              </button>
            ) : (
              <button type="submit" className="btn-primary min-h-[44px]" disabled={!input.trim()}>
                {t.send}
              </button>
            )}
          </div>
        )}
      </form>
      <div ref={endRef} />
    </div>
  );
}

"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { addMonths } from "@/lib/ledger";

type Kind = { value: string; label: string };

type Labels = {
  kind: string;
  monthsPaid: string;
  monthsHelp: string;
  amount: string;
  date: string;
  method: string;
  methodPlaceholder: string;
  notes: string;
  notesPlaceholder: string;
  receiptOptional: string;
  attachmentHint: string;
  recordPaymentHint: string;
  nonRentHint: string;
  submit: string;
  saving: string;
  /** "{period} · paid until {until}" */
  previewTemplate: string;
};

const MONTH_CHOICES = [1, 2, 3, 6, 12];
const RENT_KINDS = ["RENT", "ARREARS"];
const DAY_MS = 24 * 60 * 60 * 1000;

function clampMonths(value: number): number {
  return Math.min(Math.max(Math.round(value) || 1, 1), 60);
}

function SubmitButton({ label, saving }: { label: string; saving: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full disabled:opacity-60" disabled={pending}>
      {pending ? saving : label}
    </button>
  );
}

export default function PaymentForm({
  action,
  kinds,
  defaultKind,
  rentPerMonth,
  billingStartIso,
  paidMonths,
  defaultOtherAmount,
  todayIso,
  locale,
  labels,
}: {
  action: (formData: FormData) => void | Promise<void>;
  kinds: Kind[];
  defaultKind: string;
  rentPerMonth: number;
  /** The date billing starts from (YYYY-MM-DD); Paid Until = billing start + months paid − 1 day, as on the server. */
  billingStartIso: string;
  /** Whole months already paid since the billing start. */
  paidMonths: number;
  /** Suggested amount for payments that are not rent (deposit...). */
  defaultOtherAmount: number | "";
  todayIso: string;
  locale: string;
  labels: Labels;
}) {
  const [kind, setKind] = useState(defaultKind);
  const [months, setMonths] = useState(1);
  const [monthsText, setMonthsText] = useState("1"); // what is typed in the box, checked when it loses focus
  const rentLike = RENT_KINDS.includes(kind);
  const suggested = rentLike ? (rentPerMonth > 0 ? Math.round(months * rentPerMonth) : "") : defaultOtherAmount;
  const [typed, setTyped] = useState<string | null>(null); // set once staff type their own amount
  const amount = typed ?? String(suggested);

  const billingStart = new Date(`${billingStartIso}T00:00:00Z`);
  const start = addMonths(billingStart, paidMonths);
  const end = new Date(addMonths(billingStart, paidMonths + months).getTime() - DAY_MS);
  const monthYear = new Intl.DateTimeFormat(locale, { month: "short", year: "numeric", timeZone: "UTC" });
  const monthOnly = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  const longDate = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const period =
    months === 1
      ? monthYear.format(start)
      : start.getUTCFullYear() === end.getUTCFullYear()
        ? `${monthOnly.format(start)} – ${monthYear.format(end)}`
        : `${monthYear.format(start)} – ${monthYear.format(end)}`;
  const preview = labels.previewTemplate.replace("{period}", period).replace("{until}", longDate.format(end));

  function chooseMonths(value: number) {
    const n = clampMonths(value);
    setMonths(n);
    setMonthsText(String(n));
    setTyped(null); // the amount follows the months again
  }

  return (
    <form action={action} className="space-y-3">
      <div>
        <label className="label" htmlFor="kind">{labels.kind}</label>
        <select
          className="input"
          id="kind"
          name="kind"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setTyped(null);
          }}
        >
          {kinds.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>

      {rentLike && (
        <div>
          <label className="label" htmlFor="months">{labels.monthsPaid}</label>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={labels.monthsPaid}>
            {MONTH_CHOICES.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={months === n}
                onClick={() => chooseMonths(n)}
                className={`min-h-11 min-w-11 rounded-lg border px-3 text-sm font-medium ${
                  months === n ? "border-brand-600 bg-brand-600 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
                }`}
              >
                {n}
              </button>
            ))}
            <input
              className="input !w-20 min-h-11"
              id="months"
              name="months"
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              step={1}
              required
              value={monthsText}
              onChange={(e) => {
                setMonthsText(e.target.value);
                const n = Number(e.target.value);
                if (e.target.value !== "" && Number.isInteger(n) && n >= 1 && n <= 60) {
                  setMonths(n);
                  setTyped(null);
                }
              }}
              onBlur={() => chooseMonths(Number(monthsText))}
            />
          </div>
          <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800" aria-live="polite">
            {preview}
          </p>
          <p className="mt-1 text-xs text-stone-500">{labels.monthsHelp}</p>
        </div>
      )}

      <div>
        <label className="label" htmlFor="amount">{labels.amount}</label>
        <input
          className="input"
          id="amount"
          name="amount"
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          required
          value={amount}
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor="date">{labels.date}</label>
        <input className="input" id="date" name="date" type="date" required defaultValue={todayIso} />
      </div>
      <div>
        <label className="label" htmlFor="method">{labels.method}</label>
        <input className="input" id="method" name="method" placeholder={labels.methodPlaceholder} />
      </div>
      <div>
        <label className="label" htmlFor="notes">{labels.notes}</label>
        <input className="input" id="notes" name="notes" placeholder={labels.notesPlaceholder} />
      </div>
      <div>
        <label className="label" htmlFor="file">{labels.receiptOptional}</label>
        <input
          className="input"
          id="file"
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
        />
        <p className="mt-1 text-xs text-stone-500">{labels.attachmentHint}</p>
      </div>
      <p className="text-xs text-stone-500">{labels.recordPaymentHint}</p>
      <p className="text-xs text-stone-500">{labels.nonRentHint}</p>
      <SubmitButton label={labels.submit} saving={labels.saving} />
    </form>
  );
}

import { requireUserWithDictionary } from "@/lib/auth";
import { assistantConfigured } from "@/lib/assistant/run";
import AssistantChat from "@/components/AssistantChat";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const { user, t } = await requireUserWithDictionary();

  // until an administrator adds the Anthropic key on Vercel, say how to switch it on
  if (!assistantConfigured()) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">{t.assistant.title}</h1>
          <p className="mt-1 text-sm text-stone-500">{t.assistant.subtitle}</p>
        </div>
        <div className="card space-y-3">
          <h2 className="font-semibold text-stone-900">{t.assistant.setupTitle}</h2>
          {user.role === "ADMIN" ? (
            <>
              <p className="text-sm text-stone-600">{t.assistant.setupIntro}</p>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-700">
                {t.assistant.setupSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </>
          ) : (
            <p className="text-sm text-stone-600">{t.assistant.setupManager}</p>
          )}
        </div>
      </div>
    );
  }

  return <AssistantChat t={t.assistant} />;
}

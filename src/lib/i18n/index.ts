import { en } from "./en";
import { fr } from "./fr";
import type { Language } from "@prisma/client";

export type Dictionary = typeof en;

const dictionaries: Record<Language, Dictionary> = { EN: en, FR: fr };

export function getDictionary(language: Language): Dictionary {
  return dictionaries[language];
}

export function localeFor(language: Language): string {
  return language === "FR" ? "fr-FR" : "en-US";
}

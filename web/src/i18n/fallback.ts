import { en, type Messages } from "./en";

/** Every key optional, all the way down; a function stays whole. */
type DeepPartial<T> = T extends (...args: never[]) => unknown ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

/**
 * A translation still catching up with the English one. Whatever it lacks is said in English,
 * so a language added by the community keeps working when new screens arrive before their words.
 */
export type Translation = DeepPartial<Messages>;

function merge(base: unknown, over: unknown): unknown {
  if (over === undefined) return base;
  const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (!isObject(base) || !isObject(over)) return over;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(over)) out[key] = merge(base[key], over[key]);
  return out;
}

export const withEnglish = (translation: Translation): Messages => merge(en, translation) as Messages;

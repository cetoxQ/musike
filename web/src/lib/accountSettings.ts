import { create } from "zustand";
import { api } from "./api";
import { isPeriod, type PeriodId } from "./periods";
import { useAppearance } from "../stores/appearance";

// Settings that follow the account to every device, with a server: the accent colour and the period the profile
// opens on. Without one (the phone on its own), they stay on the device like the others.

export interface AccountSettings {
  accent: string | null;
  profilePeriod: PeriodId | null;
}

export const useAccountSettings = create<AccountSettings & { loaded: boolean }>(() => ({
  accent: null,
  profilePeriod: null,
  loaded: false,
}));

/** Fetched at start, when the account changes, and when another device changed them. */
export async function loadAccountSettings() {
  try {
    const s = await api.profileSettings();
    const profilePeriod = isPeriod(s.profilePeriod) ? s.profilePeriod : null;
    useAccountSettings.setState({ accent: s.accent, profilePeriod, loaded: true });
    // The account's colour on this device too (set first above, so it isn't sent back).
    if (s.accent && s.accent !== useAppearance.getState().accent) useAppearance.getState().set({ accent: s.accent });
  } catch {
    useAccountSettings.setState({ loaded: true });
  }
}

export function saveAccountSettings(patch: Partial<AccountSettings>) {
  useAccountSettings.setState(patch);
  void api.setProfileSettings(patch).catch(() => {});
}

// A colour picked on this device goes to the account.
useAppearance.subscribe((a, before) => {
  const s = useAccountSettings.getState();
  if (!s.loaded || a.accent === before.accent || a.accent === s.accent) return;
  saveAccountSettings({ accent: a.accent });
});

import { create } from "zustand";
import { api, authEvents, type AuthUser } from "../lib/api";

/** What one browser remembers between users: cleared when someone else signs in, or on sign-out. */
const PER_USER_KEYS = ["musike:player", "musike:recent-searches"];
const LAST_USER_KEY = "musike:user";

function forgetPreviousUser() {
  try {
    for (const k of PER_USER_KEYS) localStorage.removeItem(k);
  } catch {
    /* private mode */
  }
}

interface AuthState {
  status: "loading" | "ready";
  /** Accounts on this server. Off: everyone shares the library, no sign-in. */
  enabled: boolean;
  /** Nobody has a password yet: the first visit creates the admin. */
  setup: boolean;
  user: AuthUser | null;
  load: () => Promise<void>;
  setupAdmin: (username: string, password: string, code: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (current: string, password: string) => Promise<void>;
}

/** Someone else than last time on this browser: their queue and recent searches go. */
function rememberUser(user: AuthUser) {
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_USER_KEY);
    localStorage.setItem(LAST_USER_KEY, String(user.id));
  } catch {
    /* private mode */
  }
  if (last !== String(user.id)) forgetPreviousUser();
}

export const useAuth = create<AuthState>((set, get) => {
  /** Signed in: start the app fresh for this user (a reload, so no store keeps the previous user's data). */
  const signedIn = (user: AuthUser) => {
    rememberUser(user);
    location.replace(location.pathname + location.search);
  };

  // The server ended the session (expired, signed out elsewhere, password reset) or wants a new password.
  authEvents.listener = (code) => {
    const { user, enabled } = get();
    if (!enabled) return;
    if (code === "auth_required") set({ user: null });
    else if (user && !user.mustChangePassword) set({ user: { ...user, mustChangePassword: true } });
  };

  return {
    status: "loading",
    enabled: false,
    setup: false,
    user: null,

    load: async () => {
      try {
        const s = await api.authStatus();
        set({ status: "ready", enabled: s.enabled, setup: s.setup, user: s.user });
      } catch {
        // Server unreachable: open the app, which says so where it matters.
        set({ status: "ready", enabled: false });
      }
    },

    setupAdmin: async (username, password, code) => {
      const { user } = await api.setup(username, password, code);
      signedIn(user);
    },

    login: async (username, password) => {
      const { user } = await api.login(username, password);
      if (user.mustChangePassword) {
        rememberUser(user);
        set({ user, setup: false });
        return;
      }
      signedIn(user);
    },

    logout: async () => {
      await api.logout().catch(() => {});
      forgetPreviousUser();
      location.replace("/");
    },

    changePassword: async (current, password) => {
      const before = get().user;
      const { user } = await api.changePassword(current, password);
      // A temporary password was just replaced: now the app can open, fresh.
      if (before?.mustChangePassword) signedIn(user);
      else set({ user });
    },
  };
});

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useT } from "../i18n";
import { useAuth } from "../stores/auth";
import { Logo } from "./Brand";

/** A labeled text field, styled like the app's other inputs. */
export function Field({
  id,
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
  autoFocus,
}: {
  id: string;
  label: string;
  type?: "text" | "password";
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  autoFocus?: boolean;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="px-1 text-sm text-fg-2">{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 rounded-full border border-line-strong bg-surface-1 px-5 text-[15px] placeholder:text-fg-3 focus:border-accent focus:outline-none"
      />
    </label>
  );
}

export const primaryButton =
  "flex h-12 items-center justify-center rounded-full bg-accent px-6 font-semibold text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50";

/** Runs a form action, showing its error under the form. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function Screen({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <div className="grain flex min-h-dvh items-center justify-center bg-bg p-4">
      <div className="island w-full max-w-sm">
        <div className="island-core flex flex-col gap-5 p-6">
          <Logo />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-fg-2">{body}</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function ErrorText({ text }: { text: string }) {
  return text ? (
    <p role="alert" className="px-1 text-sm text-danger">
      {text}
    </p>
  ) : null;
}

/** Sign in, or (first visit) create the admin. */
function SignInScreen({ setup }: { setup: boolean }) {
  const t = useT();
  const { login, setupAdmin } = useAuth();
  const [username, setUsername] = useState(setup ? "admin" : "");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const { busy, error, setError, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (setup) {
      if (password.length < 8) return setError(t.account.tooShort);
      if (password !== repeat) return setError(t.account.mismatch);
      return void run(() => setupAdmin(username.trim(), password));
    }
    void run(() => login(username.trim(), password));
  };

  return (
    <Screen title={setup ? t.account.setupTitle : t.account.signInTitle} body={setup ? t.account.setupBody : t.account.signInBody}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field id="auth-user" label={t.account.username} value={username} onChange={setUsername} autoComplete="username" autoFocus={!setup} />
        <Field
          id="auth-password"
          label={t.account.password}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete={setup ? "new-password" : "current-password"}
          autoFocus={setup}
        />
        {setup && (
          <Field id="auth-repeat" label={t.account.repeatPassword} type="password" value={repeat} onChange={setRepeat} autoComplete="new-password" />
        )}
        <ErrorText text={error} />
        <button type="submit" disabled={busy || !username.trim() || !password} className={`${primaryButton} mt-1`}>
          {busy ? t.account.working : setup ? t.account.createAdmin : t.account.signIn}
        </button>
      </form>
    </Screen>
  );
}

/** Current password, new one twice. In Settings, and full screen after a temporary password. */
export function PasswordForm({ temporary, onDone }: { temporary?: boolean; onDone?: () => void }) {
  const t = useT();
  const changePassword = useAuth((s) => s.changePassword);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const { busy, error, setError, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError(t.account.tooShort);
    if (password !== repeat) return setError(t.account.mismatch);
    void run(async () => {
      await changePassword(current, password);
      onDone?.();
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field
        id="pw-current"
        label={temporary ? t.account.temporaryPassword : t.account.currentPassword}
        type="password"
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
        autoFocus
      />
      <Field id="pw-new" label={t.account.newPassword} type="password" value={password} onChange={setPassword} autoComplete="new-password" />
      <Field id="pw-repeat" label={t.account.repeatPassword} type="password" value={repeat} onChange={setRepeat} autoComplete="new-password" />
      <ErrorText text={error} />
      <button type="submit" disabled={busy || !current || !password} className={`${primaryButton} mt-1`}>
        {busy ? t.account.working : t.account.save}
      </button>
    </form>
  );
}

/**
 * Shows the app only to who may see it: with accounts on, the sign-in (or first setup) screen until signed in,
 * and the new-password screen after a temporary password. With accounts off, the app straight away.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const t = useT();
  const { status, enabled, setup, user, load, logout } = useAuth();

  useEffect(() => {
    void load();
  }, [load]);

  if (status === "loading") return <div className="h-dvh bg-bg" />;
  if (!enabled) return <>{children}</>;
  if (!user) return <SignInScreen setup={setup} />;
  if (user.mustChangePassword) {
    return (
      <Screen title={t.account.newPasswordTitle} body={t.account.newPasswordBody}>
        <PasswordForm temporary />
        <button type="button" onClick={() => void logout()} className="h-10 text-sm font-medium text-fg-2 hover:text-fg">
          {t.account.signOut}
        </button>
      </Screen>
    );
  }
  return <>{children}</>;
}

import { CopySimpleIcon, KeyIcon, SignOutIcon, UserPlusIcon } from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";
import { useT } from "../i18n";
import { api, type Role, type UserInfo } from "../lib/api";
import { cn } from "../lib/format";
import { useAuth } from "../stores/auth";
import { toast } from "../stores/ui";
import { Field, PasswordForm } from "./AuthScreens";

const action =
  "flex h-11 items-center justify-center gap-2 rounded-full bg-surface-1 px-4 text-sm font-medium ring-1 ring-line transition-[transform,background-color] hover:bg-surface-3 active:scale-[0.98] disabled:opacity-50";
const small = "h-8 rounded-full px-3 text-xs font-medium ring-1 ring-line hover:bg-surface-3 disabled:opacity-50";

/** Copies text, also on plain HTTP (where navigator.clipboard doesn't exist). */
function copy(text: string): boolean {
  const area = Object.assign(document.createElement("textarea"), { value: text });
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    /* not allowed: the text stays selectable on screen */
  }
  area.remove();
  return ok;
}

/** A temporary password, shown once, selectable and with a copy button. */
function Secret({ name, password, onClose }: { name: string; password: string; onClose: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="flex flex-col gap-2 rounded-[12px] bg-accent-soft p-3 ring-1 ring-accent/40">
      <p className="text-sm font-medium">{t.account.tempFor(name)}</p>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={password}
          onFocus={(e) => e.target.select()}
          aria-label={t.account.tempFor(name)}
          className="h-10 min-w-0 flex-1 rounded-full bg-bg px-4 font-mono text-[15px] tracking-wide ring-1 ring-line focus:outline-none"
        />
        <button type="button" onClick={() => setCopied(copy(password))} className={cn(small, "flex h-10 items-center gap-1.5 bg-surface-1")}>
          <CopySimpleIcon size={16} /> {copied ? t.account.copied : t.account.copy}
        </button>
      </div>
      <p className="text-xs text-fg-2">{t.account.tempNote}</p>
      <button type="button" onClick={onClose} className="self-end text-xs font-medium text-fg-2 hover:text-fg">
        {t.common.close}
      </button>
    </div>
  );
}

/** Admins: everyone's accounts. Their own row has no actions (no locking yourself out). */
function UsersAdmin({ me }: { me: number }) {
  const t = useT();
  const [list, setList] = useState<UserInfo[] | null>(null);
  const [secret, setSecret] = useState<{ name: string; password: string } | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | "new" | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("user");

  const refresh = () =>
    api
      .users()
      .then(setList)
      .catch((e) => toast((e as Error).message, "error"));
  useEffect(() => {
    void refresh();
  }, []);

  const act = async (id: number | "new", fn: () => Promise<void>) => {
    setBusy(id);
    try {
      await fn();
      await refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    void act("new", async () => {
      const r = await api.createUser(name.trim(), role);
      setSecret({ name: r.user.username, password: r.password });
      setName("");
      setRole("user");
    });
  };

  const seen = (u: UserInfo) =>
    u.lastSeen
      ? t.account.lastSeen(new Date(u.lastSeen).toLocaleString(t.locale, { dateStyle: "short", timeStyle: "short" }))
      : t.account.neverSignedIn;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-medium text-fg-3">{t.account.users}</h3>
      <p className="text-sm text-fg-2">{t.account.usersBody}</p>

      {secret && <Secret {...secret} onClose={() => setSecret(null)} />}

      <ul className="flex flex-col divide-y divide-line rounded-[16px] bg-surface-1 px-4 ring-1 ring-line">
        {list?.map((u) => (
          <li key={u.id} className="flex flex-col gap-2 py-3">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {u.username} {u.id === me && <span className="text-fg-3">({t.account.you})</span>}
                </span>
                <span className="block text-xs text-fg-2">
                  {u.mustChangePassword ? t.account.passwordDue : seen(u)}
                </span>
              </span>
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium",
                  u.role === "admin" ? "bg-accent-soft text-accent-text" : "bg-surface-3 text-fg-2",
                )}
              >
                {u.role === "admin" ? t.account.admin : t.account.user}
              </span>
            </div>
            {u.id !== me && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={busy === u.id}
                  onClick={() =>
                    void act(u.id, async () => {
                      const r = await api.resetUserPassword(u.id);
                      setSecret({ name: u.username, password: r.password });
                    })
                  }
                  className={small}
                >
                  {t.account.resetPassword}
                </button>
                <button
                  type="button"
                  disabled={busy === u.id}
                  onClick={() =>
                    void act(u.id, async () => {
                      const r = await api.setUserRole(u.id, u.role === "admin" ? "user" : "admin");
                      toast(t.account.roleChanged(r.user.username, r.user.role === "admin"));
                    })
                  }
                  className={small}
                >
                  {u.role === "admin" ? t.account.makeUser : t.account.makeAdmin}
                </button>
                {confirm === u.id ? (
                  <button
                    type="button"
                    disabled={busy === u.id}
                    onClick={() =>
                      void act(u.id, async () => {
                        await api.deleteUser(u.id);
                        setConfirm(null);
                        toast(t.account.deleted(u.username));
                      })
                    }
                    className={cn(small, "bg-danger text-white ring-danger")}
                  >
                    {t.account.deleteForGood(u.username)}
                  </button>
                ) : (
                  <button type="button" onClick={() => setConfirm(u.id)} className={cn(small, "text-danger")}>
                    {t.account.delete}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={create} className="flex flex-col gap-2 rounded-[16px] bg-surface-1 p-4 ring-1 ring-line">
        <p className="text-sm font-medium">{t.account.newUser}</p>
        <Field id="new-user" label={t.account.username} value={name} onChange={setName} autoComplete="off" />
        <div role="radiogroup" aria-label={t.account.role} className="flex rounded-full bg-bg p-1 ring-1 ring-line">
          {(["user", "admin"] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={role === r}
              onClick={() => setRole(r)}
              className={cn(
                "h-9 flex-1 rounded-full text-[13px] font-medium",
                role === r ? "bg-surface-4 text-fg" : "text-fg-2 hover:text-fg",
              )}
            >
              {r === "admin" ? t.account.admin : t.account.user}
            </button>
          ))}
        </div>
        <button type="submit" disabled={!name.trim() || busy === "new"} className={cn(action, "mt-1 bg-accent text-accent-ink ring-0 hover:bg-accent")}>
          <UserPlusIcon size={18} /> {busy === "new" ? t.account.working : t.account.create}
        </button>
      </form>
    </div>
  );
}

/** Settings, with accounts on: who you are, your password, signing out; and for admins, the accounts. */
export function AccountSection() {
  const t = useT();
  const { enabled, user, logout } = useAuth();
  const [changing, setChanging] = useState(false);
  if (!enabled || !user) return null;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-medium text-fg-3">{t.account.title}</h3>
        <div className="flex flex-col gap-3 rounded-[16px] bg-surface-1 p-4 ring-1 ring-line">
          <p className="text-sm">
            {t.account.signedInAs(user.username)}
            <span className="text-fg-3"> · {user.role === "admin" ? t.account.admin : t.account.user}</span>
          </p>
          {changing ? (
            <PasswordForm
              onDone={() => {
                setChanging(false);
                toast(t.account.passwordChanged);
              }}
            />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setChanging(true)} className={action}>
                <KeyIcon size={18} /> {t.account.changePassword}
              </button>
              <button type="button" onClick={() => void logout()} className={action}>
                <SignOutIcon size={18} /> {t.account.signOut}
              </button>
            </div>
          )}
        </div>
      </div>
      {user.role === "admin" && <UsersAdmin me={user.id} />}
    </section>
  );
}

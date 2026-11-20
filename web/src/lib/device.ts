/** One id per tab (sessionStorage): two tabs are two devices, a reload is the same one. */
export function deviceId(): string {
  const key = "musike:device";
  try {
    const known = sessionStorage.getItem(key);
    if (known) return known;
    const id = crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return (fallback ??= Math.random().toString(36).slice(2) + Date.now().toString(36));
  }
}

let fallback: string | undefined;

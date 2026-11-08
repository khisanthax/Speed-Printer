import type { Bundle, Summary } from "./domain";
export class Helper {
  token = "";
  private identity?: {
    id: string;
    privateKey: CryptoKey;
    publicKey: JsonWebKey;
  };
  private resuming?: Promise<void>;
  private async browserIdentity() {
    if (this.identity) return this.identity;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("speed-printer-trust", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("identity");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const saved = await new Promise<typeof this.identity>((resolve, reject) => {
      const r = db
        .transaction("identity")
        .objectStore("identity")
        .get("browser");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (saved) {
      db.close();
      return (this.identity = saved);
    }
    const pair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    );
    const identity = {
      id: crypto.randomUUID(),
      privateKey: pair.privateKey,
      publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("identity", "readwrite");
      tx.objectStore("identity").put(identity, "browser");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return (this.identity = identity);
  }
  private async proof(code?: string) {
    const identity = await this.browserIdentity();
    const challenge = await this.request<{
      id: string;
      message: string;
      legacySession?: boolean;
    }>("/auth/challenge", { clientId: identity.id });
    // Explicit fixture servers only. Production helper never enables this protocol.
    if (challenge.legacySession && code) {
      this.token = code;
      return;
    }
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        identity.privateKey,
        new TextEncoder().encode(challenge.message),
      ),
    );
    const encoded = btoa(String.fromCharCode(...signature))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    const result = await this.request<{ token: string }>(
      code ? "/auth/pair" : "/auth/resume",
      {
        clientId: identity.id,
        challenge: challenge.id,
        signature: encoded,
        ...(code ? { code, publicKey: identity.publicKey } : {}),
      },
    );
    this.token = result.token;
  }
  async pair(code: string) {
    await this.proof(code);
  }
  async resume() {
    if (!this.resuming)
      this.resuming = this.proof().finally(() => {
        this.resuming = undefined;
      });
    return this.resuming;
  }
  async revoke() {
    await this.call("/auth/revoke", {});
    this.token = "";
  }
  private async request<T>(path: string, data?: unknown): Promise<T> {
    const controller = new AbortController();
    // Native dialogs and slices can take time; only auth/heartbeat have short timeouts.
    const timeout =
      path.startsWith("/auth/") || path === "/health"
        ? setTimeout(() => controller.abort(), 5000)
        : undefined;
    try {
      const r = await fetch(`http://127.0.0.1:8377${path}`, {
        signal: controller.signal,
        method: data === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(data === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      const result = await r.json();
      if (!r.ok)
        throw Object.assign(
          new Error(result.error || `Helper returned ${r.status}`),
          { status: r.status },
        );
      return result as T;
    } finally {
      clearTimeout(timeout);
    }
  }
  async call<T>(path: string, data?: unknown): Promise<T> {
    try {
      return await this.request<T>(path, data);
    } catch (e) {
      if ((e as { status?: number }).status !== 403) throw e;
      await this.resume();
      return this.request<T>(path, data);
    }
  }
  slice(bundle: Bundle, model: string) {
    return this.call<{ id: string }>("/slice", { bundle, model });
  }
  job(id: string) {
    return this.call<{ state: string; result?: Summary; error?: string }>(
      `/jobs/${id}`,
    );
  }
}

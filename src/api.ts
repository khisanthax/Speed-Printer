import type { Bundle, Summary } from "./domain";
export class Helper {
  token = "";
  private identity?: {
    id: string;
    privateKey: CryptoKey;
    publicKey: JsonWebKey;
  };
  private resuming?: Promise<void>;
  private discovery?: Promise<void>;
  private approvalAttempt = "";
  connectionStatus = "Helper disconnected · launch the tray helper";
  onStatus?: (status: string) => void;
  private status(value: string) { this.connectionStatus = value; this.onStatus?.(value); }
  retryApproval() { this.approvalAttempt = ""; }
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
  private async proof(code?: string, approval = false, instance = "") {
    const identity = await this.browserIdentity();
    const challenge = await this.request<{
      id: string;
      message: string;
      legacySession?: boolean;
      paired?: boolean;
      revoked?: boolean;
    }>("/auth/challenge", { clientId: identity.id });
    // Explicit fixture servers only. Production helper never enables this protocol.
    if (challenge.legacySession && code) {
      this.token = code;
      return;
    }
    if (approval && challenge.revoked)
      throw new Error("Trust revoked · use the fallback code to explicitly pair again");
    const nativeApproval = approval && challenge.paired === false;
    if (nativeApproval) {
      if (this.approvalAttempt === instance) throw new Error(this.connectionStatus);
      this.approvalAttempt = instance;
      this.status("Helper found · approve this website in the Windows dialog");
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
      code ? "/auth/pair" : nativeApproval ? "/auth/approve" : "/auth/resume",
      {
        clientId: identity.id,
        challenge: challenge.id,
        signature: encoded,
        ...(code || nativeApproval ? { ...(code ? {code} : {}), publicKey: identity.publicKey } : {}),
      },
    );
    this.token = result.token;
  }
  async pair(code: string) {
    await this.proof(code);
  }
  async discover() {
    if (this.token) return;
    if (!this.discovery) this.discovery = (async () => {
      let found: {instance: string; approval: boolean};
      try { found = await this.request("/discover"); }
      catch (e) {
        // Older helpers retain the signed resume/code fallback.
        if ((e as {status?: number}).status === 404) { await this.resume(); return; }
        this.status("Helper unreachable · start it, or allow local/loopback access in this browser's site settings");
        throw e;
      }
      if (!found.approval) { await this.resume(); return; }
      try { await this.proof(undefined, true, found.instance); }
      catch (e) { this.status(String(e)); throw e; }
    })().finally(() => { this.discovery = undefined; });
    return this.discovery;
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
      path === "/auth/approve" ? setTimeout(() => controller.abort(), 180000) :
      path.startsWith("/auth/") || path === "/health" || path === "/discover"
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
      try { await this.resume(); }
      catch (error) { this.token = ""; throw error; }
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

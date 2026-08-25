/**
 * Client side of the lookup proxy.
 *
 * When the page is served by server.js, lookups go through /api/lookup, which
 * removes the CORS ceiling and lets the server hold API keys. When it's served
 * as plain static files (GitHub Pages, Netlify, file://), the proxy isn't there
 * and callers fall back to calling the API directly from the browser — which
 * still works for the handful of sources that send CORS headers.
 */

const Proxy = {
  available: false,
  sources: {},

  /** One probe at startup; failure just means we stay in direct-fetch mode. */
  async detect() {
    try {
      const res = await fetch("/api/sources", { method: "GET" });
      if (!res.ok) return false;
      const data = await res.json();
      this.available = !!data.proxy;
      this.sources = data.sources || {};
      return this.available;
    } catch {
      this.available = false;
      return false;
    }
  },

  /** True when the proxy exists AND that source has its key configured. */
  has(source) {
    return this.available && this.sources[source] === true;
  },

  /**
   * Runs a named lookup server-side.
   * Resolves to the parsed upstream body; throws with the upstream's message.
   */
  async lookup(source, params) {
    if (!this.available) {
      throw new Error(
        `"${source}" needs the server-side proxy, but this page is served as static files. ` +
        `Run it with \`npm start\` (server.js) to enable it.`
      );
    }
    if (this.sources[source] === false) {
      throw new Error(`"${source}" is not configured on the server — its API key env var is unset.`);
    }
    const res = await fetch("/api/lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, params })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Proxy error ${res.status}`);
    if (!data.ok) {
      const detail = data.body?.error?.message || data.body?.message || `HTTP ${data.status}`;
      throw new Error(`Upstream ${source}: ${detail}`);
    }
    return data.body;
  },

  /**
   * Prefers the proxy, falls back to a direct browser call.
   * `direct` is an async function performing the same lookup client-side.
   */
  async lookupOrDirect(source, params, direct) {
    if (this.has(source)) {
      try {
        return { via: "proxy", body: await this.lookup(source, params) };
      } catch (err) {
        // A configured-but-failing proxy source is worth surfacing rather than
        // silently retrying client-side, where it will usually fail on CORS too.
        if (!direct) throw err;
      }
    }
    if (!direct) {
      throw new Error(
        this.available
          ? `${source} isn't configured on the server`
          : `${source} needs the server-side proxy — this page is served as static files`
      );
    }
    return { via: "direct", body: await direct() };
  }
};

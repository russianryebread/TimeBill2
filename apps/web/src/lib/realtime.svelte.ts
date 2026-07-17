import { pb } from './pb';

type UnsubscribeFn = () => void;

/**
 * Wrap a subscription callback so it:
 *  1. only re-subscribes once per topic+callback pair when the SDK
 *     layer reconnects (the guard prevents us from piling up duplicates),
 *  2. still lets us re-register on a force-reconnect.
 *
 * The PocketBase SDK's `RealtimeService` keeps the subscription callbacks
 * in an internal (private) map.  When the EventSource dies and the SDK
 * reconnects, those callbacks are re-registered — so in the *normal* case
 * we don't need to do anything.  But if the EventSource has fully given
 * up (browsers stop retrying after ~2 minutes of continuous failures), the
 * SDK's own reconnect loop may also stall.  In that situation we need
 * to trigger a fresh `subscribe()` call, which creates a *new* EventSource.
 *
 * This manager owns the bookkeeping so we can safely re-subscribe.
 */
class RealtimeManager {
  /** Whether we believe the realtime SSE connection is healthy. */
  connected = $state(false);

  /** Per-topic list of (original callback, unsubscribe fn) tuples. */
  private subs = new Map<string, Array<{ cb: (data: any) => void; unsub: UnsubscribeFn | null }>>();

  // ---- supervision -------------------------------------------------------
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler: (() => void) | null = null;

  private readonly CHECK_MS = 30_000;       // check connection every 30s
  private readonly RECONNECT_COOLDOWN = 5_000; // don't reconnect more than once per 5s
  private lastReconnectAt = 0;

  // ---- lifecycle ---------------------------------------------------------

  async init() {
    // Run an immediate check so the state is accurate from the start,
    // rather than waiting for the first interval tick.
    this.check();
    this.startChecks();
    this.listenVisibility();
  }

  dispose() {
    if (this.checkTimer) clearInterval(this.checkTimer);
    if (this.visibilityHandler) document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.checkTimer = null;
    this.visibilityHandler = null;
  }

  // ---- subscribe / unsubscribe -------------------------------------------

  /**
   * Subscribe to realtime changes for a collection record topic.
   *
   * Mirrors the PocketBase `pb.collection(name).subscribe(topic, callback)`
   * signature but also tracks the callback so we can re-subscribe after a
   * forced reconnect.
   */
  async subscribe(collection: string, topic: string, callback: (data: any) => void): Promise<UnsubscribeFn> {
    const key = `${collection}/${topic}`;
    let entries = this.subs.get(key);
    if (!entries) {
      entries = [];
      this.subs.set(key, entries);
    }

    // Register with the SDK
    const unsub = await pb.collection(collection).subscribe(topic, callback);
    entries.push({ cb: callback, unsub });

    // Update connection state optimistically
    this.connected = pb.realtime.isConnected;

    // Return a removal function
    const self = this;
    return function unsubscribe() {
      const list = self.subs.get(key);
      if (list) {
        const idx = list.findIndex((e) => e.cb === callback);
        const entry = idx !== -1 ? list[idx] : undefined;
        if (entry) {
          entry.unsub?.();
          list.splice(idx!, 1);
          if (list.length === 0) self.subs.delete(key);
        }
      }
    };
  }

  /** Remove all subscriptions (called on dispose). */
  async unsubscribeAll() {
    for (const [, entries] of this.subs) {
      for (const entry of entries) {
        entry.unsub?.();
      }
    }
    this.subs.clear();
  }

  // ---- internal supervision ----------------------------------------------

  private startChecks() {
    this.checkTimer = setInterval(() => this.check(), this.CHECK_MS);
  }

  private listenVisibility() {
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        this.check();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  private async check() {
    // Update visible state
    this.connected = pb.realtime.isConnected;

    if (this.connected) return;

    // Rate-limit reconnection attempts
    const now = Date.now();
    if (now - this.lastReconnectAt < this.RECONNECT_COOLDOWN) return;
    this.lastReconnectAt = now;

    console.debug('[realtime] connection lost — attempting recovery');
    await this.forceReconnect();
  }

  private async forceReconnect() {
    try {
      // First, ping the server to confirm it's reachable.
      await pb.health.check();
    } catch {
      console.debug('[realtime] server unreachable, will retry later');
      return;
    }

    // Server is reachable but the SSE connection is gone.
    // Re-subscribe every tracked topic — the SDK's `subscribe()` will
    // internally call `connect()` (creating a fresh EventSource) if
    // `isConnected` is false, and then submit the subscription.
    // Because the SDK *already* stores these callbacks internally and
    // will re-register them on reconnect, this is a belt-and-suspenders
    // step: at worst we add a duplicate listener for a brief moment before
    // the guard in the SDK clears the old EventSource.
    for (const [key, entries] of this.subs) {
      if (entries.length === 0) continue;
      // Collection name is the part before the first '/'
      const slash = key.indexOf('/');
      if (slash === -1) continue;
      const collection = key.slice(0, slash);
      const topic = key.slice(slash + 1);

      // Re-subscribe each callback individually
      for (const entry of entries) {
        try {
          const newUnsub = await pb.collection(collection).subscribe(topic, entry.cb);
          entry.unsub = newUnsub;
        } catch (err) {
          console.warn(`[realtime] re-subscribe failed for ${key}`, err);
        }
      }
    }

    // Update status
    this.connected = pb.realtime.isConnected;
    if (this.connected) {
      console.debug('[realtime] connection restored');
    }
  }
}

export const realtime = new RealtimeManager();

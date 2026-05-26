/**
 * Idle-time integration.
 *
 * The Tauri desktop shell spawns a thread that polls the OS for "seconds
 * since last input" and emits a `idle-detected` event when the user has been
 * away ≥ 5 minutes (see `apps/desktop/src-tauri/src/lib.rs`).
 *
 * This store listens for that event in any browser context where Tauri's
 * runtime is present (`window.__TAURI__`). It captures the most-recent idle
 * duration and exposes a "prompt" boolean — true when a timer is running and
 * the user has just returned from being idle. The /menubar route (and the
 * main app shell) render a modal off this state.
 */
import { browser } from '$app/environment';
import { timer } from './timer.svelte';

class IdleState {
  idleSeconds = $state(0);
  prompt = $state(false);
  private unsubscribe: (() => void) | null = null;

  /** True if running inside the Tauri shell. */
  get isTauri(): boolean {
    if (!browser) return false;
    return typeof (window as any).__TAURI__ !== 'undefined' ||
      typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';
  }

  async init() {
    if (!browser || !this.isTauri) return;
    if (this.unsubscribe) return;
    try {
      // Dynamic import — Tauri APIs aren't installed in pure-web flows.
      const { listen } = await import('@tauri-apps/api/event');
      this.unsubscribe = await listen<number>('idle-detected', (e) => {
        const secs = typeof e.payload === 'number' ? e.payload : 0;
        if (secs <= 0) return;
        this.idleSeconds = secs;
        // Only surface the modal when a timer is currently running —
        // otherwise the idle event is information without consequence.
        if (timer.running) this.prompt = true;
      });
    } catch (err) {
      console.warn('[idle] failed to attach listener', err);
    }
  }

  dismiss() {
    this.prompt = false;
    this.idleSeconds = 0;
  }

  async dispose() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}

export const idle = new IdleState();

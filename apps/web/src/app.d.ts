declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  /** Short git commit SHA, injected at build time by Vite define. */
  const __GIT_SHA__: string;

  /** Semver from root package.json, injected at build time by Vite define. */
  const __APP_VERSION__: string;
}

export {};

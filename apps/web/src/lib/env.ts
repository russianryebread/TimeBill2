declare const __GIT_SHA__: string;
declare const __APP_VERSION__: string;

/** Short git commit SHA of the build, e.g. `"a1b2c3d"`. */
export const GIT_SHA = __GIT_SHA__;

/** Semver from the root package.json, e.g. `"1.0.0"`. */
export const APP_VERSION = __APP_VERSION__;

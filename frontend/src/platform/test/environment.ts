import { builtinEnvironments, type Environment } from "vitest/environments";

export default {
  name: "jsdom-native-fetch",
  transformMode: "web",
  async setup(global, options) {
    // Node's fetch requires AbortSignals created by Node's AbortController.
    const { AbortController, AbortSignal } = global;
    const environment = await builtinEnvironments.jsdom.setup(global, options);
    Object.assign(global, { AbortController, AbortSignal });
    return environment;
  },
} satisfies Environment;

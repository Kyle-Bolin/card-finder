/**
 * A fake WebExtension runtime for tests that run the built extension in a plain browser page.
 *
 * `installFakeExtension` is serialized and run in the page by `context.addInitScript`, so it
 * must not reference anything outside its own body. It defines `globalThis.chrome` with the
 * parts that `webextension-polyfill` and Card Finder use. The background script and the
 * content script both run in the same page, so messages and ports are in-memory calls.
 */

export interface FakeExtensionOptions {
  /** Origin the extension's own pages are served from (what `runtime.getURL` returns). */
  extensionOrigin: string;
  /** Initial contents of `storage.local`. */
  local?: Record<string, unknown>;
  /** Initial contents of `storage.session`. */
  session?: Record<string, unknown>;
  /** Whether site access has been granted (Safari asks for each site separately). */
  permissionsGranted: boolean;
  /** Whether `permissions.request` succeeds (the user taps Allow). */
  grantOnRequest: boolean;
}

/** What the fake records, readable from tests as `window.__fakeExtension`. */
export interface FakeExtensionState {
  local: Record<string, unknown>;
  session: Record<string, unknown>;
  permissionsGranted: boolean;
  /** `tabs.create` calls. */
  tabs: { url?: string }[];
  /** Number of `runtime.openOptionsPage` calls. */
  optionsPageOpened: number;
  /** `permissions.request` calls. */
  permissionRequests: { origins?: string[] }[];
}

declare global {
  interface Window {
    __fakeExtension: FakeExtensionState;
  }
}

export function installFakeExtension(options: FakeExtensionOptions): void {
  type Callback = (value?: unknown) => void;
  type Listener = (...args: unknown[]) => unknown;

  const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value));
  const later = (fn: () => void) => void setTimeout(fn, 0);

  // Real extension APIs take a callback (what the polyfill uses) or return a promise.
  const respond = <T>(callback: Callback | undefined, compute: () => T): Promise<T> | undefined => {
    if (callback) {
      later(() => callback(compute()));
      return undefined;
    }
    return Promise.resolve().then(compute);
  };

  const makeEvent = () => {
    const listeners = new Set<Listener>();
    return {
      listeners,
      addListener: (fn: Listener) => void listeners.add(fn),
      removeListener: (fn: Listener) => void listeners.delete(fn),
      hasListener: (fn: Listener) => listeners.has(fn),
    };
  };

  const state: FakeExtensionState = {
    local: clone(options.local ?? {}),
    session: clone(options.session ?? {}),
    permissionsGranted: options.permissionsGranted,
    tabs: [],
    optionsPageOpened: 0,
    permissionRequests: [],
  };
  window.__fakeExtension = state;

  const storageArea = (data: Record<string, unknown>) => ({
    get(keys?: unknown, callback?: Callback) {
      return respond(callback, () => {
        if (keys === null || keys === undefined) return clone(data);
        if (typeof keys === "string") return keys in data ? { [keys]: clone(data[keys]) } : {};
        const wanted = Array.isArray(keys) ? keys : Object.keys(keys as object);
        const defaults = Array.isArray(keys) ? {} : (keys as Record<string, unknown>);
        return Object.fromEntries(
          wanted.map((key: string) => [key, clone(key in data ? data[key] : defaults[key])]),
        );
      });
    },
    set(items: Record<string, unknown>, callback?: Callback) {
      return respond(callback, () => {
        for (const [key, value] of Object.entries(items)) data[key] = clone(value);
      });
    },
    remove(keys: string | string[], callback?: Callback) {
      return respond(callback, () => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
      });
    },
    clear(callback?: Callback) {
      return respond(callback, () => {
        for (const key of Object.keys(data)) delete data[key];
      });
    },
  });

  // Ports: connect() returns the client end and hands the other end to onConnect listeners.
  const onConnect = makeEvent();
  interface FakePort {
    name: string;
    onMessage: ReturnType<typeof makeEvent>;
    onDisconnect: ReturnType<typeof makeEvent>;
    peer: FakePort;
    disconnected: boolean;
    postMessage(message: unknown): void;
    disconnect(): void;
  }
  const makePort = (name: string): FakePort => {
    const port: FakePort = {
      name,
      onMessage: makeEvent(),
      onDisconnect: makeEvent(),
      peer: undefined as unknown as FakePort,
      disconnected: false,
      postMessage(message: unknown) {
        const copy = clone(message);
        later(() => {
          if (port.peer.disconnected) return;
          for (const fn of port.peer.onMessage.listeners) fn(copy, port.peer);
        });
      },
      disconnect() {
        if (port.disconnected) return;
        port.disconnected = true;
        later(() => {
          port.peer.disconnected = true;
          for (const fn of port.peer.onDisconnect.listeners) fn(port.peer);
        });
      },
    };
    return port;
  };

  const onMessage = makeEvent();
  const permissions = {
    contains(_query: unknown, callback?: Callback) {
      return respond(callback, () => state.permissionsGranted);
    },
    request(query: { origins?: string[] }, callback?: Callback) {
      return respond(callback, () => {
        state.permissionRequests.push(clone(query));
        if (options.grantOnRequest) state.permissionsGranted = true;
        return options.grantOnRequest;
      });
    },
  };

  const runtime = {
    id: "card-finder-e2e",
    getURL: (path: string) => `${options.extensionOrigin}/${path.replace(/^\//, "")}`,
    sendMessage(message: unknown, ...rest: unknown[]) {
      const callback = rest.find((arg) => typeof arg === "function") as Callback | undefined;
      const copy = clone(message);
      const send = new Promise<unknown>((resolve) => {
        later(() => {
          let answered = false;
          const reply = (value?: unknown) => {
            if (answered) return;
            answered = true;
            resolve(clone(value));
          };
          for (const fn of onMessage.listeners) {
            if (fn(copy, { id: runtime.id }, reply) === true) return;
          }
          reply(undefined);
        });
      });
      if (callback) {
        void send.then((value) => callback(value));
        return undefined;
      }
      return send;
    },
    onMessage,
    connect(info?: { name?: string }) {
      const client = makePort(info?.name ?? "");
      const server = makePort(info?.name ?? "");
      client.peer = server;
      server.peer = client;
      for (const fn of onConnect.listeners) fn(server);
      return client;
    },
    onConnect,
    openOptionsPage(callback?: Callback) {
      return respond(callback, () => void state.optionsPageOpened++);
    },
    onInstalled: makeEvent(),
  };

  const tabs = {
    create(properties: { url?: string }, callback?: Callback) {
      return respond(callback, () => {
        state.tabs.push(clone(properties));
        return { id: state.tabs.length, ...properties };
      });
    },
  };

  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      runtime,
      permissions,
      tabs,
      storage: { local: storageArea(state.local), session: storageArea(state.session) },
    },
  });
}

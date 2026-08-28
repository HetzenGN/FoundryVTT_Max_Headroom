// ==UserScript==
// @name         FoundryVTT Max Headroom - Discord StreamKit Relay
// @namespace    https://github.com/HetzenGN/FoundryVTT_Max_Headroom
// @version      0.3.0
// @description  Discord StreamKit voice relay for FoundryVTT Max Headroom
// @match        https://streamkit.discord.com/overlay/voice/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==
(() => {
  // ../shared/protocol.js
  var MODULE_ID = "foundryvtt-max-headroom";
  var PROTOCOL_VERSION = 1;
  var MESSAGE_TYPES = Object.freeze({
    RELAY_READY: "relay-ready",
    RELAY_HEARTBEAT: "relay-heartbeat",
    DISCORD_SPEAKING: "discord-speaking",
    RELAY_ERROR: "relay-error",
    RELAY_DEBUG: "relay-debug"
  });
  var SOCKET_CHANNEL = `module.${MODULE_ID}`;
  var SOCKET_EVENTS = Object.freeze({
    SPEAKING_UPDATE: "speaking-update",
    FULLSYNC_REQUEST: "fullsync-request",
    FULLSYNC_RESPONSE: "fullsync-response",
    RESET_SPEAKING: "reset-speaking"
  });
  var FLAG_KEYS = Object.freeze({
    ROOT: MODULE_ID,
    DISCORD_USER_ID: "discordUserId",
    IDLE_IMAGE: "idleImage",
    TALKING_IMAGE: "talkingImage",
    MUTED_IMAGE: "mutedImage",
    ENABLED: "enabled",
    SORT_ORDER: "sortOrder"
  });
  var MESSAGE_SOURCES = Object.freeze({
    STREAMKIT: "streamkit",
    FOUNDRY: "foundry",
    DEBUG: "debug"
  });
  function nowTs() {
    return Date.now();
  }
  function makeRelayReady({ nonce, source = MESSAGE_SOURCES.STREAMKIT, timestamp = nowTs() } = {}) {
    return {
      type: MESSAGE_TYPES.RELAY_READY,
      version: PROTOCOL_VERSION,
      nonce,
      timestamp,
      source
    };
  }
  function makeRelayHeartbeat({ nonce, source = MESSAGE_SOURCES.STREAMKIT, timestamp = nowTs() } = {}) {
    return {
      type: MESSAGE_TYPES.RELAY_HEARTBEAT,
      version: PROTOCOL_VERSION,
      nonce,
      timestamp,
      source
    };
  }
  function makeDiscordSpeaking({
    nonce,
    discordUserId,
    username,
    nick,
    speaking,
    muted = false,
    deafened = false,
    channelId,
    guildId,
    timestamp = nowTs(),
    source = MESSAGE_SOURCES.STREAMKIT
  } = {}) {
    return {
      type: MESSAGE_TYPES.DISCORD_SPEAKING,
      version: PROTOCOL_VERSION,
      nonce,
      discordUserId: String(discordUserId ?? ""),
      username,
      nick,
      speaking: Boolean(speaking),
      muted: Boolean(muted),
      deafened: Boolean(deafened),
      channelId,
      guildId,
      timestamp,
      source
    };
  }

  // src/bootstrap.js
  var BOOTSTRAP_QUERY_KEYS = Object.freeze({
    NONCE: "maxHeadroomNonce",
    PROTOCOL: "maxHeadroomProtocol",
    OPENER_ORIGIN: "maxHeadroomOpenerOrigin"
  });
  var NONCE_PATTERN = /^[0-9a-f]{48}$/i;
  function normalizeOrigin(value) {
    if (!value) {
      return "";
    }
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return "";
      }
      return url.origin;
    } catch {
      return "";
    }
  }
  function readBootstrap({
    location = globalThis.location
  } = {}) {
    const params = new URLSearchParams(
      location?.search ?? ""
    );
    const nonce = String(
      params.get(
        BOOTSTRAP_QUERY_KEYS.NONCE
      ) ?? ""
    ).trim();
    const rawProtocol = params.get(
      BOOTSTRAP_QUERY_KEYS.PROTOCOL
    );
    const protocol = Number(rawProtocol);
    const rawOpenerOrigin = String(
      params.get(
        BOOTSTRAP_QUERY_KEYS.OPENER_ORIGIN
      ) ?? ""
    ).trim();
    const openerOrigin = normalizeOrigin(
      rawOpenerOrigin
    );
    const errors = [];
    if (!nonce) {
      errors.push({
        code: "bootstrap-missing-nonce",
        message: "The Foundry relay session nonce is missing."
      });
    } else if (!NONCE_PATTERN.test(nonce)) {
      errors.push({
        code: "bootstrap-invalid-nonce",
        message: "The Foundry relay session nonce is malformed."
      });
    }
    if (rawProtocol === null || rawProtocol === "") {
      errors.push({
        code: "bootstrap-missing-protocol",
        message: "The Foundry protocol version is missing."
      });
    } else if (!Number.isInteger(protocol)) {
      errors.push({
        code: "bootstrap-invalid-protocol",
        message: "The Foundry protocol version is malformed."
      });
    } else if (protocol !== PROTOCOL_VERSION) {
      errors.push({
        code: "bootstrap-protocol-mismatch",
        message: `Foundry requested protocol ${protocol}; relay supports ${PROTOCOL_VERSION}.`
      });
    }
    if (!rawOpenerOrigin) {
      errors.push({
        code: "bootstrap-missing-opener-origin",
        message: "The Foundry opener origin is missing."
      });
    } else if (!openerOrigin) {
      errors.push({
        code: "bootstrap-invalid-opener-origin",
        message: "The Foundry opener origin is invalid."
      });
    }
    return {
      valid: errors.length === 0,
      nonce,
      protocol,
      openerOrigin,
      errors
    };
  }

  // src/transport.js
  function createOpenerTransport({
    targetOrigin,
    opener = globalThis.opener
  } = {}) {
    let sentCount = 0;
    let failureCount = 0;
    let lastError = null;
    function isOpenerClosed() {
      if (!opener) {
        return true;
      }
      try {
        return Boolean(
          opener.closed
        );
      } catch {
        return false;
      }
    }
    function recordFailure(code, message) {
      failureCount += 1;
      lastError = {
        code,
        message,
        timestamp: Date.now()
      };
    }
    function send(payload) {
      if (!opener) {
        recordFailure(
          "opener-unavailable",
          "The Foundry opener window is unavailable."
        );
        return false;
      }
      if (isOpenerClosed()) {
        recordFailure(
          "opener-closed",
          "The Foundry opener window has closed."
        );
        return false;
      }
      if (!targetOrigin) {
        recordFailure(
          "target-origin-unavailable",
          "The Foundry target origin is unavailable."
        );
        return false;
      }
      try {
        opener.postMessage(
          payload,
          targetOrigin
        );
        sentCount += 1;
        lastError = null;
        return true;
      } catch (error) {
        recordFailure(
          "transport-failure",
          error instanceof Error ? error.message : String(error)
        );
        return false;
      }
    }
    function getState() {
      return {
        openerAvailable: Boolean(opener),
        openerClosed: isOpenerClosed(),
        targetOrigin,
        sentCount,
        failureCount,
        lastError: lastError ? { ...lastError } : null
      };
    }
    return Object.freeze({
      send,
      getState
    });
  }

  // src/heartbeat.js
  var DEFAULT_HEARTBEAT_INTERVAL_MS = 5e3;
  function startHeartbeat({
    nonce,
    transport,
    scriptVersion,
    intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS
  } = {}) {
    let timer = null;
    function sendHeartbeat() {
      const payload = {
        ...makeRelayHeartbeat({
          nonce,
          source: MESSAGE_SOURCES.STREAMKIT
        }),
        scriptVersion
      };
      const sent = transport.send(payload);
      if (!sent) {
        const state = transport.getState();
        if (!state.openerAvailable || state.openerClosed) {
          stop();
        }
      }
      return sent;
    }
    function start() {
      if (timer !== null) {
        return;
      }
      timer = globalThis.setInterval(
        sendHeartbeat,
        intervalMs
      );
    }
    function stop() {
      if (timer === null) {
        return;
      }
      globalThis.clearInterval(
        timer
      );
      timer = null;
    }
    function getState() {
      return {
        running: timer !== null,
        intervalMs
      };
    }
    start();
    return Object.freeze({
      sendHeartbeat,
      stop,
      getState
    });
  }

  // src/user-cache.js
  function normalizeDiscordUserId(value) {
    if (typeof value !== "string") {
      return "";
    }
    return value.trim();
  }
  function normalizeOptionalText(value) {
    if (value === void 0 || value === null) {
      return void 0;
    }
    const text = String(value).trim();
    return text || void 0;
  }
  function cloneUser(user) {
    return user ? { ...user } : null;
  }
  function createUserCache() {
    const users = /* @__PURE__ */ new Map();
    function upsert(observation) {
      const discordUserId = normalizeDiscordUserId(
        observation?.discordUserId
      );
      if (!discordUserId) {
        return null;
      }
      const previous = users.get(discordUserId) ?? {
        discordUserId,
        username: void 0,
        nick: void 0,
        muted: false,
        deafened: false,
        channelId: void 0,
        guildId: void 0,
        lastSeen: 0
      };
      const next = {
        ...previous,
        discordUserId,
        lastSeen: Date.now()
      };
      if (observation.username !== void 0) {
        next.username = normalizeOptionalText(
          observation.username
        );
      }
      if (observation.nick !== void 0) {
        next.nick = normalizeOptionalText(
          observation.nick
        );
      }
      if (typeof observation.muted === "boolean") {
        next.muted = observation.muted;
      }
      if (typeof observation.deafened === "boolean") {
        next.deafened = observation.deafened;
      }
      if (observation.channelId !== void 0) {
        next.channelId = normalizeOptionalText(
          observation.channelId
        );
      }
      if (observation.guildId !== void 0) {
        next.guildId = normalizeOptionalText(
          observation.guildId
        );
      }
      users.set(
        discordUserId,
        next
      );
      return cloneUser(next);
    }
    function get(discordUserId) {
      const normalized = normalizeDiscordUserId(
        discordUserId
      );
      return cloneUser(
        users.get(normalized)
      );
    }
    function dump() {
      const result = {};
      for (const [
        discordUserId,
        user
      ] of users.entries()) {
        result[discordUserId] = cloneUser(user);
      }
      return result;
    }
    function clear() {
      users.clear();
    }
    return Object.freeze({
      upsert,
      get,
      dump,
      clear
    });
  }

  // src/speaking-state.js
  function normalizeDiscordUserId2(value) {
    if (typeof value !== "string") {
      return "";
    }
    return value.trim();
  }
  function makeInitialState(discordUserId) {
    return {
      discordUserId,
      speaking: false,
      muted: false,
      deafened: false,
      speakingObserved: false,
      mutedObserved: false,
      deafenedObserved: false,
      updatedAt: 0
    };
  }
  function cloneState(state) {
    return state ? { ...state } : null;
  }
  function createSpeakingState() {
    const states = /* @__PURE__ */ new Map();
    let emittedCount = 0;
    let suppressedCount = 0;
    function getOrCreate(discordUserId) {
      return states.get(discordUserId) ?? makeInitialState(
        discordUserId
      );
    }
    function prime(observation) {
      const discordUserId = normalizeDiscordUserId2(
        observation?.discordUserId
      );
      if (!discordUserId) {
        return null;
      }
      const state = {
        ...getOrCreate(
          discordUserId
        )
      };
      if (typeof observation.muted === "boolean") {
        state.muted = observation.muted;
        state.mutedObserved = true;
      }
      if (typeof observation.deafened === "boolean") {
        state.deafened = observation.deafened;
        state.deafenedObserved = true;
      }
      state.updatedAt = Date.now();
      states.set(
        discordUserId,
        state
      );
      return cloneState(state);
    }
    function observe(observation) {
      const discordUserId = normalizeDiscordUserId2(
        observation?.discordUserId
      );
      if (!discordUserId) {
        return {
          emitted: false,
          reason: "invalid-user-id",
          state: null
        };
      }
      const previous = getOrCreate(
        discordUserId
      );
      const next = {
        ...previous
      };
      let meaningfulChange = false;
      let observedStateField = false;
      if (typeof observation.speaking === "boolean") {
        observedStateField = true;
        if (!previous.speakingObserved || previous.speaking !== observation.speaking) {
          meaningfulChange = true;
        }
        next.speaking = observation.speaking;
        next.speakingObserved = true;
      }
      if (typeof observation.muted === "boolean") {
        observedStateField = true;
        if (!previous.mutedObserved || previous.muted !== observation.muted) {
          meaningfulChange = true;
        }
        next.muted = observation.muted;
        next.mutedObserved = true;
      }
      if (typeof observation.deafened === "boolean") {
        observedStateField = true;
        if (!previous.deafenedObserved || previous.deafened !== observation.deafened) {
          meaningfulChange = true;
        }
        next.deafened = observation.deafened;
        next.deafenedObserved = true;
      }
      if (!observedStateField) {
        return {
          emitted: false,
          reason: "no-state-fields",
          state: cloneState(previous)
        };
      }
      next.updatedAt = Date.now();
      states.set(
        discordUserId,
        next
      );
      if (!meaningfulChange) {
        suppressedCount += 1;
        return {
          emitted: false,
          reason: "duplicate",
          state: cloneState(next)
        };
      }
      emittedCount += 1;
      return {
        emitted: true,
        reason: "transition",
        state: cloneState(next)
      };
    }
    function get(discordUserId) {
      const normalized = normalizeDiscordUserId2(
        discordUserId
      );
      return cloneState(
        states.get(normalized)
      );
    }
    function dump() {
      const users = {};
      for (const [
        discordUserId,
        state
      ] of states.entries()) {
        users[discordUserId] = cloneState(state);
      }
      return {
        emittedCount,
        suppressedCount,
        users
      };
    }
    function clear() {
      states.clear();
      emittedCount = 0;
      suppressedCount = 0;
    }
    return Object.freeze({
      prime,
      observe,
      get,
      dump,
      clear
    });
  }

  // src/streamkit-adapter.js
  var EXTRACTION_STRATEGIES = Object.freeze({
    MOCK: "mock",
    EVENT_INTERCEPTION: "event-interception",
    DOM_OBSERVER: "dom-observer",
    UNAVAILABLE: "unavailable"
  });
  var RAW_TYPES = Object.freeze({
    VOICE_STATE: "voice-state",
    SPEAKING: "speaking",
    MUTE: "mute",
    DEAFEN: "deafen"
  });
  function normalizeOptionalText2(value) {
    if (value === void 0 || value === null) {
      return void 0;
    }
    const text = String(value).trim();
    return text || void 0;
  }
  function normalizeUser(raw) {
    const id = raw?.user?.id;
    if (typeof id !== "string" || !id.trim()) {
      return null;
    }
    return {
      discordUserId: id.trim(),
      username: normalizeOptionalText2(
        raw.user?.username
      ),
      nick: normalizeOptionalText2(
        raw.user?.nick
      )
    };
  }
  function normalizeVoice(raw) {
    const voice = raw?.voice;
    return {
      muted: typeof voice?.muted === "boolean" ? voice.muted : void 0,
      deafened: typeof voice?.deafened === "boolean" ? voice.deafened : void 0,
      channelId: normalizeOptionalText2(
        voice?.channelId
      ),
      guildId: normalizeOptionalText2(
        voice?.guildId
      )
    };
  }
  function createStreamKitAdapter({
    strategy = EXTRACTION_STRATEGIES.MOCK,
    onEvent,
    onError
  } = {}) {
    let observedCount = 0;
    let emittedCount = 0;
    let errorCount = 0;
    let lastError = null;
    function reportError(code, message, details) {
      errorCount += 1;
      lastError = {
        code,
        message,
        details: details ?? void 0,
        timestamp: Date.now()
      };
      onError?.({
        ...lastError
      });
      return false;
    }
    function emit(event) {
      emittedCount += 1;
      onEvent?.(event);
      return true;
    }
    function ingestRawObservation(raw) {
      observedCount += 1;
      if (!raw || typeof raw !== "object") {
        return reportError(
          "raw-observation-invalid",
          "Raw StreamKit observation is not an object."
        );
      }
      const user = normalizeUser(raw);
      if (!user) {
        return reportError(
          "discord-user-id-unavailable",
          "Raw StreamKit observation does not contain a valid string Discord User ID."
        );
      }
      const voice = normalizeVoice(raw);
      const base = {
        ...user,
        ...voice
      };
      switch (raw.type) {
        case RAW_TYPES.VOICE_STATE:
          return emit({
            kind: "voice-state",
            phase: typeof raw.phase === "string" ? raw.phase : "snapshot",
            ...base
          });
        case RAW_TYPES.SPEAKING:
          if (typeof raw.speaking !== "boolean") {
            return reportError(
              "speaking-state-invalid",
              "Speaking observation does not contain a boolean speaking state."
            );
          }
          return emit({
            kind: "speaking",
            ...base,
            speaking: raw.speaking
          });
        case RAW_TYPES.MUTE:
          if (typeof raw.muted !== "boolean") {
            return reportError(
              "mute-state-invalid",
              "Mute observation does not contain a boolean muted state."
            );
          }
          return emit({
            kind: "mute",
            ...base,
            muted: raw.muted
          });
        case RAW_TYPES.DEAFEN:
          if (typeof raw.deafened !== "boolean") {
            return reportError(
              "deafen-state-invalid",
              "Deafen observation does not contain a boolean deafened state."
            );
          }
          return emit({
            kind: "deafen",
            ...base,
            deafened: raw.deafened
          });
        default:
          return reportError(
            "raw-observation-unknown",
            `Unknown raw StreamKit observation type: ${String(raw.type)}`
          );
      }
    }
    function getStrategy() {
      return strategy;
    }
    function getState() {
      return {
        strategy,
        observedCount,
        emittedCount,
        errorCount,
        lastError: lastError ? { ...lastError } : null
      };
    }
    return Object.freeze({
      ingestRawObservation,
      getStrategy,
      getState
    });
  }

  // src/streamkit-console-source.js
  var CONSOLE_METHODS = Object.freeze([
    "log",
    "info",
    "debug",
    "warn",
    "error"
  ]);
  var RPC_EVENTS = Object.freeze({
    VOICE_STATE_CREATE: "VOICE_STATE_CREATE",
    VOICE_STATE_UPDATE: "VOICE_STATE_UPDATE",
    VOICE_STATE_DELETE: "VOICE_STATE_DELETE",
    SPEAKING_START: "SPEAKING_START",
    SPEAKING_STOP: "SPEAKING_STOP"
  });
  var RECOGNIZED_RPC_EVENTS = new Set(
    Object.values(
      RPC_EVENTS
    )
  );
  function normalizeString(value) {
    if (typeof value !== "string" || !value.trim()) {
      return void 0;
    }
    return value.trim();
  }
  function parseOverlayIds(location) {
    const pathname = String(
      location?.pathname ?? ""
    );
    const match = pathname.match(
      /^\/overlay\/voice\/([^/]+)\/([^/]+)/
    );
    if (!match) {
      return {
        guildId: void 0,
        channelId: void 0
      };
    }
    return {
      guildId: normalizeString(
        match[1]
      ),
      channelId: normalizeString(
        match[2]
      )
    };
  }
  function getVoiceFlags(data) {
    const voiceState = data?.voice_state;
    if (!voiceState || typeof voiceState !== "object") {
      return {
        muted: void 0,
        deafened: void 0
      };
    }
    const muted = Boolean(
      voiceState.mute || voiceState.self_mute || voiceState.suppress
    );
    const deafened = Boolean(
      voiceState.deaf || voiceState.self_deaf
    );
    return {
      muted,
      deafened
    };
  }
  function translateRpcEvent(payload, overlayIds) {
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const eventName = payload.evt;
    if (typeof eventName !== "string" || !RECOGNIZED_RPC_EVENTS.has(eventName)) {
      return null;
    }
    const data = payload.data;
    if (!data || typeof data !== "object") {
      return null;
    }
    if (eventName === RPC_EVENTS.SPEAKING_START || eventName === RPC_EVENTS.SPEAKING_STOP) {
      const discordUserId2 = normalizeString(
        data.user_id
      );
      if (!discordUserId2) {
        return {
          error: {
            code: "speaking-user-id-unavailable",
            message: `${eventName} did not contain a valid string Discord User ID.`
          }
        };
      }
      return {
        rawObservation: {
          type: "speaking",
          user: {
            id: discordUserId2
          },
          voice: {
            channelId: normalizeString(
              data.channel_id
            ) ?? overlayIds.channelId,
            guildId: overlayIds.guildId
          },
          speaking: eventName === RPC_EVENTS.SPEAKING_START
        }
      };
    }
    const user = data.user;
    const discordUserId = normalizeString(
      user?.id
    );
    if (!discordUserId) {
      return {
        error: {
          code: "voice-state-user-id-unavailable",
          message: `${eventName} did not contain a valid string Discord User ID.`
        }
      };
    }
    const voiceFlags = getVoiceFlags(
      data
    );
    const phase = eventName === RPC_EVENTS.VOICE_STATE_CREATE ? "create" : eventName === RPC_EVENTS.VOICE_STATE_UPDATE ? "update" : "delete";
    return {
      rawObservation: {
        type: "voice-state",
        phase,
        user: {
          id: discordUserId,
          username: normalizeString(
            user?.username
          ),
          nick: normalizeString(
            data.nick
          )
        },
        voice: {
          muted: voiceFlags.muted,
          deafened: voiceFlags.deafened,
          channelId: overlayIds.channelId,
          guildId: overlayIds.guildId
        }
      }
    };
  }
  function createStreamKitConsoleSource({
    pageWindow = globalThis,
    onRawObservation,
    onError
  } = {}) {
    const originalMethods = /* @__PURE__ */ new Map();
    const wrappers = /* @__PURE__ */ new Map();
    let installed = false;
    let recognizedCount = 0;
    let errorCount = 0;
    let lastEventName = null;
    let lastError = null;
    const overlayIds = parseOverlayIds(
      pageWindow.location
    );
    function reportError(code, message) {
      errorCount += 1;
      lastError = {
        code,
        message,
        timestamp: Date.now()
      };
      onError?.({
        ...lastError
      });
    }
    function inspectArgument(arg) {
      const translated = translateRpcEvent(
        arg,
        overlayIds
      );
      if (!translated) {
        return;
      }
      if (translated.error) {
        reportError(
          translated.error.code,
          translated.error.message
        );
        return;
      }
      if (!translated.rawObservation) {
        return;
      }
      recognizedCount += 1;
      lastEventName = arg.evt;
      onRawObservation?.(
        translated.rawObservation
      );
    }
    function start() {
      if (installed) {
        return true;
      }
      const pageConsole = pageWindow.console;
      if (!pageConsole) {
        reportError(
          "console-unavailable",
          "The StreamKit page console is unavailable."
        );
        return false;
      }
      for (const method of CONSOLE_METHODS) {
        const original = pageConsole[method];
        if (typeof original !== "function") {
          continue;
        }
        originalMethods.set(
          method,
          original
        );
        const wrapper = function(...args) {
          const result = original.apply(
            this,
            args
          );
          try {
            for (const arg of args) {
              inspectArgument(
                arg
              );
            }
          } catch (error) {
            reportError(
              "console-event-inspection-failed",
              error instanceof Error ? error.message : String(error)
            );
          }
          return result;
        };
        wrappers.set(
          method,
          wrapper
        );
        pageConsole[method] = wrapper;
      }
      if (wrappers.size === 0) {
        reportError(
          "console-interception-unavailable",
          "No StreamKit console methods could be intercepted."
        );
        return false;
      }
      installed = true;
      return true;
    }
    function stop() {
      if (!installed) {
        return;
      }
      const pageConsole = pageWindow.console;
      for (const [
        method,
        original
      ] of originalMethods.entries()) {
        if (pageConsole[method] === wrappers.get(method)) {
          pageConsole[method] = original;
        }
      }
      installed = false;
    }
    function getState() {
      return {
        installed,
        strategy: "event-interception",
        recognizedCount,
        errorCount,
        lastEventName,
        overlayGuildId: overlayIds.guildId ?? null,
        overlayChannelId: overlayIds.channelId ?? null,
        lastError: lastError ? { ...lastError } : null
      };
    }
    return Object.freeze({
      start,
      stop,
      getState
    });
  }

  // src/main.js
  var LOG_PREFIX = "[FoundryVTT_Max_Headroom] [StreamKit Relay]";
  var RELAY_SCRIPT_VERSION = "0.3.0-dev";
  var runtime = {
    started: false,
    bootstrap: null,
    transport: null,
    heartbeat: null,
    userCache: null,
    speakingState: null,
    adapter: null,
    source: null
  };
  function sendReady() {
    if (!runtime.bootstrap?.valid || !runtime.transport) {
      return false;
    }
    const payload = {
      ...makeRelayReady({
        nonce: runtime.bootstrap.nonce,
        source: MESSAGE_SOURCES.STREAMKIT
      }),
      scriptVersion: RELAY_SCRIPT_VERSION
    };
    return runtime.transport.send(
      payload
    );
  }
  function sendSpeakingSnapshot(speakingSnapshot) {
    if (!runtime.bootstrap?.valid || !runtime.transport || !speakingSnapshot) {
      return false;
    }
    const discordUserId = speakingSnapshot.discordUserId;
    const user = runtime.userCache?.get(discordUserId);
    const payload = makeDiscordSpeaking({
      nonce: runtime.bootstrap.nonce,
      discordUserId,
      username: user?.username,
      nick: user?.nick,
      speaking: speakingSnapshot.speaking,
      muted: speakingSnapshot.muted,
      deafened: speakingSnapshot.deafened,
      channelId: user?.channelId,
      guildId: user?.guildId,
      source: MESSAGE_SOURCES.STREAMKIT
    });
    return runtime.transport.send(
      payload
    );
  }
  function handleAdapterEvent(event) {
    if (!event || !runtime.userCache || !runtime.speakingState) {
      return false;
    }
    runtime.userCache.upsert(
      event
    );
    if (event.kind === "voice-state") {
      if (event.phase === "create" || event.phase === "snapshot") {
        runtime.speakingState.prime(
          event
        );
        return true;
      }
      if (event.phase === "delete") {
        const previous = runtime.speakingState.get(
          event.discordUserId
        );
        if (!previous || !previous.speaking) {
          return true;
        }
        const result2 = runtime.speakingState.observe({
          ...event,
          speaking: false
        });
        if (!result2.emitted) {
          return true;
        }
        return sendSpeakingSnapshot(
          result2.state
        );
      }
      if (event.phase === "update") {
        const result2 = runtime.speakingState.observe(
          event
        );
        if (!result2.emitted) {
          return true;
        }
        return sendSpeakingSnapshot(
          result2.state
        );
      }
      return true;
    }
    const result = runtime.speakingState.observe(
      event
    );
    if (!result.emitted) {
      return false;
    }
    return sendSpeakingSnapshot(
      result.state
    );
  }
  function handleAdapterError(error) {
    console.warn(
      LOG_PREFIX,
      "StreamKit adapter error.",
      error
    );
  }
  function selectExtractionStrategy() {
    if (globalThis.location.hostname === "streamkit.discord.com" && globalThis.location.pathname.startsWith(
      "/overlay/voice/"
    )) {
      return EXTRACTION_STRATEGIES.EVENT_INTERCEPTION;
    }
    return EXTRACTION_STRATEGIES.MOCK;
  }
  function makeFakeUser(discordUserId, options = {}) {
    return {
      id: discordUserId,
      username: options.username,
      nick: options.nick
    };
  }
  function makeFakeVoice(options = {}) {
    return {
      muted: options.muted,
      deafened: options.deafened,
      channelId: options.channelId,
      guildId: options.guildId
    };
  }
  function emitFakeUser(discordUserId, options = {}) {
    return runtime.adapter?.ingestRawObservation({
      type: "voice-state",
      user: makeFakeUser(
        discordUserId,
        options
      ),
      voice: makeFakeVoice(
        options
      )
    }) ?? false;
  }
  function emitFakeSpeaking(discordUserId, speaking, options = {}) {
    return runtime.adapter?.ingestRawObservation({
      type: "speaking",
      user: makeFakeUser(
        discordUserId,
        options
      ),
      voice: makeFakeVoice(
        options
      ),
      speaking
    }) ?? false;
  }
  function emitFakeMute(discordUserId, muted, options = {}) {
    return runtime.adapter?.ingestRawObservation({
      type: "mute",
      user: makeFakeUser(
        discordUserId,
        options
      ),
      voice: makeFakeVoice(
        options
      ),
      muted
    }) ?? false;
  }
  function emitFakeDeafen(discordUserId, deafened, options = {}) {
    return runtime.adapter?.ingestRawObservation({
      type: "deafen",
      user: makeFakeUser(
        discordUserId,
        options
      ),
      voice: makeFakeVoice(
        options
      ),
      deafened
    }) ?? false;
  }
  function emitMalformedFakeEvent() {
    return runtime.adapter?.ingestRawObservation({
      type: "speaking",
      user: {
        /*
         * Deliberately invalid:
         * Discord IDs must be strings.
         */
        id: 123456789012345680
      },
      speaking: "yes"
    }) ?? false;
  }
  function getBootstrapState() {
    const bootstrap = runtime.bootstrap;
    if (!bootstrap) {
      return null;
    }
    return {
      valid: bootstrap.valid,
      noncePresent: Boolean(
        bootstrap.nonce
      ),
      protocol: bootstrap.protocol,
      openerOrigin: bootstrap.openerOrigin,
      errors: bootstrap.errors.map(
        (error) => ({ ...error })
      )
    };
  }
  function getRuntimeState() {
    return {
      started: runtime.started,
      protocolVersion: PROTOCOL_VERSION,
      scriptVersion: RELAY_SCRIPT_VERSION,
      bootstrap: getBootstrapState(),
      transport: runtime.transport?.getState() ?? null,
      heartbeat: runtime.heartbeat?.getState() ?? null,
      extraction: runtime.adapter?.getState() ?? null,
      source: runtime.source?.getState() ?? null,
      users: runtime.userCache?.dump() ?? {},
      speaking: runtime.speakingState?.dump() ?? null
    };
  }
  function installDebugApi() {
    globalThis.__maxHeadroomStreamKitRelayDebug = Object.freeze({
      emitFakeUser,
      emitFakeSpeaking,
      emitFakeMute,
      emitFakeDeafen,
      emitMalformedFakeEvent,
      dumpUsers() {
        return runtime.userCache?.dump() ?? {};
      },
      dumpState() {
        return runtime.speakingState?.dump() ?? null;
      },
      sendReady,
      sendHeartbeat() {
        return runtime.heartbeat?.sendHeartbeat() ?? false;
      },
      getTransportState() {
        return runtime.transport?.getState() ?? null;
      },
      getExtractionStrategy() {
        return runtime.adapter?.getStrategy() ?? EXTRACTION_STRATEGIES.UNAVAILABLE;
      },
      getBootstrapState,
      getRuntimeState
    });
  }
  function startRelay() {
    runtime.bootstrap = readBootstrap();
    installDebugApi();
    if (!runtime.bootstrap.valid) {
      console.error(
        LOG_PREFIX,
        "Bootstrap rejected.",
        runtime.bootstrap.errors
      );
      return false;
    }
    if (!globalThis.opener) {
      console.error(
        LOG_PREFIX,
        "Foundry opener window is unavailable."
      );
      return false;
    }
    runtime.transport = createOpenerTransport({
      targetOrigin: runtime.bootstrap.openerOrigin,
      opener: globalThis.opener
    });
    const transportState = runtime.transport.getState();
    if (!transportState.openerAvailable || transportState.openerClosed) {
      console.error(
        LOG_PREFIX,
        "Foundry opener window is unavailable or closed."
      );
      return false;
    }
    runtime.userCache = createUserCache();
    runtime.speakingState = createSpeakingState();
    const extractionStrategy = selectExtractionStrategy();
    runtime.adapter = createStreamKitAdapter({
      strategy: extractionStrategy,
      onEvent: handleAdapterEvent,
      onError: handleAdapterError
    });
    if (extractionStrategy === EXTRACTION_STRATEGIES.EVENT_INTERCEPTION) {
      runtime.source = createStreamKitConsoleSource({
        pageWindow: globalThis,
        onRawObservation(rawObservation) {
          runtime.adapter.ingestRawObservation(
            rawObservation
          );
        },
        onError: handleAdapterError
      });
      if (!runtime.source.start()) {
        console.error(
          LOG_PREFIX,
          "StreamKit event interception could not be started."
        );
        return false;
      }
    }
    runtime.started = true;
    if (!sendReady()) {
      console.error(
        LOG_PREFIX,
        "Unable to send relay-ready."
      );
      runtime.started = false;
      return false;
    }
    runtime.heartbeat = startHeartbeat({
      nonce: runtime.bootstrap.nonce,
      transport: runtime.transport,
      scriptVersion: RELAY_SCRIPT_VERSION
    });
    console.info(
      LOG_PREFIX,
      `Relay started. Protocol ${PROTOCOL_VERSION}, script ${RELAY_SCRIPT_VERSION}, extraction ${runtime.adapter.getStrategy()}.`
    );
    return true;
  }
  startRelay();
})();

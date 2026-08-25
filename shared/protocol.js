// shared/protocol.js

export const MODULE_ID = "foundryvtt-max-headroom";
export const PROTOCOL_VERSION = 1;

export const MESSAGE_TYPES = Object.freeze({
  RELAY_READY: "relay-ready",
  RELAY_HEARTBEAT: "relay-heartbeat",
  DISCORD_SPEAKING: "discord-speaking",
  RELAY_ERROR: "relay-error",
  RELAY_DEBUG: "relay-debug"
});

export const SOCKET_CHANNEL = `module.${MODULE_ID}`;

export const SOCKET_EVENTS = Object.freeze({
  SPEAKING_UPDATE: "speaking-update",
  FULLSYNC_REQUEST: "fullsync-request",
  FULLSYNC_RESPONSE: "fullsync-response",
  RESET_SPEAKING: "reset-speaking"
});

export const FLAG_KEYS = Object.freeze({
  ROOT: MODULE_ID,
  DISCORD_USER_ID: "discordUserId",
  IDLE_IMAGE: "idleImage",
  TALKING_IMAGE: "talkingImage",
  MUTED_IMAGE: "mutedImage",
  ENABLED: "enabled",
  SORT_ORDER: "sortOrder"
});

export const MESSAGE_SOURCES = Object.freeze({
  STREAMKIT: "streamkit",
  FOUNDRY: "foundry",
  DEBUG: "debug"
});

export function nowTs() {
  return Date.now();
}

export function makeRelayReady({ nonce, source = MESSAGE_SOURCES.STREAMKIT, timestamp = nowTs() } = {}) {
  return {
    type: MESSAGE_TYPES.RELAY_READY,
    version: PROTOCOL_VERSION,
    nonce,
    timestamp,
    source
  };
}

export function makeRelayHeartbeat({ nonce, source = MESSAGE_SOURCES.STREAMKIT, timestamp = nowTs() } = {}) {
  return {
    type: MESSAGE_TYPES.RELAY_HEARTBEAT,
    version: PROTOCOL_VERSION,
    nonce,
    timestamp,
    source
  };
}

export function makeDiscordSpeaking({
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

export function isProtocolMessage(payload) {
  return !!payload
    && typeof payload === "object"
    && typeof payload.type === "string"
    && payload.version === PROTOCOL_VERSION;
}

export function isDiscordSpeakingMessage(payload) {
  return isProtocolMessage(payload)
    && payload.type === MESSAGE_TYPES.DISCORD_SPEAKING
    && typeof payload.discordUserId === "string"
    && payload.discordUserId.length > 0
    && typeof payload.speaking === "boolean"
    && typeof payload.timestamp === "number";
}

export function normalizeDiscordSpeakingMessage(payload) {
  if (!payload) return null;

  const normalized = {
    type: payload.type,
    version: payload.version,
    nonce: payload.nonce ?? undefined,
    discordUserId: payload.discordUserId ? String(payload.discordUserId) : "",
    username: payload.username ?? undefined,
    nick: payload.nick ?? undefined,
    speaking: Boolean(payload.speaking),
    muted: Boolean(payload.muted),
    deafened: Boolean(payload.deafened),
    channelId: payload.channelId ?? undefined,
    guildId: payload.guildId ?? undefined,
    timestamp: Number(payload.timestamp ?? nowTs()),
    source: payload.source ?? "unknown"
  };

  return isDiscordSpeakingMessage(normalized) ? normalized : null;
}
// scripts/settings.js

// #region Imports

import {
  MODULE_ID
} from "../shared/protocol.js";

// #endregion

// #region Setting Keys

/**
 * Centralized setting keys for FoundryVTT_Max_Headroom.
 *
 * Other module files should import these constants instead of repeating
 * setting-name string literals.
 */
export const SETTING_KEYS = Object.freeze({
  BAR_ANCHOR: "barAnchor",
  ORIENTATION: "orientation",
  TILE_SIZE: "tileSize",
  SHOW_NAMES: "showNames",
  SPEECH_DECAY_MS: "speechDecayMs",
  ANIMATION_ENABLED: "animationEnabled",
  STALE_SPEAKER_TIMEOUT_MS: "staleSpeakerTimeoutMs",

  RELAY_ORIGIN: "relayOrigin",
  STREAMKIT_URL: "streamkitUrl",
  RELAY_HEARTBEAT_TIMEOUT_MS: "relayHeartbeatTimeoutMs",
  RELAY_HOST_USER_ID: "relayHostUserId",

  DEBUG_MODE: "debugMode"
});

// #endregion

// #region Setting Registration

/**
 * Register all Foundry settings used by the module.
 *
 * Called from scripts/main.js during Foundry's init hook.
 */
export function registerSettings() {
  // #region Portrait Bar Settings

  game.settings.register(
    MODULE_ID,
    SETTING_KEYS.BAR_ANCHOR,
    {
      name: "Portrait Bar Anchor",
      hint: "The edge of the Foundry interface where the reactive portrait bar is anchored.",
      scope: "world",
      config: true,
      type: String,
      choices: {
        bottom: "Bottom",
        top: "Top",
        left: "Left",
        right: "Right"
      },
      default: "bottom"
    }
  );

  game.settings.register(
    MODULE_ID,
    SETTING_KEYS.ORIENTATION,
    {
      name: "Portrait Bar Orientation",
      hint: "Controls whether reactive portraits are arranged horizontally or vertically.",
      scope: "world",
      config: true,
      type: String,
      choices: {
        horizontal: "Horizontal",
        vertical: "Vertical"
      },
      default: "horizontal"
    }
  );

game.settings.register(
  MODULE_ID,
  SETTING_KEYS.TILE_SIZE,
  {
    name: "Portrait Tile Size",
    hint: "Maximum width and height, in pixels, of each reactive portrait tile.",
    scope: "world",
    config: true,
    type: Number,
    range: {
      min: 64,
      max: 400,
      step: 8
    },
    default: 160
  }
);

game.settings.register(
  MODULE_ID,
  SETTING_KEYS.SHOW_NAMES,
  {
    name: "Show User Names",
    hint: "Display Foundry user names with reactive portraits.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  }
);

game.settings.register(
  MODULE_ID,
  SETTING_KEYS.SPEECH_DECAY_MS,
  {
    name: "Speech Decay",
    hint: "Milliseconds to keep a portrait in its talking state after speaking stops.",
    scope: "world",
    config: true,
    type: Number,
    range: {
      min: 0,
      max: 2000,
      step: 50
    },
    default: 400
  }
);

game.settings.register(
  MODULE_ID,
  SETTING_KEYS.ANIMATION_ENABLED,
  {
    name: "Speaking Animation",
    hint: "Enable lightweight CSS animation for portraits while their users are speaking.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  }
);

game.settings.register(
  MODULE_ID,
  SETTING_KEYS.STALE_SPEAKER_TIMEOUT_MS,
  {
    name: "Stale Speaker Timeout",
    hint: "Maximum time, in milliseconds, a user may remain marked as speaking without receiving a newer authoritative state update.",
    scope: "world",
    config: true,
    type: Number,
    range: {
      min: 1000,
      max: 60000,
      step: 1000
    },
    default: 10000
  }
);

  // #endregion

  // #region Relay Settings

  game.settings.register(
    MODULE_ID,
    SETTING_KEYS.RELAY_ORIGIN,
    {
      name: "StreamKit Relay Origin",
      hint: "Expected browser origin for messages from the external Discord StreamKit relay.",
      scope: "world",
      config: true,
      type: String,
      default: "https://streamkit.discord.com"
    }
  );

  game.settings.register(
    MODULE_ID,
    SETTING_KEYS.STREAMKIT_URL,
    {
      name: "StreamKit Relay URL",
      hint: "URL opened by the GM Relay Controller when launching the external StreamKit relay.",
      scope: "world",
      config: true,
      type: String,
      default: "https://streamkit.discord.com/overlay"
    }
  );

game.settings.register(
  MODULE_ID,
  SETTING_KEYS.RELAY_HEARTBEAT_TIMEOUT_MS,
  {
    name: "Relay Heartbeat Timeout",
    hint: "Milliseconds without a valid heartbeat before the StreamKit relay is considered stale.",
    scope: "world",
    config: true,
    type: Number,
    range: {
      min: 5000,
      max: 120000,
      step: 1000
    },
    default: 15000
  }
);

game.settings.register(
  MODULE_ID,
  SETTING_KEYS.RELAY_HOST_USER_ID,
  {
    name: "Relay Host User ID",
    scope: "world",
    config: false,
    type: String,
    default: ""
  }
);

  // #endregion

  // #region Debug Settings

  game.settings.register(
    MODULE_ID,
    SETTING_KEYS.DEBUG_MODE,
    {
      name: "Debug Logging",
      hint: "Write detailed relay, socket, portrait, and validation diagnostics to the browser console.",
      scope: "world",
      config: true,
      type: Boolean,
      default: false
    }
  );

  // #endregion
}

// #endregion

// #region Setting Accessors

/**
 * Read a registered module setting.
 */
export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

/**
 * Update a registered module setting.
 */
export function setSetting(key, value) {
  return game.settings.set(MODULE_ID, key, value);
}

/**
 * Return whether detailed module debugging is enabled.
 */
export function isDebugEnabled() {
  return Boolean(
    getSetting(SETTING_KEYS.DEBUG_MODE)
  );
}

// #endregion
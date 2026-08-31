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

  USER_BAR_ANCHOR: "userBarAnchor",
  USER_ORIENTATION: "userOrientation",
  USER_TILE_SIZE: "userTileSize",
  USER_SHOW_NAMES: "userShowNames",
  USER_ANIMATION_ENABLED: "userAnimationEnabled",

  USER_POSITION_X: "userPositionX",
  USER_POSITION_Y: "userPositionY",
  USER_SCALE: "userScale",

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

  // #region User Portrait Bar Settings

/*
 * These settings are intentionally hidden from Foundry's standard
 * settings form. They are managed through the Portrait Bar Preferences
 * submenu and through direct drag/scale interaction with the bar.
 */

game.settings.register(
  MODULE_ID,
  SETTING_KEYS.USER_BAR_ANCHOR,
  {
    name: "User Portrait Bar Anchor",
    scope: "user",
    config: false,
    type: String,
    default: "default"
  }
);

game.settings.register(
  MODULE_ID,
  SETTING_KEYS.USER_ORIENTATION,
  {
    name: "User Portrait Bar Orientation",
    scope: "user",
    config: false,
    type: String,
    default: "default"
  }
);

game.settings.register(
  MODULE_ID,
  SETTING_KEYS.USER_TILE_SIZE,
  {
    name: "User Portrait Tile Size",
    scope: "user",
    config: false,
    type: Number,
    default: 0
  }
);

game.settings.register(
  MODULE_ID,
  SETTING_KEYS.USER_SHOW_NAMES,
  {
    name: "User Show Portrait Names",
    scope: "user",
    config: false,
    type: String,
    default: "default"
  }
);

game.settings.register(
  MODULE_ID,
  SETTING_KEYS.USER_ANIMATION_ENABLED,
  {
    name: "User Speaking Animation",
    scope: "user",
    config: false,
    type: String,
    default: "default"
  }
);

game.settings.register(
  MODULE_ID,
  SETTING_KEYS.USER_POSITION_X,
  {
    name: "User Portrait Bar X Position",
    scope: "user",
    config: false,
    type: Number,
    default: -1
  }
);

game.settings.register(
  MODULE_ID,
  SETTING_KEYS.USER_POSITION_Y,
  {
    name: "User Portrait Bar Y Position",
    scope: "user",
    config: false,
    type: Number,
    default: -1
  }
);

game.settings.register(
  MODULE_ID,
  SETTING_KEYS.USER_SCALE,
  {
    name: "User Portrait Bar Scale",
    scope: "user",
    config: false,
    type: Number,
    default: 1
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
      config: false,
      type: String,
      default: "https://streamkit.discord.com"
    }
  );

  game.settings.register(
    MODULE_ID,
    SETTING_KEYS.STREAMKIT_URL,
    {
      name:
        "Discord StreamKit Voice URL",

      hint:
        "Discord StreamKit Voice overlay URL opened by the Relay Controller. The Max Headroom Chromium extension observes this page and relays Discord voice activity into Foundry.",
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
    config: false,
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

// #region Portrait Presentation Resolution

const MIN_USER_SCALE = 0.5;
const MAX_USER_SCALE = 2.0;

/**
 * Settings whose changes require the Portrait Bar to perform a full
 * presentation refresh.
 */
const PORTRAIT_RENDER_SETTING_KEYS =
  new Set([
    SETTING_KEYS.BAR_ANCHOR,
    SETTING_KEYS.ORIENTATION,
    SETTING_KEYS.TILE_SIZE,
    SETTING_KEYS.SHOW_NAMES,
    SETTING_KEYS.ANIMATION_ENABLED,

    SETTING_KEYS.USER_BAR_ANCHOR,
    SETTING_KEYS.USER_ORIENTATION,
    SETTING_KEYS.USER_TILE_SIZE,
    SETTING_KEYS.USER_SHOW_NAMES,
    SETTING_KEYS.USER_ANIMATION_ENABLED
  ]);


/**
 * Determine whether a Foundry Setting document/update affects the rendered
 * Portrait Bar layout.
 */
export function isPortraitRenderSettingKey(
  settingKey
) {
  let key =
    String(settingKey ?? "");

  const prefix =
    `${MODULE_ID}.`;

  if (key.startsWith(prefix)) {
    key =
      key.slice(prefix.length);
  }

  return PORTRAIT_RENDER_SETTING_KEYS.has(
    key
  );
}


/**
 * Resolve a tri-state Boolean user preference.
 *
 * Stored values:
 *
 * default -> GM world setting
 * true    -> enabled
 * false   -> disabled
 */
function resolveBooleanOverride(
  userKey,
  worldKey
) {
  const value =
    String(
      getSetting(userKey)
      ?? "default"
    );

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return Boolean(
    getSetting(worldKey)
  );
}


/**
 * Return the effective Portrait Bar presentation settings for the
 * current Foundry User.
 */
export function getPortraitPresentationSettings() {
  const userAnchor =
    String(
      getSetting(
        SETTING_KEYS.USER_BAR_ANCHOR
      )
      ?? "default"
    );

  const userOrientation =
    String(
      getSetting(
        SETTING_KEYS.USER_ORIENTATION
      )
      ?? "default"
    );

  const positionX =
    Number(
      getSetting(
        SETTING_KEYS.USER_POSITION_X
      )
    );

  const positionY =
    Number(
      getSetting(
        SETTING_KEYS.USER_POSITION_Y
      )
    );

  const storedScale =
    Number(
      getSetting(
        SETTING_KEYS.USER_SCALE
      )
    );

  const scale =
    Number.isFinite(storedScale)
      ? Math.min(
          MAX_USER_SCALE,
          Math.max(
            MIN_USER_SCALE,
            storedScale
          )
        )
      : 1;

  return {
    anchor:
      userAnchor === "default"
        ? getSetting(
            SETTING_KEYS.BAR_ANCHOR
          )
        : userAnchor,

    orientation:
      userOrientation === "default"
        ? getSetting(
            SETTING_KEYS.ORIENTATION
          )
        : userOrientation,

    tileSize:
      Number(
        getSetting(
          SETTING_KEYS.TILE_SIZE
        )
      ),

    showNames:
      resolveBooleanOverride(
        SETTING_KEYS.USER_SHOW_NAMES,
        SETTING_KEYS.SHOW_NAMES
      ),

    animationEnabled:
      resolveBooleanOverride(
        SETTING_KEYS.USER_ANIMATION_ENABLED,
        SETTING_KEYS.ANIMATION_ENABLED
      ),

    positionX,
    positionY,

    hasCustomPosition:
      Number.isFinite(positionX)
      && positionX >= 0
      && Number.isFinite(positionY)
      && positionY >= 0,

    scale
  };
}


/**
 * Save this user's free-position coordinates.
 */
export async function setUserBarPosition(
  x,
  y
) {
  await setSetting(
    SETTING_KEYS.USER_POSITION_X,
    Math.round(Number(x) || 0)
  );

  await setSetting(
    SETTING_KEYS.USER_POSITION_Y,
    Math.round(Number(y) || 0)
  );
}


/**
 * Save this user's proportional Portrait Bar scale.
 */
export async function setUserBarScale(
  scale
) {
  const normalized =
    Math.min(
      MAX_USER_SCALE,
      Math.max(
        MIN_USER_SCALE,
        Number(scale) || 1
      )
    );

  return setSetting(
    SETTING_KEYS.USER_SCALE,
    normalized
  );
}


/**
 * Return position and size to resolution-safe GM defaults.
 *
 * Orientation, names, and animation remain the user's preferences.
 */
export async function resetUserBarPositionAndSize() {
  await setSetting(
    SETTING_KEYS.USER_POSITION_X,
    -1
  );

  await setSetting(
    SETTING_KEYS.USER_POSITION_Y,
    -1
  );

  await setSetting(
    SETTING_KEYS.USER_SCALE,
    1
  );

  await setSetting(
    SETTING_KEYS.USER_BAR_ANCHOR,
    "default"
  );
}

// #endregion

// #endregion
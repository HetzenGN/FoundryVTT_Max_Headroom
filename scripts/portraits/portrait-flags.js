// scripts/portraits/portrait-flags.js

// #region Imports

import {
  MODULE_ID,
  FLAG_KEYS
} from "../../shared/protocol.js";

// #endregion

// #region Constants

/**
 * Namespace used for reactive portrait User flags.
 *
 * FLAG_KEYS.ROOT should match MODULE_ID according to the shared protocol,
 * but using it here keeps the flag namespace defined by protocol.js.
 */
const FLAG_SCOPE = FLAG_KEYS.ROOT;

export const PORTRAIT_DISPLAY_NAME_MODES =
  Object.freeze({
    USER:
      "user",

    CHARACTER:
      "character",

    CUSTOM:
      "custom"
  });

/**
 * Default persistent reactive portrait configuration for a Foundry User.
 *
 * These values describe configuration only.
 * Transient states such as speaking, muted, or deafened are NOT persisted
 * as User flags.
 */
export const DEFAULT_REACTIVE_PORTRAIT_CONFIG = Object.freeze({
  discordUserId: "",

  displayNameMode:
    PORTRAIT_DISPLAY_NAME_MODES.USER,

  customDisplayName: "",

  idleImage: "",
  talkingImage: "",
  mutedImage: "",

  enabled: false,
  sortOrder: 0
});

// #endregion

// #region Internal Helpers

/**
 * Ensure the supplied value appears to be a Foundry User document.
 */
function requireUser(user) {
  if (
    !user
    || typeof user.getFlag !== "function"
    || typeof user.setFlag !== "function"
  ) {
    throw new TypeError(
      `[${MODULE_ID}] Expected a Foundry User document.`
    );
  }

  return user;
}

/**
 * Normalize a Discord User ID.
 *
 * Discord snowflake IDs should remain strings. Do not convert them to
 * JavaScript Numbers because sufficiently large IDs can exceed safe
 * integer precision.
 */
function normalizeDiscordUserId(value) {
  if (value === null || value === undefined) return "";

  return String(value).trim();
}

/**
 * Normalize the configured portrait display-name mode.
 */
function normalizeDisplayNameMode(value) {
  const normalized =
    String(
      value
      ?? ""
    )
      .trim()
      .toLowerCase();

  if (
    Object.values(
      PORTRAIT_DISPLAY_NAME_MODES
    ).includes(normalized)
  ) {
    return normalized;
  }

  return DEFAULT_REACTIVE_PORTRAIT_CONFIG
    .displayNameMode;
}


/**
 * Normalize a custom portrait display name.
 */
function normalizeCustomDisplayName(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

/**
 * Normalize an image path.
 */
function normalizeImagePath(value) {
  if (typeof value !== "string") return "";

  return value.trim();
}

/**
 * Normalize a sort-order value.
 */
function normalizeSortOrder(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return DEFAULT_REACTIVE_PORTRAIT_CONFIG.sortOrder;
  }

  return Math.trunc(number);
}

/**
 * Normalize a complete or partial reactive portrait configuration.
 */
function normalizeConfig(config = {}) {
  return {
    discordUserId: normalizeDiscordUserId(
      config.discordUserId
    ),

    displayNameMode:
    normalizeDisplayNameMode(
      config.displayNameMode
    ),

  customDisplayName:
    normalizeCustomDisplayName(
      config.customDisplayName
    ),

    idleImage: normalizeImagePath(
      config.idleImage
    ),

    talkingImage: normalizeImagePath(
      config.talkingImage
    ),

    mutedImage: normalizeImagePath(
      config.mutedImage
    ),

    enabled: Boolean(
      config.enabled
    ),

    sortOrder: normalizeSortOrder(
      config.sortOrder
    )
  };
}

/**
 * Verify that the current Foundry user may modify reactive portrait flags.
 *
 * Reactive portrait configuration is GM-controlled.
 */
function requireGM() {
  if (!game.user?.isGM) {
    throw new Error(
      `[${MODULE_ID}] Reactive portrait configuration may only be modified by a GM.`
    );
  }
}

// #endregion

// #region Configuration Readers

/**
 * Read the reactive portrait configuration for one Foundry User.
 *
 * Missing flags fall back to safe defaults.
 */
export function getReactivePortraitConfig(user) {
  requireUser(user);

  return normalizeConfig({
    discordUserId:
      user.getFlag(
        FLAG_SCOPE,
        FLAG_KEYS.DISCORD_USER_ID
      )
      ?? DEFAULT_REACTIVE_PORTRAIT_CONFIG.discordUserId,

    displayNameMode:
      user.getFlag(
        FLAG_SCOPE,
        FLAG_KEYS.DISPLAY_NAME_MODE
      )
      ?? DEFAULT_REACTIVE_PORTRAIT_CONFIG.displayNameMode,

    customDisplayName:
      user.getFlag(
        FLAG_SCOPE,
        FLAG_KEYS.CUSTOM_DISPLAY_NAME
      )
      ?? DEFAULT_REACTIVE_PORTRAIT_CONFIG.customDisplayName,

    idleImage:
      user.getFlag(
        FLAG_SCOPE,
        FLAG_KEYS.IDLE_IMAGE
      )
      ?? DEFAULT_REACTIVE_PORTRAIT_CONFIG.idleImage,

    talkingImage:
      user.getFlag(
        FLAG_SCOPE,
        FLAG_KEYS.TALKING_IMAGE
      )
      ?? DEFAULT_REACTIVE_PORTRAIT_CONFIG.talkingImage,

    mutedImage:
      user.getFlag(
        FLAG_SCOPE,
        FLAG_KEYS.MUTED_IMAGE
      )
      ?? DEFAULT_REACTIVE_PORTRAIT_CONFIG.mutedImage,

    enabled:
      user.getFlag(
        FLAG_SCOPE,
        FLAG_KEYS.ENABLED
      )
      ?? DEFAULT_REACTIVE_PORTRAIT_CONFIG.enabled,

    sortOrder:
      user.getFlag(
        FLAG_SCOPE,
        FLAG_KEYS.SORT_ORDER
      )
      ?? DEFAULT_REACTIVE_PORTRAIT_CONFIG.sortOrder
  });
}

/**
 * Return all Foundry Users together with their reactive portrait
 * configuration.
 */
export function getAllReactivePortraitConfigs() {
  return game.users.map((user) => ({
    user,
    config: getReactivePortraitConfig(user)
  }));
}

/**
 * Return Users which are enabled for the Reactive Portrait Bar.
 *
 * Results are sorted first by configured sortOrder and then by Foundry
 * user name to provide deterministic ordering.
 */
export function getConfiguredReactiveUsers() {
  return getAllReactivePortraitConfigs()
    .filter(({ config }) => config.enabled)
    .sort((a, b) => {
      const orderDifference =
        a.config.sortOrder - b.config.sortOrder;

      if (orderDifference !== 0) {
        return orderDifference;
      }

      return String(a.user.name ?? "").localeCompare(
        String(b.user.name ?? "")
      );
    });
}

/**
 * Find the Foundry User mapped to a Discord User ID.
 *
 * Returns null when no mapping exists.
 */
export function findUserByDiscordId(discordUserId) {
  const targetId = normalizeDiscordUserId(discordUserId);

  if (!targetId) return null;

  for (const user of game.users) {
    const config = getReactivePortraitConfig(user);

    if (config.discordUserId === targetId) {
      return user;
    }
  }

  return null;
}

// #endregion

// #region Configuration Writers

/**
 * Update one Foundry User's reactive portrait configuration.
 *
 * Only supplied properties are changed. Existing values for properties not
 * present in `changes` are preserved.
 *
 * User.setFlag is intentionally used here so persistent configuration
 * remains clearly stored as namespaced Foundry User flags.
 */
export async function setReactivePortraitConfig(
  user,
  changes = {}
) {
  requireGM();
  requireUser(user);

  const current = getReactivePortraitConfig(user);

  const next = normalizeConfig({
    ...current,
    ...changes
  });

  const writes = [];

  if (
    Object.hasOwn(changes, "discordUserId")
    && next.discordUserId !== current.discordUserId
  ) {
    writes.push([
      FLAG_KEYS.DISCORD_USER_ID,
      next.discordUserId
    ]);
  }

  if (
    Object.hasOwn(
      changes,
      "displayNameMode"
    )
    && next.displayNameMode
      !== current.displayNameMode
  ) {
    writes.push([
      FLAG_KEYS.DISPLAY_NAME_MODE,
      next.displayNameMode
    ]);
  }


  if (
    Object.hasOwn(
      changes,
      "customDisplayName"
    )
    && next.customDisplayName
      !== current.customDisplayName
  ) {
    writes.push([
      FLAG_KEYS.CUSTOM_DISPLAY_NAME,
      next.customDisplayName
    ]);
  }

  if (
    Object.hasOwn(changes, "idleImage")
    && next.idleImage !== current.idleImage
  ) {
    writes.push([
      FLAG_KEYS.IDLE_IMAGE,
      next.idleImage
    ]);
  }

  if (
    Object.hasOwn(changes, "talkingImage")
    && next.talkingImage !== current.talkingImage
  ) {
    writes.push([
      FLAG_KEYS.TALKING_IMAGE,
      next.talkingImage
    ]);
  }

  if (
    Object.hasOwn(changes, "mutedImage")
    && next.mutedImage !== current.mutedImage
  ) {
    writes.push([
      FLAG_KEYS.MUTED_IMAGE,
      next.mutedImage
    ]);
  }

  if (
    Object.hasOwn(changes, "enabled")
    && next.enabled !== current.enabled
  ) {
    writes.push([
      FLAG_KEYS.ENABLED,
      next.enabled
    ]);
  }

  if (
    Object.hasOwn(changes, "sortOrder")
    && next.sortOrder !== current.sortOrder
  ) {
    writes.push([
      FLAG_KEYS.SORT_ORDER,
      next.sortOrder
    ]);
  }

  /*
   * Perform flag writes sequentially.
   *
   * Avoid issuing simultaneous updates against the same User document.
   * Configuration changes are infrequent enough that a handful of
   * sequential flag updates are preferable to competing document updates.
   */
  for (const [key, value] of writes) {
    await user.setFlag(
      FLAG_SCOPE,
      key,
      value
    );
  }

  return getReactivePortraitConfig(user);
}

/**
 * Reset one Foundry User's reactive portrait configuration to defaults.
 */
export async function resetReactivePortraitConfig(user) {
  requireGM();
  requireUser(user);

  return setReactivePortraitConfig(
    user,
    DEFAULT_REACTIVE_PORTRAIT_CONFIG
  );
}

/**
 * Remove all reactive portrait configuration flags from one Foundry User.
 *
 * This differs from resetReactivePortraitConfig because the flags themselves
 * are removed rather than being explicitly populated with default values.
 */
export async function clearReactivePortraitConfig(user) {
  requireGM();
  requireUser(user);

  const keys = [
    FLAG_KEYS.DISCORD_USER_ID,
    FLAG_KEYS.IDLE_IMAGE,
    FLAG_KEYS.TALKING_IMAGE,
    FLAG_KEYS.MUTED_IMAGE,
    FLAG_KEYS.ENABLED,
    FLAG_KEYS.SORT_ORDER,
    FLAG_KEYS.DISPLAY_NAME_MODE,
    FLAG_KEYS.CUSTOM_DISPLAY_NAME
  ];

  for (const key of keys) {
    const existing = user.getFlag(
      FLAG_SCOPE,
      key
    );

    if (existing !== undefined) {
      await user.unsetFlag(
        FLAG_SCOPE,
        key
      );
    }
  }

  return getReactivePortraitConfig(user);
}

// #endregion

// #region Validation and Diagnostics

/**
 * Return basic configuration diagnostics for a Foundry User.
 *
 * This does not prevent incomplete configurations from existing. The
 * portrait bar can use these results to degrade gracefully.
 */
export function validateReactivePortraitConfig(user) {
  requireUser(user);

  const config = getReactivePortraitConfig(user);
  const warnings = [];

  if (config.enabled && !config.discordUserId) {
    warnings.push(
      "Enabled user has no Discord User ID."
    );
  }

  if (config.enabled && !config.idleImage) {
    warnings.push(
      "Enabled user has no idle image."
    );
  }

  if (
    config.enabled
    && config.idleImage
    && !config.talkingImage
  ) {
    warnings.push(
      "Talking image is missing; idle image will be used as the fallback."
    );
  }

  return {
    valid: warnings.length === 0,
    warnings,
    config
  };
}

// #endregion
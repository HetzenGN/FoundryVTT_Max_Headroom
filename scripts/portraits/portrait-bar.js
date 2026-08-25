// scripts/portraits/portrait-bar.js

// #region Imports

import {
  MODULE_ID
} from "../../shared/protocol.js";

import {
  getSetting,
  SETTING_KEYS
} from "../settings.js";

import {
  getReactivePortraitConfig,
  getConfiguredReactiveUsers
} from "./portrait-flags.js";

import {
  portraitState,
  DEFAULT_PORTRAIT_STATE,
  PORTRAIT_STATE_EVENTS
} from "./portrait-state.js";

// #endregion

// #region Foundry API

const {
  ApplicationV2,
  HandlebarsApplicationMixin
} = foundry.applications.api;

// #endregion

// #region Internal Helpers

/**
 * Safely escape a value for use inside a CSS selector.
 */
function escapeSelectorValue(value) {
  const stringValue = String(value ?? "");

  if (globalThis.CSS?.escape) {
    return CSS.escape(stringValue);
  }

  return stringValue.replace(
    /["\\]/g,
    "\\$&"
  );
}

/**
 * Determine which image should currently be displayed.
 *
 * Priority:
 *
 * 1. muted image, if muted and configured
 * 2. talking image, if speaking and configured
 * 3. idle image
 *
 * A missing talking image therefore falls back naturally to the idle image.
 */
function resolvePortraitImage(config, state) {
  if (
    state.muted
    && config.mutedImage
  ) {
    return config.mutedImage;
  }

  if (
    state.speaking
    && config.talkingImage
  ) {
    return config.talkingImage;
  }

  return config.idleImage || "";
}

/**
 * Build the transient view model used by the portrait template and DOM
 * patching code.
 */
function buildPortraitViewModel(user) {
  const config =
    getReactivePortraitConfig(user);

  const state =
    portraitState.getState(user.id)
    ?? {
      ...DEFAULT_PORTRAIT_STATE,
      discordUserId: config.discordUserId
    };

  const image = resolvePortraitImage(
    config,
    state
  );

  return {
    userId: user.id,
    name: String(user.name ?? ""),
    discordUserId:
      config.discordUserId,

    image,
    hasImage: Boolean(image),

    speaking:
      Boolean(state.speaking),

    muted:
      Boolean(state.muted),

    deafened:
      Boolean(state.deafened)
  };
}

// #endregion

// #region Reactive Portrait Bar Application

/**
 * Player-facing reactive portrait overlay.
 *
 * This Application does not communicate with StreamKit and does not own
 * authoritative relay state.
 *
 * It consumes:
 *
 * - persistent User configuration through portrait-flags.js
 * - transient runtime state through portrait-state.js
 */
export class ReactivePortraitBar extends HandlebarsApplicationMixin(
  ApplicationV2
) {
  // #region Application Configuration

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-portrait-bar`,

    tag: "section",

    classes: [
      MODULE_ID,
      "max-headroom-portrait-bar"
    ],

    window: {
      frame: false,
      positioned: false
    }
  };

  static PARTS = {
    bar: {
      template:
        `modules/${MODULE_ID}/templates/portrait-bar.hbs`
    }
  };

  // #endregion

  // #region Construction

  constructor(options = {}) {
    super(options);

    /**
     * Unsubscribe callback returned by PortraitStateStore.subscribe().
     */
    this._unsubscribeState = null;
  }

  // #endregion

  // #region Context Preparation

  /**
   * Prepare the data used for a full portrait-bar render.
   *
   * Full rendering is intended for:
   *
   * - initial creation
   * - configuration changes
   * - user-list changes
   * - layout-setting changes
   *
   * Speaking changes do not normally come through here.
   */
  async _prepareContext(options) {
    const context =
      await super._prepareContext(options);

    const configuredUsers =
      getConfiguredReactiveUsers();

    const portraits =
      configuredUsers.map(
        ({ user }) =>
          buildPortraitViewModel(user)
      );

    return {
      ...context,

      portraits,
      hasUsers:
        portraits.length > 0,

      anchor:
        getSetting(
          SETTING_KEYS.BAR_ANCHOR
        ),

      orientation:
        getSetting(
          SETTING_KEYS.ORIENTATION
        ),

      tileSize:
        getSetting(
          SETTING_KEYS.TILE_SIZE
        ),

      showNames:
        getSetting(
          SETTING_KEYS.SHOW_NAMES
        ),

      animationEnabled:
        getSetting(
          SETTING_KEYS.ANIMATION_ENABLED
        )
    };
  }

  // #endregion

  // #region Render Lifecycle

  /**
   * Perform post-render setup.
   */
  async _onRender(context, options) {
    await super._onRender(
      context,
      options
    );

    this._applyPresentationOptions(
      context
    );

    this._ensureStateSubscription();
  }

  /**
   * Clean up the portrait-state subscription when the application closes.
   */
  _onClose(options) {
    this._removeStateSubscription();

    return super._onClose(options);
  }

  // #endregion

  // #region Presentation

  /**
   * Apply world-level presentation settings to the Application root.
   *
   * CSS will use these data attributes and variables to control docking
   * and layout.
   */
  _applyPresentationOptions(context) {
    const element = this.element;

    if (!element) {
      return;
    }

    element.dataset.anchor =
      String(context.anchor ?? "bottom");

    element.dataset.orientation =
      String(
        context.orientation
        ?? "horizontal"
      );

    element.classList.toggle(
      "animations-enabled",
      Boolean(context.animationEnabled)
    );

    element.classList.toggle(
      "is-empty",
      !context.hasUsers
    );

    element.style.setProperty(
      "--max-headroom-tile-size",
      `${Number(context.tileSize) || 160}px`
    );

    /*
     * An unconfigured portrait bar should not occupy interface space.
     */
    element.hidden =
      !context.hasUsers;
  }

  // #endregion

  // #region State Subscription

  /**
   * Subscribe once to the shared client-side PortraitStateStore.
   */
  _ensureStateSubscription() {
    if (this._unsubscribeState) {
      return;
    }

    this._unsubscribeState =
      portraitState.subscribe(
        (event) => {
          this._handleStateEvent(event);
        }
      );
  }

  /**
   * Remove the current PortraitStateStore subscription.
   */
  _removeStateSubscription() {
    if (!this._unsubscribeState) {
      return;
    }

    this._unsubscribeState();

    this._unsubscribeState = null;
  }

  /**
   * React to runtime portrait-state events.
   */
  _handleStateEvent(event) {
    if (!this.rendered) {
      return;
    }

    switch (event.type) {
      case PORTRAIT_STATE_EVENTS.UPDATE:
        this._patchTile(
          event.userId
        );
        break;

      case PORTRAIT_STATE_EVENTS.REMOVE:
        this._patchTile(
          event.userId
        );
        break;

      case PORTRAIT_STATE_EVENTS.REPLACE_ALL:
        this._patchAllTiles();
        break;

      /*
       * resetSpeakingStates() and resetAllStates() already emit UPDATE
       * events for affected users, so RESET does not require another
       * full pass.
       */
      case PORTRAIT_STATE_EVENTS.RESET:
        break;

      default:
        break;
    }
  }

  // #endregion

  // #region DOM Patching

  /**
   * Patch one existing portrait tile without re-rendering the Application.
   */
  _patchTile(userId) {
    const normalizedUserId =
      String(userId ?? "");

    if (
      !normalizedUserId
      || !this.rendered
    ) {
      return;
    }

    const selectorUserId =
      escapeSelectorValue(
        normalizedUserId
      );

    const tile =
      this.element?.querySelector(
        `[data-user-id="${selectorUserId}"]`
      );

    if (!tile) {
      return;
    }

    const user =
      game.users.get(
        normalizedUserId
      );

    if (!user) {
      return;
    }

    const view =
      buildPortraitViewModel(user);

    this._applyViewModelToTile(
      tile,
      view
    );
  }

  /**
   * Patch every currently rendered portrait tile.
   *
   * Used after a full runtime-state synchronization.
   */
  _patchAllTiles() {
    if (!this.rendered) {
      return;
    }

    const tiles =
      this.element?.querySelectorAll(
        "[data-user-id]"
      )
      ?? [];

    for (const tile of tiles) {
      const userId =
        tile.dataset.userId;

      if (!userId) {
        continue;
      }

      const user =
        game.users.get(userId);

      if (!user) {
        continue;
      }

      const view =
        buildPortraitViewModel(user);

      this._applyViewModelToTile(
        tile,
        view
      );
    }
  }

  /**
   * Apply a prepared portrait view model to one tile.
   */
  _applyViewModelToTile(
    tile,
    view
  ) {
    // #region Tile State Classes

    tile.classList.toggle(
      "is-speaking",
      view.speaking
    );

    tile.classList.toggle(
      "is-muted",
      view.muted
    );

    tile.classList.toggle(
      "is-deafened",
      view.deafened
    );

    tile.classList.toggle(
      "has-image",
      view.hasImage
    );

    tile.classList.toggle(
      "missing-image",
      !view.hasImage
    );

    tile.dataset.speaking =
      String(view.speaking);

    tile.dataset.muted =
      String(view.muted);

    tile.dataset.deafened =
      String(view.deafened);

    // #endregion

    // #region Portrait Image

    const imageElement =
      tile.querySelector(
        '[data-role="portrait-image"]'
      );

    const placeholderElement =
      tile.querySelector(
        '[data-role="portrait-placeholder"]'
      );

    if (imageElement) {
      if (view.image) {
        if (
          imageElement.getAttribute("src")
          !== view.image
        ) {
          imageElement.setAttribute(
            "src",
            view.image
          );
        }

        imageElement.hidden = false;
      } else {
        imageElement.removeAttribute(
          "src"
        );

        imageElement.hidden = true;
      }

      imageElement.alt =
        view.name
          ? `${view.name} reactive portrait`
          : "Reactive portrait";
    }

    if (placeholderElement) {
      placeholderElement.hidden =
        Boolean(view.image);
    }

    // #endregion

    // #region Accessibility State

    const stateParts = [];

    if (view.speaking) {
      stateParts.push("speaking");
    }

    if (view.muted) {
      stateParts.push("muted");
    }

    if (view.deafened) {
      stateParts.push("deafened");
    }

    const stateDescription =
      stateParts.length > 0
        ? `, ${stateParts.join(", ")}`
        : "";

    tile.setAttribute(
      "aria-label",
      `${view.name || "Reactive portrait"}${stateDescription}`
    );

    // #endregion
  }

  // #endregion

  // #region Public Application Methods

  /**
   * Fully refresh portrait configuration and layout.
   *
   * Use this after User flag or world-setting changes.
   */
  async refresh() {
    return this.render({
      force: true
    });
  }

  /**
   * Patch one user's current runtime state.
   *
   * Primarily useful for debugging and the future public module API.
   */
  patchUser(userId) {
    this._patchTile(userId);
  }

  /**
   * Patch all portrait runtime states without performing a full render.
   */
  patchAll() {
    this._patchAllTiles();
  }

  // #endregion
}

// #endregion

// #region Singleton

/**
 * One portrait-bar Application instance per Foundry client.
 */
export const portraitBar =
  new ReactivePortraitBar();

// #endregion
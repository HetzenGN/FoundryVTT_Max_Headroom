// scripts/portraits/portrait-bar.js

// #region Imports

import {
  MODULE_ID
} from "../../shared/protocol.js";

import {
  getPortraitPresentationSettings,
  setUserBarPosition,
  setUserBarScale
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

// #region Interaction Constants

const MIN_BAR_SCALE = 0.5;
const MAX_BAR_SCALE = 2.0;

const VIEWPORT_MARGIN = 8;

function clamp(
  value,
  minimum,
  maximum
) {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value
    )
  );
}

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
    this._editMode = false;

    this._interactionAbortController =
      null;

    this._pointerAbortController =
      null;

    this._dragState = null;
    this._scaleState = null;
  }

  // #endregion

  // #region Context Preparation

  async _prepareContext(options) {
    const context =
      await super._prepareContext(
        options
      );

    const configuredUsers =
      getConfiguredReactiveUsers();

    const portraits =
      configuredUsers.map(
        ({ user }) =>
          buildPortraitViewModel(user)
      );

    const presentation =
      getPortraitPresentationSettings();

    return {
      ...context,

      portraits,

      hasUsers:
        portraits.length > 0,

      anchor:
        presentation.anchor,

      orientation:
        presentation.orientation,

      tileSize:
        presentation.tileSize,

      showNames:
        presentation.showNames,

      animationEnabled:
        presentation.animationEnabled,

      positionX:
        presentation.positionX,

      positionY:
        presentation.positionY,

      hasCustomPosition:
        presentation.hasCustomPosition,

      scale:
        presentation.scale
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
    this._applyEditModeState();

    this._attachInteractionListeners();

  globalThis.requestAnimationFrame(
    () => {
      if (context.hasCustomPosition) {
        this._clampCustomPosition();
      }

      this._updateLockPosition();
    }
  );
  }

  /**
   * Clean up the portrait-state subscription when the application closes.
   */
  _onClose(options) {
    this._removeStateSubscription();
    this._removeInteractionListeners();
    this._endPointerInteraction();
    return super._onClose(options);
  }

  // #endregion

  // #region Presentation

  _applyPresentationOptions(context) {
    const element =
      this.element;

    if (!element) {
      return;
    }

    element.dataset.anchor =
      String(
        context.anchor
        ?? "bottom"
      );

    element.dataset.orientation =
      String(
        context.orientation
        ?? "horizontal"
      );

    element.classList.toggle(
      "animations-enabled",
      Boolean(
        context.animationEnabled
      )
    );

    element.classList.toggle(
      "is-empty",
      !context.hasUsers
    );

    element.style.setProperty(
      "--max-headroom-tile-size",
      `${Number(context.tileSize) || 160}px`
    );

    const scale =
      clamp(
        Number(context.scale) || 1,
        MIN_BAR_SCALE,
        MAX_BAR_SCALE
      );

    element.style.setProperty(
      "--max-headroom-user-scale",
      String(scale)
    );

    if (context.hasCustomPosition) {
      element.dataset.positionMode =
        "custom";

      element.style.left =
        `${context.positionX}px`;

      element.style.top =
        `${context.positionY}px`;

      element.style.right =
        "auto";

      element.style.bottom =
        "auto";

      element.style.transform =
        "none";
    } else {
      element.dataset.positionMode =
        "anchor";

      element.style.removeProperty(
        "left"
      );

      element.style.removeProperty(
        "top"
      );

      element.style.removeProperty(
        "right"
      );

      element.style.removeProperty(
        "bottom"
      );

      element.style.removeProperty(
        "transform"
      );
    }

    element.hidden =
      !context.hasUsers;
  }

  /**
 * Position the unscaled lock control over the actual rendered
 * top-right corner of the scaled Portrait Bar.
 */
_updateLockPosition() {
  const element =
    this.element;

  if (!element) {
    return;
  }

  const inner =
    element.querySelector(
      ".max-headroom-portrait-bar__inner"
    );

  const lock =
    element.querySelector(
      '[data-role="edit-toggle"]'
    );

  if (
    !inner
    || !lock
  ) {
    return;
  }

  /*
   * getBoundingClientRect() includes the current CSS scale transform.
   */
  const innerRect =
    inner.getBoundingClientRect();

  const rootRect =
    element.getBoundingClientRect();

  lock.style.left =
    `${innerRect.right - rootRect.left}px`;

  lock.style.top =
    `${innerRect.top - rootRect.top}px`;
}


  // #endregion

  // #region Edit Mode Actions

  async _onClickAction(
    event,
    target
  ) {
    if (
      target.dataset.action
      === "toggleEditMode"
    ) {
      this._editMode =
        !this._editMode;

      if (!this._editMode) {
        this._endPointerInteraction();
      }

      this._applyEditModeState();

      return;
    }

    return super._onClickAction(
      event,
      target
    );
  }


  _applyEditModeState() {
    const element =
      this.element;

    if (!element) {
      return;
    }

    element.classList.toggle(
      "is-editing",
      this._editMode
    );

    const button =
      element.querySelector(
        '[data-role="edit-toggle"]'
      );

    const icon =
      element.querySelector(
        '[data-role="lock-icon"]'
      );

    if (button) {
      button.title =
        this._editMode
          ? "Lock Portrait Bar"
          : "Unlock Portrait Bar";

      button.setAttribute(
        "aria-label",
        button.title
      );
    }

    if (icon) {
      icon.classList.toggle(
        "fa-lock",
        !this._editMode
      );

      icon.classList.toggle(
        "fa-lock-open",
        this._editMode
      );
    }
  }

  // #endregion

  // #region Drag and Proportional Scaling

  _attachInteractionListeners() {
    this._removeInteractionListeners();

    if (!this.element) {
      return;
    }

    this._interactionAbortController =
      new AbortController();

    const signal =
      this._interactionAbortController.signal;

    const dragSurface =
      this.element.querySelector(
        '[data-role="drag-surface"]'
      );

    const scaleHandle =
      this.element.querySelector(
        '[data-role="scale-handle"]'
      );

    dragSurface?.addEventListener(
      "pointerdown",
      (event) => {
        this._beginDrag(event);
      },
      {
        signal
      }
    );

    scaleHandle?.addEventListener(
      "pointerdown",
      (event) => {
        event.stopPropagation();

        this._beginScale(event);
      },
      {
        signal
      }
    );
  }


  _removeInteractionListeners() {
    this._interactionAbortController
      ?.abort();

    this._interactionAbortController =
      null;
  }


  _beginDrag(event) {
  if (
    !this._editMode
    || event.button !== 0
    || event.target.closest(
      '[data-role="scale-handle"]'
    )
    || event.target.closest(
      '[data-role="edit-toggle"]'
    )
  ) {
    return;
  }

    const inner =
      this.element?.querySelector(
        ".max-headroom-portrait-bar__inner"
      );

    if (!inner) {
      return;
    }

    event.preventDefault();

    const rect =
      inner.getBoundingClientRect();

    this._setCustomPosition(
      rect.left,
      rect.top
    );

    this._dragState = {
      pointerX:
        event.clientX,

      pointerY:
        event.clientY,

      left:
        rect.left,

      top:
        rect.top
    };

    this._scaleState =
      null;

    this._startPointerInteraction();
  }


  _beginScale(event) {
    if (
      !this._editMode
      || event.button !== 0
    ) {
      return;
    }

    const inner =
      this.element?.querySelector(
        ".max-headroom-portrait-bar__inner"
      );

    if (!inner) {
      return;
    }

    event.preventDefault();

    const rect =
      inner.getBoundingClientRect();

    const currentScale =
      this._getCurrentScale();

    /*
    * Scaling switches an anchored bar into custom-position mode while
    * preserving its current visible top-left location.
    */
    this._setCustomPosition(
      rect.left,
      rect.top
    );

    const distance =
      Math.max(
        1,
        Math.hypot(
          event.clientX - rect.left,
          event.clientY - rect.top
        )
      );

    this._scaleState = {
      left:
        rect.left,

      top:
        rect.top,

      startScale:
        currentScale,

      startDistance:
        distance
    };

    this._dragState =
      null;

    this._startPointerInteraction();
  }


_startPointerInteraction() {
  this._pointerAbortController
    ?.abort();

  this._pointerAbortController =
    null;

  this._pointerAbortController =
    new AbortController();

    const signal =
      this._pointerAbortController.signal;

    globalThis.addEventListener(
      "pointermove",
      (event) => {
        this._handlePointerMove(
          event
        );
      },
      {
        signal
      }
    );

    globalThis.addEventListener(
      "pointerup",
      () => {
        this._finishPointerInteraction();
      },
      {
        signal,
        once: true
      }
    );

    globalThis.addEventListener(
      "pointercancel",
      () => {
        this._finishPointerInteraction();
      },
      {
        signal,
        once: true
      }
    );
  }


  _handlePointerMove(event) {
    if (this._dragState) {
      const deltaX =
        event.clientX
        - this._dragState.pointerX;

      const deltaY =
        event.clientY
        - this._dragState.pointerY;

      const position =
        this._clampPosition(
          this._dragState.left
            + deltaX,

          this._dragState.top
            + deltaY,

          this._getCurrentScale()
        );

      this._setCustomPosition(
        position.left,
        position.top
      );

      this._updateLockPosition();

      return;
    }

    if (this._scaleState) {
      const distance =
        Math.max(
          1,
          Math.hypot(
            event.clientX
              - this._scaleState.left,

            event.clientY
              - this._scaleState.top
          )
        );

      const ratio =
        distance
        / this._scaleState.startDistance;

      const scale =
        clamp(
          this._scaleState.startScale
            * ratio,

          MIN_BAR_SCALE,
          MAX_BAR_SCALE
        );

      this.element.style.setProperty(
        "--max-headroom-user-scale",
        String(scale)
      );

      const position =
        this._clampPosition(
          this._scaleState.left,
          this._scaleState.top,
          scale
        );

      this._setCustomPosition(
        position.left,
        position.top
      );

      this._updateLockPosition();
    }
  }


  async _finishPointerInteraction() {
    const hadInteraction =
      Boolean(
        this._dragState
        || this._scaleState
      );

    const left =
      Number.parseFloat(
        this.element?.style.left
        ?? ""
      );

    const top =
      Number.parseFloat(
        this.element?.style.top
        ?? ""
      );

    const scale =
      this._getCurrentScale();

    this._endPointerInteraction(
      false
    );

    if (
      !hadInteraction
      || !Number.isFinite(left)
      || !Number.isFinite(top)
    ) {
      return;
    }

    await setUserBarPosition(
      left,
      top
    );

    await setUserBarScale(
      scale
    );
  }


  _endPointerInteraction(
    clearState = true
  ) {
    this._pointerAbortController
      ?.abort();

    this._pointerAbortController =
      null;

    if (clearState) {
      this._dragState =
        null;

      this._scaleState =
        null;
    }
  }


  _setCustomPosition(
    left,
    top
  ) {
    if (!this.element) {
      return;
    }

    this.element.dataset.positionMode =
      "custom";

    this.element.style.left =
      `${Math.round(left)}px`;

    this.element.style.top =
      `${Math.round(top)}px`;

    this.element.style.right =
      "auto";

    this.element.style.bottom =
      "auto";

    this.element.style.transform =
      "none";
  }


  _getCurrentScale() {
    if (!this.element) {
      return 1;
    }

    const value =
      Number.parseFloat(
        globalThis
          .getComputedStyle(
            this.element
          )
          .getPropertyValue(
            "--max-headroom-user-scale"
          )
      );

    return Number.isFinite(value)
      ? clamp(
          value,
          MIN_BAR_SCALE,
          MAX_BAR_SCALE
        )
      : 1;
  }


  _getScaledBarSize(scale) {
    const inner =
      this.element?.querySelector(
        ".max-headroom-portrait-bar__inner"
      );

    if (!inner) {
      return {
        width: 0,
        height: 0
      };
    }

    return {
      width:
        inner.offsetWidth
        * scale,

      height:
        inner.offsetHeight
        * scale
    };
  }


  _clampPosition(
    left,
    top,
    scale
  ) {
    const size =
      this._getScaledBarSize(
        scale
      );

    const maxLeft =
      Math.max(
        VIEWPORT_MARGIN,
        globalThis.innerWidth
          - size.width
          - VIEWPORT_MARGIN
      );

    const maxTop =
      Math.max(
        VIEWPORT_MARGIN,
        globalThis.innerHeight
          - size.height
          - VIEWPORT_MARGIN
      );

    return {
      left:
        clamp(
          left,
          VIEWPORT_MARGIN,
          maxLeft
        ),

      top:
        clamp(
          top,
          VIEWPORT_MARGIN,
          maxTop
        )
    };
  }


  _clampCustomPosition() {
    if (
      !this.element
      || this.element.dataset.positionMode
        !== "custom"
    ) {
      return;
    }

    const left =
      Number.parseFloat(
        this.element.style.left
      );

    const top =
      Number.parseFloat(
        this.element.style.top
      );

    if (
      !Number.isFinite(left)
      || !Number.isFinite(top)
    ) {
      return;
    }

    const position =
      this._clampPosition(
        left,
        top,
        this._getCurrentScale()
      );

    this._setCustomPosition(
      position.left,
      position.top
    );
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
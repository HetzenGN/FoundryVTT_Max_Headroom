// scripts/portraits/portrait-preferences-app.js

// #region Imports

import {
  MODULE_ID
} from "../../shared/protocol.js";

import {
  getSetting,
  setSetting,
  SETTING_KEYS,
  getPortraitPresentationSettings,
  resetUserBarPositionAndSize
} from "../settings.js";

import {
  portraitBar
} from "./portrait-bar.js";

// #endregion


// #region Foundry API

const {
  ApplicationV2,
  HandlebarsApplicationMixin
} = foundry.applications.api;

// #endregion


// #region Constants

export const PORTRAIT_PREFERENCES_MENU_KEY =
  "portraitBarPreferences";

// #endregion


// #region Internal Helpers

function choice(
  value,
  label,
  current
) {
  return {
    value,
    label,
    selected:
      String(current) === String(value)
  };
}

// #endregion


// #region Portrait Preferences Application

export class PortraitPreferencesApp extends HandlebarsApplicationMixin(
  ApplicationV2
) {
  // #region Application Configuration

  static DEFAULT_OPTIONS = {
    id:
      `${MODULE_ID}-portrait-preferences`,

    tag:
      "form",

    classes: [
      MODULE_ID,
      "max-headroom-portrait-preferences"
    ],

    position: {
      width: 520,
      height: 600
    },

    window: {
      title:
        "FoundryVTT_Max_Headroom: Portrait Bar Preferences",

      icon:
        "fa-solid fa-image",

      resizable:
        false
    },

    form: {
      closeOnSubmit:
        false,

      submitOnChange:
        false,

      async handler(
        event,
        form
      ) {
        return this._savePreferences(
          form
        );
      }
    }
  };


  static PARTS = {
    body: {
      template:
        `modules/${MODULE_ID}/templates/portrait-preferences.hbs`
    }
  };

  // #endregion


  // #region Context Preparation

  async _prepareContext(options) {
    const context =
      await super._prepareContext(
        options
      );

    const anchor =
      getSetting(
        SETTING_KEYS.USER_BAR_ANCHOR
      );

    const orientation =
      getSetting(
        SETTING_KEYS.USER_ORIENTATION
      );

    const showNames =
      getSetting(
        SETTING_KEYS.USER_SHOW_NAMES
      );

    const animation =
      getSetting(
        SETTING_KEYS.USER_ANIMATION_ENABLED
      );

    const presentation =
      getPortraitPresentationSettings();

    const gmAnchor =
      getSetting(
        SETTING_KEYS.BAR_ANCHOR
      );

    const gmOrientation =
      getSetting(
        SETTING_KEYS.ORIENTATION
      );

    const gmShowNames =
      Boolean(
        getSetting(
          SETTING_KEYS.SHOW_NAMES
        )
      );

    const gmAnimation =
      Boolean(
        getSetting(
          SETTING_KEYS.ANIMATION_ENABLED
        )
      );

    return {
      ...context,

      anchorChoices: [
        choice(
          "default",
          `Use GM Default (${gmAnchor})`,
          anchor
        ),
        choice(
          "bottom",
          "Bottom",
          anchor
        ),
        choice(
          "top",
          "Top",
          anchor
        ),
        choice(
          "left",
          "Left",
          anchor
        ),
        choice(
          "right",
          "Right",
          anchor
        )
      ],

      orientationChoices: [
        choice(
          "default",
          `Use GM Default (${gmOrientation})`,
          orientation
        ),
        choice(
          "horizontal",
          "Horizontal",
          orientation
        ),
        choice(
          "vertical",
          "Vertical",
          orientation
        )
      ],

      showNameChoices: [
        choice(
          "default",
          `Use GM Default (${gmShowNames ? "Shown" : "Hidden"})`,
          showNames
        ),
        choice(
          "true",
          "Show Names",
          showNames
        ),
        choice(
          "false",
          "Hide Names",
          showNames
        )
      ],

      animationChoices: [
        choice(
          "default",
          `Use GM Default (${gmAnimation ? "On" : "Off"})`,
          animation
        ),
        choice(
          "true",
          "On",
          animation
        ),
        choice(
          "false",
          "Off",
          animation
        )
      ],

      currentScalePercent:
        Math.round(
          presentation.scale * 100
        ),

      hasCustomPosition:
        presentation.hasCustomPosition
    };
  }

  // #endregion


  // #region Application Actions

  async _onClickAction(
    event,
    target
  ) {
    switch (
      target.dataset.action
    ) {
      case "resetPositionSize":
        return this._resetPositionSize();

      default:
        return super._onClickAction(
          event,
          target
        );
    }
  }

  // #endregion


  // #region Save Preferences

  async _savePreferences(form) {
    const read =
      (name) =>
        form.querySelector(
          `[name="${name}"]`
        );

    await setSetting(
      SETTING_KEYS.USER_BAR_ANCHOR,
      read("anchor")?.value
      ?? "default"
    );

    await setSetting(
      SETTING_KEYS.USER_ORIENTATION,
      read("orientation")?.value
      ?? "default"
    );

    await setSetting(
      SETTING_KEYS.USER_SHOW_NAMES,
      read("showNames")?.value
      ?? "default"
    );

    await setSetting(
      SETTING_KEYS.USER_ANIMATION_ENABLED,
      read("animationEnabled")?.value
      ?? "default"
    );

    await portraitBar.refresh();

    ui.notifications.info(
      "Portrait Bar preferences saved."
    );

    await this.render({
      force: true
    });

    return true;
  }

  // #endregion


  // #region Reset Position and Size

  async _resetPositionSize() {
    await resetUserBarPositionAndSize();

    await portraitBar.refresh();

    ui.notifications.info(
      "Portrait Bar position and size reset to GM defaults."
    );

    await this.render({
      force: true
    });
  }

  // #endregion
}

// #endregion


// #region Settings Menu Registration

export function registerPortraitPreferencesMenu() {
  game.settings.registerMenu(
    MODULE_ID,
    PORTRAIT_PREFERENCES_MENU_KEY,
    {
      name:
        "Portrait Bar Preferences",

      label:
        "Configure Portrait Bar",

      hint:
        "Configure your personal Portrait Bar layout, size, names, and speaking animation.",

      icon:
        "fa-solid fa-sliders",

      type:
        PortraitPreferencesApp,

      restricted:
        false
    }
  );
}

// #endregion
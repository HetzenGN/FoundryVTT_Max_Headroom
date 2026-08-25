// scripts/portraits/portrait-config-app.js

// #region Imports

import {
  MODULE_ID
} from "../../shared/protocol.js";

import {
  getAllReactivePortraitConfigs,
  setReactivePortraitConfig
} from "./portrait-flags.js";

import {
  portraitBar
} from "./portrait-bar.js";

// #endregion


// #region Foundry API

const {
  ApplicationV2,
  HandlebarsApplicationMixin
} = foundry.applications.api;

const {
  FilePicker
} = foundry.applications.apps;

// #endregion


// #region Constants

export const PORTRAIT_CONFIG_MENU_KEY =
  "reactivePortraitUsers";

// #endregion


// #region Reactive User Configuration Application

/**
 * GM-only configuration window for reactive portrait User data.
 *
 * Persistent configuration is stored through portrait-flags.js.
 */
export class ReactiveUserConfigApp extends HandlebarsApplicationMixin(
  ApplicationV2
) {
  // #region Application Configuration

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-user-config`,

    tag: "form",

    classes: [
      MODULE_ID,
      "max-headroom-user-config"
    ],

    position: {
      width: 940,
      height: 720
    },

    window: {
      title: "FoundryVTT_Max_Headroom: Reactive Portrait Users",
      icon: "fa-solid fa-users",
      resizable: true
    },

    form: {
      closeOnSubmit: false,
      submitOnChange: false,

      async handler(event, form) {
        return this._saveUserConfigurations(
          form
        );
      }
    }
  };

  static PARTS = {
    body: {
      template:
        `modules/${MODULE_ID}/templates/reactive-user-config.hbs`
    }
  };

  // #endregion


  // #region Render Permission

  /**
   * Prevent non-GMs from opening the configuration window even if they
   * somehow invoke the Application directly.
   */
  _canRender(options) {
    const allowed =
      super._canRender(options);

    if (allowed === false) {
      return false;
    }

    if (!game.user?.isGM) {
      ui.notifications.warn(
        "Only a GM may configure reactive portraits."
      );

      return false;
    }
  }

  // #endregion


  // #region Context Preparation

  async _prepareContext(options) {
    const context =
      await super._prepareContext(options);

    const users =
      getAllReactivePortraitConfigs()
        .map(
          ({ user, config }) => ({
            userId: user.id,
            name: String(
              user.name ?? "Unnamed User"
            ),

            config
          })
        )
        .sort((a, b) => {
          const orderDifference =
            a.config.sortOrder
            - b.config.sortOrder;

          if (orderDifference !== 0) {
            return orderDifference;
          }

          return a.name.localeCompare(
            b.name
          );
        });

    return {
      ...context,
      users
    };
  }

  // #endregion


  // #region Application Actions

  /**
   * Handle normal template data-action buttons.
   */
  async _onClickAction(
    event,
    target
  ) {
    switch (target.dataset.action) {
      case "browseImage":
        return this._openImagePicker(
          target
        );

      default:
        return super._onClickAction(
          event,
          target
        );
    }
  }

  // #endregion


  // #region Image Picker

  /**
   * Open Foundry's FilePicker for one image field.
   *
   * The template button supplies:
   *
   * data-type="image"
   * data-target="<input name>"
   * data-user-id="<Foundry User ID>"
   * data-field="<configuration field>"
   */
  async _openImagePicker(button) {
    const picker =
      FilePicker.fromButton(button);

    const input =
      picker.field;

    if (!input) {
      console.error(
        `[${MODULE_ID}] FilePicker could not resolve its target input.`,
        button
      );

      return;
    }

    const userId =
      button.dataset.userId;

    const field =
      button.dataset.field;

    /*
     * Replace the default callback so we can update both the input and
     * the visible preview immediately.
     */
    picker.callback = (path) => {
      input.value =
        String(path ?? "");

      this._updateImagePreview(
        userId,
        field,
        input.value
      );
    };

    await picker.render({
      force: true
    });
  }

  /**
   * Update one image preview without re-rendering the entire config window.
   */
  _updateImagePreview(
    userId,
    field,
    path
  ) {
    if (
      !userId
      || !field
      || !this.element
    ) {
      return;
    }

    const row =
      this.element.querySelector(
        `[data-role="user-config-row"][data-user-id="${CSS.escape(userId)}"]`
      );

    if (!row) {
      return;
    }

    const preview =
      row.querySelector(
        `[data-preview-field="${CSS.escape(field)}"]`
      );

    if (!preview) {
      return;
    }

    preview.replaceChildren();

    if (path) {
      const image =
        document.createElement("img");

      image.src = path;
      image.alt = "";
      image.draggable = false;

      preview.append(image);

      preview.classList.remove(
        "is-empty"
      );

      return;
    }

    const empty =
      document.createElement("span");

    empty.textContent =
      "No image selected";

    preview.append(empty);

    preview.classList.add(
      "is-empty"
    );
  }

  // #endregion


  // #region Form Reading

  /**
   * Read one User's configuration from its form row.
   */
  _readUserRow(row) {
    const userId =
      row.dataset.userId;

    const read =
      (field) =>
        row.querySelector(
          `[data-field="${field}"]`
        );

    return {
      userId,

      config: {
        discordUserId:
          read("discordUserId")
            ?.value
            ?.trim()
          ?? "",

        idleImage:
          read("idleImage")
            ?.value
            ?.trim()
          ?? "",

        talkingImage:
          read("talkingImage")
            ?.value
            ?.trim()
          ?? "",

        mutedImage:
          read("mutedImage")
            ?.value
            ?.trim()
          ?? "",

        enabled:
          Boolean(
            read("enabled")
              ?.checked
          ),

        sortOrder:
          Number(
            read("sortOrder")
              ?.value
            ?? 0
          )
      }
    };
  }

  /**
   * Read all User configuration rows.
   */
  _readAllUserRows(form) {
    const rows =
      form.querySelectorAll(
        '[data-role="user-config-row"]'
      );

    return Array.from(rows).map(
      (row) =>
        this._readUserRow(row)
    );
  }

  // #endregion


  // #region Configuration Validation

  /**
   * Prevent multiple Foundry Users from being mapped to the same Discord
   * User ID.
   *
   * One Discord speaking event must resolve unambiguously to one Foundry User.
   */
  _validateConfigurations(
    entries
  ) {
    const discordMappings =
      new Map();

    for (const entry of entries) {
      const discordUserId =
        String(
          entry.config.discordUserId
          ?? ""
        ).trim();

      if (!discordUserId) {
        continue;
      }

      const existing =
        discordMappings.get(
          discordUserId
        );

      if (existing) {
        const firstUser =
          game.users.get(existing);

        const secondUser =
          game.users.get(
            entry.userId
          );

        return {
          valid: false,

          message:
            `Discord User ID ${discordUserId} is assigned to both `
            + `"${firstUser?.name ?? existing}" and `
            + `"${secondUser?.name ?? entry.userId}".`
        };
      }

      discordMappings.set(
        discordUserId,
        entry.userId
      );
    }

    return {
      valid: true,
      message: ""
    };
  }

  // #endregion


  // #region Configuration Save

  /**
   * Persist every User row through portrait-flags.js.
   */
  async _saveUserConfigurations(
    form
  ) {
    if (!game.user?.isGM) {
      ui.notifications.error(
        "Only a GM may modify reactive portrait configuration."
      );

      return false;
    }

    const entries =
      this._readAllUserRows(form);

    const validation =
      this._validateConfigurations(
        entries
      );

    if (!validation.valid) {
      ui.notifications.error(
        validation.message
      );

      return false;
    }

    try {
      /*
       * Save Users sequentially.
       *
       * portrait-flags.js already performs each User's flag writes
       * sequentially, so this avoids competing updates against User
       * documents.
       */
      for (const entry of entries) {
        const user =
          game.users.get(
            entry.userId
          );

        if (!user) {
          console.warn(
            `[${MODULE_ID}] User disappeared while saving configuration.`,
            entry.userId
          );

          continue;
        }

        await setReactivePortraitConfig(
          user,
          entry.config
        );
      }

      /*
       * Configuration changes affect which tiles exist and which images
       * they use, so this is an appropriate full Portrait Bar refresh.
       */
      await portraitBar.refresh();

      /*
       * Re-render this window to display normalized values and apply the
       * newly-saved sort order.
       */
      await this.render({
        force: true
      });

      ui.notifications.info(
        "Reactive portrait configuration saved."
      );

      return true;
    } catch (error) {
      console.error(
        `[${MODULE_ID}] Failed to save reactive portrait configuration.`,
        error
      );

      ui.notifications.error(
        "Failed to save reactive portrait configuration. See the console for details."
      );

      return false;
    }
  }

  // #endregion
}

// #endregion


// #region Settings Menu Registration

/**
 * Register the GM-only configuration application as a Foundry settings
 * submenu.
 */
export function registerPortraitConfigMenu() {
  game.settings.registerMenu(
    MODULE_ID,
    PORTRAIT_CONFIG_MENU_KEY,
    {
      name:
        "Reactive Portrait Users",

      label:
        "Configure Reactive Portraits",

      hint:
        "Configure Discord mappings and reactive portrait images for Foundry users.",

      icon:
        "fa-solid fa-users-gear",

      type:
        ReactiveUserConfigApp,

      restricted:
        true
    }
  );
}

// #endregion
// relay/src/bootstrap.js

// #region Imports

import {
  PROTOCOL_VERSION
} from "../../shared/protocol.js";

// #endregion


// #region Constants

export const BOOTSTRAP_QUERY_KEYS =
  Object.freeze({
    NONCE: "maxHeadroomNonce",
    PROTOCOL: "maxHeadroomProtocol",
    OPENER_ORIGIN:
      "maxHeadroomOpenerOrigin"
  });

// The current Foundry controller generates 24 random bytes
// and encodes them as 48 hexadecimal characters.
const NONCE_PATTERN =
  /^[0-9a-f]{48}$/i;

// #endregion


// #region Internal Helpers

function normalizeOrigin(value) {
  if (!value) {
    return "";
  }

  try {
    const url =
      new URL(value);

    if (
      url.protocol !== "http:"
      && url.protocol !== "https:"
    ) {
      return "";
    }

    return url.origin;
  } catch {
    return "";
  }
}

// #endregion


// #region Bootstrap Parsing

/**
 * Parse the bootstrap contract supplied by the Foundry relay controller.
 */
export function readBootstrap({
  location = globalThis.location
} = {}) {
  const params =
    new URLSearchParams(
      location?.search ?? ""
    );

  const nonce =
    String(
      params.get(
        BOOTSTRAP_QUERY_KEYS.NONCE
      )
      ?? ""
    ).trim();

  const rawProtocol =
    params.get(
      BOOTSTRAP_QUERY_KEYS.PROTOCOL
    );

  const protocol =
    Number(rawProtocol);

  const rawOpenerOrigin =
    String(
      params.get(
        BOOTSTRAP_QUERY_KEYS.OPENER_ORIGIN
      )
      ?? ""
    ).trim();

  const openerOrigin =
    normalizeOrigin(
      rawOpenerOrigin
    );

  const errors = [];

  if (!nonce) {
    errors.push({
      code: "bootstrap-missing-nonce",
      message:
        "The Foundry relay session nonce is missing."
    });
  } else if (
    !NONCE_PATTERN.test(nonce)
  ) {
    errors.push({
      code: "bootstrap-invalid-nonce",
      message:
        "The Foundry relay session nonce is malformed."
    });
  }

  if (
    rawProtocol === null
    || rawProtocol === ""
  ) {
    errors.push({
      code: "bootstrap-missing-protocol",
      message:
        "The Foundry protocol version is missing."
    });
  } else if (
    !Number.isInteger(protocol)
  ) {
    errors.push({
      code: "bootstrap-invalid-protocol",
      message:
        "The Foundry protocol version is malformed."
    });
  } else if (
    protocol !== PROTOCOL_VERSION
  ) {
    errors.push({
      code: "bootstrap-protocol-mismatch",
      message:
        `Foundry requested protocol ${protocol}; relay supports ${PROTOCOL_VERSION}.`
    });
  }

  if (!rawOpenerOrigin) {
    errors.push({
      code: "bootstrap-missing-opener-origin",
      message:
        "The Foundry opener origin is missing."
    });
  } else if (!openerOrigin) {
    errors.push({
      code: "bootstrap-invalid-opener-origin",
      message:
        "The Foundry opener origin is invalid."
    });
  }

  return {
    valid:
      errors.length === 0,

    nonce,
    protocol,
    openerOrigin,
    errors
  };
}

// #endregion
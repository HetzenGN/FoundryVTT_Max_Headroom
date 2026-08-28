// relay/src/transport.js

// #region Transport Factory

/**
 * Create the StreamKit -> Foundry opener transport.
 *
 * This deliberately uses a strict targetOrigin.
 */
export function createOpenerTransport({
  targetOrigin,
  opener = globalThis.opener
} = {}) {
  let sentCount = 0;
  let failureCount = 0;
  let lastError = null;

  // #region Internal Helpers

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


  function recordFailure(
    code,
    message
  ) {
    failureCount += 1;

    lastError = {
      code,
      message,
      timestamp:
        Date.now()
    };
  }

  // #endregion


  // #region Sending

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
        error instanceof Error
          ? error.message
          : String(error)
      );

      return false;
    }
  }

  // #endregion


  // #region Diagnostics

  function getState() {
    return {
      openerAvailable:
        Boolean(opener),

      openerClosed:
        isOpenerClosed(),

      targetOrigin,

      sentCount,
      failureCount,

      lastError:
        lastError
          ? { ...lastError }
          : null
    };
  }

  // #endregion


  return Object.freeze({
    send,
    getState
  });
}

// #endregion
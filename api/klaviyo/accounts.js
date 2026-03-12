const { listKlaviyoAccounts } = require("../_lib/klaviyo");
const { handlePreflight, requireProxySecret, sendError, sendJson } = require("../_lib/http");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) {
    return;
  }
  if (requireProxySecret(req, res, { allowQuerySecret: true })) {
    return;
  }

  if (req.method !== "GET") {
    sendError(res, 405, "Method not allowed");
    return;
  }

  try {
    const accounts = listKlaviyoAccounts();
    if (!accounts.length) {
      sendError(res, 500, "Missing configuration: KLAVIYO_PRIVATE_API_KEY");
      return;
    }

    sendJson(res, 200, {
      ok: true,
      accounts
    });
  } catch (error) {
    sendError(res, 400, error.message || "Failed to list Klaviyo accounts.");
  }
};

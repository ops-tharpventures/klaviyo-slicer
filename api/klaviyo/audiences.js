const { KlaviyoHttpError, listAudiences } = require("../_lib/klaviyo");
const { handlePreflight, headerValue, queryValue, requireProxySecret, sendError, sendJson } = require("../_lib/http");

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
    const keyId = headerValue(req, "x-klaviyo-account").trim()
      || queryValue(req, "klaviyo_account").trim()
      || queryValue(req, "klaviyoAccount").trim();
    const result = await listAudiences({ accessToken: null, keyId: keyId || null });
    sendJson(res, 200, {
      ok: true,
      audiences: result.audiences,
      lists: result.lists,
      segments: result.segments,
      warnings: result.warnings
    });
  } catch (error) {
    if (error instanceof KlaviyoHttpError) {
      sendError(res, error.status || 502, "Klaviyo API request failed", error.responseBody);
      return;
    }

    sendError(res, 400, error.message || "Failed to load audiences");
  }
};

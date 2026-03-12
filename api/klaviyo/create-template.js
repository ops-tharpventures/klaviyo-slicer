const { KlaviyoHttpError, createTemplate } = require("../_lib/klaviyo");
const { handlePreflight, headerValue, readJsonBody, requireProxySecret, sendError, sendJson } = require("../_lib/http");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) {
    return;
  }
  if (requireProxySecret(req, res)) {
    return;
  }

  if (req.method !== "POST") {
    sendError(res, 405, "Method not allowed");
    return;
  }

  try {
    const body = await readJsonBody(req);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const html = typeof body.html === "string" ? body.html : "";
    const text = typeof body.text === "string" ? body.text : "";
    const accessToken = typeof body.accessToken === "string" && body.accessToken.trim() ? body.accessToken.trim() : null;
    const keyId = headerValue(req, "x-klaviyo-account").trim() || null;

    if (!name) {
      sendError(res, 400, "Required field: name");
      return;
    }

    if (!html) {
      sendError(res, 400, "Required field: html");
      return;
    }

    const response = await createTemplate({ name, html, text, accessToken, keyId });

    sendJson(res, 200, {
      ok: true,
      template: response
    });
  } catch (error) {
    if (error instanceof KlaviyoHttpError) {
      sendError(res, error.status || 502, "Klaviyo API request failed", error.responseBody);
      return;
    }

    sendError(res, 400, error.message || "Failed to create template");
  }
};

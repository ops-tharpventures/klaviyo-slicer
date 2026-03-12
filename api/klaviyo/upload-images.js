const { KlaviyoHttpError, uploadImageFromBase64 } = require("../_lib/klaviyo");
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
    const images = Array.isArray(body.images) ? body.images : [];
    const accessToken = typeof body.accessToken === "string" && body.accessToken.trim() ? body.accessToken.trim() : null;
    const keyId = headerValue(req, "x-klaviyo-account").trim() || null;

    if (!images.length) {
      sendError(res, 400, "Send images[] with base64 data.");
      return;
    }

    const uploaded = [];
    for (let i = 0; i < images.length; i += 1) {
      const image = images[i] || {};
      if (typeof image.base64 !== "string" || !image.base64.trim()) {
        sendError(res, 400, `images[${i}].base64 is required.`);
        return;
      }

      const response = await uploadImageFromBase64({
        base64: image.base64,
        contentType: typeof image.contentType === "string" ? image.contentType : "image/png",
        accessToken,
        keyId
      });

      uploaded.push({
        index: i,
        id: response.id,
        url: response.url,
        raw: response.raw
      });
    }

    sendJson(res, 200, {
      ok: true,
      uploaded
    });
  } catch (error) {
    if (error instanceof KlaviyoHttpError) {
      sendError(res, error.status || 502, "Klaviyo API request failed", error.responseBody);
      return;
    }

    sendError(res, 400, error.message || "Image upload failed.");
  }
};

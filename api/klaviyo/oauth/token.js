const { handlePreflight, readJsonBody, requireProxySecret, sendError, sendJson } = require("../../_lib/http");

function basicAuth(clientId, clientSecret) {
  return Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
}

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
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const codeVerifier = typeof body.codeVerifier === "string" ? body.codeVerifier.trim() : "";
    const redirectUri = typeof body.redirectUri === "string" && body.redirectUri.trim()
      ? body.redirectUri.trim()
      : process.env.KLAVIYO_REDIRECT_URI;

    const clientId = process.env.KLAVIYO_CLIENT_ID;
    const clientSecret = process.env.KLAVIYO_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      sendError(res, 500, "Missing configuration: KLAVIYO_CLIENT_ID and/or KLAVIYO_CLIENT_SECRET");
      return;
    }

    if (!code) {
      sendError(res, 400, "Required field: code");
      return;
    }

    if (!redirectUri) {
      sendError(res, 400, "Required field: redirectUri (or KLAVIYO_REDIRECT_URI)");
      return;
    }

    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri
    });

    if (codeVerifier) {
      params.set("code_verifier", codeVerifier);
    }

    const response = await fetch("https://a.klaviyo.com/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    const raw = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }

    if (!response.ok) {
      sendError(res, response.status, "Klaviyo OAuth token exchange failed", parsed);
      return;
    }

    sendJson(res, 200, {
      ok: true,
      token: parsed
    });
  } catch (error) {
    sendError(res, 400, error.message || "OAuth token exchange failed");
  }
};

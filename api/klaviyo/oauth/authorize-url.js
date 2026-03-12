const { handlePreflight, requireProxySecret, sendError, sendJson } = require("../../_lib/http");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) {
    return;
  }
  if (requireProxySecret(req, res)) {
    return;
  }

  if (req.method !== "GET") {
    sendError(res, 405, "Method not allowed");
    return;
  }

  const clientId = process.env.KLAVIYO_CLIENT_ID;
  const defaultRedirectUri = process.env.KLAVIYO_REDIRECT_URI;
  const defaultScopes = process.env.KLAVIYO_SCOPES || "accounts:read templates:write images:write";

  if (!clientId) {
    sendError(res, 500, "Missing configuration: KLAVIYO_CLIENT_ID");
    return;
  }

  const redirectUri = typeof req.query.redirectUri === "string" ? req.query.redirectUri : defaultRedirectUri;
  if (!redirectUri) {
    sendError(res, 400, "Set redirectUri (query) or KLAVIYO_REDIRECT_URI");
    return;
  }

  const scope = typeof req.query.scope === "string" && req.query.scope.trim() ? req.query.scope.trim() : defaultScopes;
  const state = typeof req.query.state === "string" && req.query.state.trim() ? req.query.state.trim() : "figma-klaviyo-state";
  const codeChallenge = typeof req.query.codeChallenge === "string" ? req.query.codeChallenge.trim() : "";
  const codeChallengeMethod = typeof req.query.codeChallengeMethod === "string" ? req.query.codeChallengeMethod.trim() : "S256";

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state
  });

  if (codeChallenge) {
    params.set("code_challenge", codeChallenge);
    params.set("code_challenge_method", codeChallengeMethod);
  }

  sendJson(res, 200, {
    ok: true,
    authorizeUrl: `https://www.klaviyo.com/oauth/authorize?${params.toString()}`
  });
};

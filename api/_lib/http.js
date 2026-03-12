const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-proxy-secret, x-klaviyo-account"
};

function setCors(res) {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }
}

function handlePreflight(req, res) {
  if (req.method !== "OPTIONS") {
    return false;
  }
  setCors(res);
  res.status(204).end();
  return true;
}

function sendJson(res, status, payload) {
  setCors(res);
  res.status(status).json(payload);
}

function sendError(res, status, error, details) {
  sendJson(res, status, {
    error,
    details: details || null
  });
}

function headerValue(req, key) {
  const headers = req && req.headers && typeof req.headers === "object" ? req.headers : {};
  const value = headers[key.toLowerCase()];
  if (Array.isArray(value)) {
    return String(value[0] || "");
  }
  return typeof value === "string" ? value : "";
}

function queryValue(req, key) {
  const query = req && req.query && typeof req.query === "object" ? req.query : null;
  if (query && Object.prototype.hasOwnProperty.call(query, key)) {
    const value = query[key];
    if (Array.isArray(value)) {
      return String(value[0] || "");
    }
    return typeof value === "string" ? value : value == null ? "" : String(value);
  }

  const rawUrl = req && typeof req.url === "string" ? req.url : "";
  if (!rawUrl) {
    return "";
  }

  try {
    const parsed = new URL(rawUrl, "http://localhost");
    const value = parsed.searchParams.get(key);
    return value ? String(value) : "";
  } catch {
    return "";
  }
}

function requireProxySecret(req, res, options) {
  const opts = options && typeof options === "object" ? options : {};
  const expected = String(process.env.PROXY_SHARED_SECRET || "").trim();
  if (!expected) {
    sendError(res, 500, "Missing configuration: PROXY_SHARED_SECRET");
    return true;
  }

  let provided = headerValue(req, "x-proxy-secret").trim();
  if (!provided && opts.allowQuerySecret) {
    provided = queryValue(req, "x-proxy-secret").trim()
      || queryValue(req, "proxy_secret").trim()
      || queryValue(req, "proxySecret").trim();
  }

  if (!provided || provided !== expected) {
    sendError(res, 401, "Unauthorized");
    return true;
  }

  return false;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (typeof req.body === "string") {
    return req.body ? JSON.parse(req.body) : {};
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

module.exports = {
  headerValue,
  handlePreflight,
  queryValue,
  readJsonBody,
  requireProxySecret,
  sendError,
  sendJson,
  setCors
};

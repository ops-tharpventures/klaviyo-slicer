const { handlePreflight, sendError, sendJson } = require("./_lib/http");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) {
    return;
  }

  if (req.method !== "GET") {
    sendError(res, 405, "Method not allowed");
    return;
  }

  sendJson(res, 200, {
    ok: true,
    service: "figma-to-klaviyo-api",
    timestamp: new Date().toISOString()
  });
};

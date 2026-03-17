figma.showUI(__html__, { width: 520, height: 780, themeColors: true });

const DEFAULT_EXPORT_SCALE = 2;
const DEFAULT_BUTTON_MARGIN = 12;
const DEFAULT_BUTTON_KEYWORDS = ["button", "btn", "cta"];
const DEFAULT_KLAVIYO_BASE_URL = "https://a.klaviyo.com";
const DEFAULT_KLAVIYO_REVISION = "2026-01-15";

class KlaviyoRequestError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = "KlaviyoRequestError";
    this.status = status;
    this.details = details;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInt(value, fallback) {
  return Math.round(toNumber(value, fallback));
}

function parseExportScale(value) {
  const normalized = toNumber(value, DEFAULT_EXPORT_SCALE);
  const rounded = Math.round(normalized * 100) / 100;
  return clamp(rounded, 0.25, 4);
}

function sanitizeFilenamePart(input) {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "design";
}

function hasBounds(node) {
  return Boolean(node && "absoluteBoundingBox" in node && node.absoluteBoundingBox);
}

function normalizeLayerName(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/_/g, " ");
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseButtonKeywords(input) {
  const source = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[,\n;]/)
      : [];

  const normalized = source
    .map((item) => normalizeLayerName(item).replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const unique = [];
  const seen = new Set();
  for (const keyword of normalized) {
    if (!seen.has(keyword)) {
      seen.add(keyword);
      unique.push(keyword);
    }
  }

  return unique.length ? unique : DEFAULT_BUTTON_KEYWORDS.slice();
}

function parseIgnoreSectionTokens(input) {
  const source = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[,\n;]/)
      : [];

  const normalized = source
    .map((item) => normalizeLayerName(item).replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const unique = [];
  const seen = new Set();
  for (const token of normalized) {
    if (!seen.has(token)) {
      seen.add(token);
      unique.push(token);
    }
  }

  return unique;
}

function matchTokenInLayerName(name, tokens) {
  const normalizedName = normalizeLayerName(name);
  for (const token of tokens) {
    if (normalizedName.includes(token)) {
      return token;
    }
  }
  return "";
}

function isButtonName(name, keywords) {
  const normalizedName = normalizeLayerName(name);
  for (const keyword of keywords) {
    if (normalizedName.includes(keyword)) {
      return true;
    }
  }
  return false;
}

function parseButtonMargins(name, defaults, keywords) {
  const resolved = {
    top: clamp(toInt(defaults.top, DEFAULT_BUTTON_MARGIN), 0, 10000),
    bottom: clamp(toInt(defaults.bottom, DEFAULT_BUTTON_MARGIN), 0, 10000)
  };

  const normalizedName = normalizeLayerName(name);

  const pairPattern = /\b(mt|mb|m)\s*(?:=|:)?\s*(-?\d+(?:\.\d+)?)\b/g;
  let pairMatch = pairPattern.exec(normalizedName);
  let foundPair = false;
  while (pairMatch) {
    foundPair = true;
    const key = pairMatch[1];
    const value = clamp(toInt(pairMatch[2], 0), 0, 10000);
    if (key === "m") {
      resolved.top = value;
      resolved.bottom = value;
    }
    if (key === "mt") {
      resolved.top = value;
    }
    if (key === "mb") {
      resolved.bottom = value;
    }
    pairMatch = pairPattern.exec(normalizedName);
  }

  if (!foundPair) {
    // Only default aliases support implicit "token + number" margins (e.g. "button 24").
    // For custom tokens, use explicit markers: m=, mt=, mb=, or UI override fields.
    const implicitMarginTokenPattern = DEFAULT_BUTTON_KEYWORDS
      .map((keyword) => normalizeLayerName(keyword))
      .map((keyword) => escapeRegex(keyword))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .join("|");

    const single = implicitMarginTokenPattern
      ? normalizedName.match(new RegExp(`(?:${implicitMarginTokenPattern})\\s+(-?\\d+(?:\\.\\d+)?)\\b`, "i"))
      : null;

    if (single) {
      const value = clamp(toInt(single[1], DEFAULT_BUTTON_MARGIN), 0, 10000);
      resolved.top = value;
      resolved.bottom = value;
    }
  }

  return resolved;
}

function parseStringList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[,\n;]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toPathFromUrl(input) {
  if (!input || typeof input !== "string") {
    return "";
  }
  try {
    const parsed = new URL(input);
    return `${parsed.pathname}${parsed.search || ""}`;
  } catch (error) {
    return input;
  }
}

function getKlaviyoConfig(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const apiKey = String(source.apiKey || "").trim();
  if (!apiKey) {
    throw new Error("Klaviyo API Key is required.");
  }

  const baseUrlRaw = String(source.baseUrl || DEFAULT_KLAVIYO_BASE_URL).trim();
  const baseUrl = baseUrlRaw.replace(/\/+$/, "");
  const revision = String(source.revision || DEFAULT_KLAVIYO_REVISION).trim() || DEFAULT_KLAVIYO_REVISION;

  return {
    apiKey,
    baseUrl,
    revision
  };
}

async function parseKlaviyoResponse(response) {
  const raw = await response.text();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    return raw;
  }
}

function klaviyoErrorMessage(error) {
  if (!error) {
    return "Unexpected Klaviyo error.";
  }

  if (error instanceof KlaviyoRequestError) {
    if (error.details) {
      const detailText = typeof error.details === "string"
        ? error.details
        : JSON.stringify(error.details);
      return `${error.message} ${detailText}`;
    }
    return error.message;
  }

  return error.message || "Unexpected Klaviyo error.";
}

async function klaviyoRequest(config, request) {
  const req = request && typeof request === "object" ? request : {};
  const method = req.method || "GET";
  const path = String(req.path || "");
  if (!path) {
    throw new Error("Klaviyo request path is required.");
  }

  const headers = {
    Authorization: `Klaviyo-API-Key ${config.apiKey}`,
    revision: config.revision,
    "Content-Type": "application/json"
  };
  if (req.headers && typeof req.headers === "object") {
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key] = value;
    }
  }

  const url = `${config.baseUrl}${path}`;
  const response = await fetch(url, {
    method,
    headers,
    body: req.body ? JSON.stringify(req.body) : undefined
  });

  const parsed = await parseKlaviyoResponse(response);
  if (!response.ok) {
    throw new KlaviyoRequestError(
      `Klaviyo responded ${response.status} on ${path}`,
      response.status,
      parsed
    );
  }

  return parsed;
}

async function listResourcePages(config, path, maxPages) {
  const items = [];
  const limit = clamp(toInt(maxPages, 20), 1, 200);
  let nextPath = path;
  let pageCount = 0;

  while (nextPath && pageCount < limit) {
    const payload = await klaviyoRequest(config, {
      path: nextPath,
      method: "GET"
    });

    const pageItems = Array.isArray(payload && payload.data) ? payload.data : [];
    for (const item of pageItems) {
      items.push(item);
    }

    const rawNext = payload && payload.links ? payload.links.next : null;
    nextPath = rawNext ? toPathFromUrl(rawNext) : "";
    pageCount += 1;
  }

  return {
    items,
    hasMore: Boolean(nextPath)
  };
}

function mapAudience(resource, fallbackType) {
  const item = resource && typeof resource === "object" ? resource : {};
  const attributes = item.attributes && typeof item.attributes === "object" ? item.attributes : {};
  const id = item.id ? String(item.id) : "";
  if (!id) {
    return null;
  }

  const type = item.type ? String(item.type) : fallbackType;
  const name = typeof attributes.name === "string" && attributes.name.trim()
    ? attributes.name.trim()
    : `${fallbackType} ${id}`;

  return { id, type, name };
}

async function listKlaviyoAudiences(config) {
  const warnings = [];

  const listPages = await listResourcePages(config, "/api/lists?page[size]=10", 20);
  const lists = listPages.items.map((item) => mapAudience(item, "list")).filter(Boolean);
  if (listPages.hasMore) {
    warnings.push("List results were truncated at 20 pages.");
  }

  let segments = [];
  try {
    const segmentPages = await listResourcePages(config, "/api/segments?page[size]=10", 20);
    segments = segmentPages.items.map((item) => mapAudience(item, "segment")).filter(Boolean);
    if (segmentPages.hasMore) {
      warnings.push("Segment results were truncated at 20 pages.");
    }
  } catch (error) {
    if (error instanceof KlaviyoRequestError) {
      warnings.push(`Segments unavailable (${error.status}). Enable scope 'segments:read' if needed.`);
    } else {
      warnings.push("Segments unavailable.");
    }
  }

  const audiences = lists.concat(segments).sort((a, b) => {
    if (a.type !== b.type) {
      return String(a.type).localeCompare(String(b.type));
    }
    return String(a.name).localeCompare(String(b.name));
  });

  return {
    lists,
    segments,
    audiences,
    warnings
  };
}

async function uploadImageFromBase64(config, image) {
  const item = image && typeof image === "object" ? image : {};
  const base64 = String(item.base64 || "").trim();
  if (!base64) {
    throw new Error("Image base64 is required.");
  }
  const contentType = String(item.contentType || "image/png").trim() || "image/png";
  const src = `data:${contentType};base64,${base64}`;

  const payload = await klaviyoRequest(config, {
    path: "/api/images",
    method: "POST",
    body: {
      data: {
        type: "image",
        attributes: { src }
      }
    }
  });

  const data = payload && payload.data ? payload.data : {};
  const attrs = data.attributes && typeof data.attributes === "object" ? data.attributes : {};
  const url = typeof attrs.src === "string" ? attrs.src : (typeof attrs.url === "string" ? attrs.url : "");

  return {
    id: data.id ? String(data.id) : "",
    url
  };
}

function normalizeImageEntries(entries) {
  const source = Array.isArray(entries) ? entries : [];
  const normalized = [];

  for (const entry of source) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const url = String(entry.url || "").trim();
    if (!url) {
      continue;
    }

    normalized.push({
      url,
      link: String(entry.link || "").trim(),
      alt: String(entry.alt || "").trim()
    });
  }

  return normalized;
}

function buildEmailHtmlFromImages(entries, options) {
  const opts = options && typeof options === "object" ? options : {};
  const background = typeof opts.backgroundColor === "string" && opts.backgroundColor.trim() ? opts.backgroundColor.trim() : "#ffffff";
  const spacing = Number.isFinite(opts.spacing) ? Math.max(0, opts.spacing) : 0;
  const maxWidth = Number.isFinite(opts.maxWidth) ? Math.max(320, opts.maxWidth) : 600;
  const images = normalizeImageEntries(entries);

  const rows = images.map((image, index) => {
    const topPadding = index === 0 ? 0 : spacing;
    const imageTag = `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}" width="${maxWidth}" style="display:block;width:100%;max-width:${maxWidth}px;height:auto;border:0;outline:none;text-decoration:none;" />`;
    const content = image.link
      ? `<a href="${escapeHtml(image.link)}" target="_blank" style="display:block;text-decoration:none;">${imageTag}</a>`
      : imageTag;
    return `
        <tr>
          <td style="padding:${topPadding}px 0 0 0;">
            ${content}
          </td>
        </tr>
      `;
  }).join("\n");

  return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Email</title>
  </head>
  <body style="margin:0;padding:0;background:${escapeHtml(background)};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${escapeHtml(background)};">
      <tr>
        <td align="center" style="padding:0;">
          <table role="presentation" width="${maxWidth}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${maxWidth}px;margin:0 auto;">
            ${rows}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`.trim();
}

async function createKlaviyoTemplate(config, name, html) {
  const templateName = String(name || "").trim();
  if (!templateName) {
    throw new Error("Template name is required.");
  }
  if (!String(html || "").trim()) {
    throw new Error("Template HTML is required.");
  }

  return klaviyoRequest(config, {
    path: "/api/templates",
    method: "POST",
    body: {
      data: {
        type: "template",
        attributes: {
          name: templateName,
          editor_type: "CODE",
          html,
          text: ""
        }
      }
    }
  });
}

async function createKlaviyoCampaignDraft(config, campaign) {
  const data = campaign && typeof campaign === "object" ? campaign : {};
  const name = String(data.name || "").trim();
  const subject = String(data.subject || "").trim();
  const fromEmail = String(data.fromEmail || "").trim();
  const fromLabel = String(data.fromLabel || "").trim();
  const previewText = String(data.previewText || "").trim();
  const replyToEmail = String(data.replyToEmail || "").trim();
  const includedAudienceIds = parseStringList(data.includedAudienceIds);
  const excludedAudienceIds = parseStringList(data.excludedAudienceIds);

  if (!name) {
    throw new Error("Campaign name is required.");
  }
  if (!includedAudienceIds.length) {
    throw new Error("Add at least one Included Audience ID.");
  }
  if (!subject) {
    throw new Error("Campaign subject is required.");
  }
  if (!fromEmail) {
    throw new Error("Campaign from email is required.");
  }
  if (!fromLabel) {
    throw new Error("Campaign from name is required.");
  }

  return klaviyoRequest(config, {
    path: "/api/campaigns",
    method: "POST",
    body: {
      data: {
        type: "campaign",
        attributes: {
          name,
          audiences: {
            included: includedAudienceIds,
            excluded: excludedAudienceIds
          },
          send_strategy: { method: "immediate" },
          send_options: {
            use_smart_sending: false,
            ignore_unsubscribes: false
          },
          tracking_options: {
            is_tracking_opens: true,
            is_tracking_clicks: true
          },
          "campaign-messages": {
            data: [
              {
                type: "campaign-message",
                attributes: {
                  channel: "email",
                  content: {
                    subject,
                    preview_text: previewText,
                    from_email: fromEmail,
                    from_label: fromLabel,
                    reply_to_email: replyToEmail || fromEmail
                  }
                }
              }
            ]
          }
        }
      }
    }
  });
}

function extractCampaignMessageId(campaignResponse) {
  const payload = campaignResponse && typeof campaignResponse === "object" ? campaignResponse : {};
  const relationships = payload.data && payload.data.relationships ? payload.data.relationships : null;

  if (
    relationships &&
    relationships["campaign-messages"] &&
    Array.isArray(relationships["campaign-messages"].data) &&
    relationships["campaign-messages"].data[0] &&
    relationships["campaign-messages"].data[0].id
  ) {
    return String(relationships["campaign-messages"].data[0].id);
  }

  const included = Array.isArray(payload.included) ? payload.included : [];
  const campaignMessage = included.find((item) => item && item.type === "campaign-message" && item.id);
  return campaignMessage ? String(campaignMessage.id) : "";
}

async function assignTemplateToCampaignMessage(config, campaignMessageId, templateId) {
  const messageId = String(campaignMessageId || "").trim();
  const tplId = String(templateId || "").trim();
  if (!messageId || !tplId) {
    throw new Error("Campaign message ID and template ID are required to assign template.");
  }

  const attempts = [
    {
      data: {
        type: "campaign-message",
        id: messageId,
        relationships: {
          template: {
            data: {
              type: "template",
              id: tplId
            }
          }
        }
      }
    },
    {
      data: {
        type: "campaign-message-template",
        attributes: {
          campaign_message_id: messageId,
          template_id: tplId
        }
      }
    },
    {
      data: {
        type: "campaign-message-template",
        relationships: {
          "campaign-message": {
            data: {
              type: "campaign-message",
              id: messageId
            }
          },
          template: {
            data: {
              type: "template",
              id: tplId
            }
          }
        }
      }
    }
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return await klaviyoRequest(config, {
        path: "/api/campaign-message-assign-template",
        method: "POST",
        body: attempt
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Failed to assign template to campaign message.");
}

async function sendCutsToKlaviyo(payload, onProgress) {
  const source = payload && typeof payload === "object" ? payload : {};
  const config = getKlaviyoConfig(source);
  const notify = typeof onProgress === "function" ? onProgress : () => {};
  const templateName = String(source.templateName || "").trim();
  if (!templateName) {
    throw new Error("Template name is required.");
  }

  const images = Array.isArray(source.images) ? source.images : [];
  if (!images.length) {
    throw new Error("No images were provided.");
  }

  notify(`Uploading ${images.length} images to Klaviyo...`);

  const uploaded = [];
  for (let i = 0; i < images.length; i += 1) {
    const image = images[i];
    const upload = await uploadImageFromBase64(config, image);
    if (!upload.url) {
      throw new Error(`Image ${i + 1} uploaded but no URL was returned by Klaviyo.`);
    }
    uploaded.push({
      id: upload.id,
      url: upload.url,
      filename: String(image && image.filename ? image.filename : `cut-${i + 1}.png`),
      link: String(image && image.link ? image.link : "").trim(),
      alt: String(image && image.alt ? image.alt : "").trim()
    });
  }

  notify("Building email HTML and creating template...");

  const maxWidth = Number.isFinite(source.maxWidth) ? source.maxWidth : 600;
  const spacing = Number.isFinite(source.spacing) ? source.spacing : 0;
  const backgroundColor = typeof source.backgroundColor === "string" ? source.backgroundColor : "#ffffff";

  const html = buildEmailHtmlFromImages(uploaded, { maxWidth, spacing, backgroundColor });
  const templateResponse = await createKlaviyoTemplate(config, templateName, html);
  const templateId = templateResponse && templateResponse.data ? String(templateResponse.data.id || "") : "";
  if (!templateId) {
    throw new Error("Template was created but no template ID was returned.");
  }

  let campaignResult = null;
  const createDraftCampaign = source.createDraftCampaign !== false;
  if (createDraftCampaign) {
    notify("Creating draft campaign...");
    const campaignInput = source.campaign && typeof source.campaign === "object"
      ? source.campaign
      : { name: `${templateName} Campaign` };
    const campaignResponse = await createKlaviyoCampaignDraft(config, campaignInput);
    const campaignId = campaignResponse && campaignResponse.data ? String(campaignResponse.data.id || "") : "";
    if (!campaignId) {
      throw new Error("Campaign was created but no campaign ID was returned.");
    }

    const campaignMessageId = extractCampaignMessageId(campaignResponse);
    if (!campaignMessageId) {
      throw new Error("Campaign message ID was not found in campaign response.");
    }

    notify("Assigning template to campaign message...");
    const assignResponse = await assignTemplateToCampaignMessage(config, campaignMessageId, templateId);
    campaignResult = {
      id: campaignId,
      messageId: campaignMessageId,
      templateAssigned: true,
      raw: campaignResponse,
      assignRaw: assignResponse
    };
  }

  return {
    template: {
      id: templateId,
      raw: templateResponse
    },
    campaign: campaignResult,
    uploadedImages: uploaded,
    html
  };
}

function listTopLevelNodes() {
  const out = [];
  for (const page of figma.root.children) {
    for (const child of page.children) {
      if (typeof child.exportAsync !== "function" || !hasBounds(child)) {
        continue;
      }
      const bounds = hasBounds(child) ? child.absoluteBoundingBox : null;
      const width = bounds ? Math.round(bounds.width) : null;
      const height = bounds ? Math.round(bounds.height) : null;
      out.push({
        id: child.id,
        pageId: page.id,
        pageName: page.name,
        nodeName: child.name,
        type: child.type,
        width,
        height,
        label: `${page.name} / ${child.name}`
      });
    }
  }
  return out;
}

function getNodeForAction(nodeId) {
  const node = nodeId ? figma.getNodeById(nodeId) : null;
  if (!node) {
    throw new Error("Node not found. Refresh and try again.");
  }

  if (!node.visible) {
    throw new Error("The selected node is hidden.");
  }

  if (!hasBounds(node)) {
    throw new Error("The selected node does not have valid bounds.");
  }

  return node;
}

function resolveOverrideMargins(overrides, nodeId) {
  const override = overrides && typeof overrides === "object" ? overrides[nodeId] : null;
  if (!override || typeof override !== "object") {
    return null;
  }

  const topSource = override.marginTop !== undefined ? override.marginTop : override.top;
  const bottomSource = override.marginBottom !== undefined ? override.marginBottom : override.bottom;

  return {
    top: topSource,
    bottom: bottomSource
  };
}

function collectButtons(rootNode, options) {
  if (!hasBounds(rootNode)) {
    return [];
  }

  const opts = options && typeof options === "object" ? options : {};
  const defaults = {
    top: clamp(toInt(opts.defaultTop, DEFAULT_BUTTON_MARGIN), 0, 10000),
    bottom: clamp(toInt(opts.defaultBottom, DEFAULT_BUTTON_MARGIN), 0, 10000)
  };
  const keywords = parseButtonKeywords(opts.buttonKeywords);
  const marginOverrides = opts.marginOverrides && typeof opts.marginOverrides === "object" ? opts.marginOverrides : {};

  const rootBounds = rootNode.absoluteBoundingBox;
  const stack = [rootNode];
  const buttons = [];

  while (stack.length) {
    const node = stack.pop();
    if (!node || !node.visible) {
      continue;
    }

    if (node !== rootNode && isButtonName(node.name, keywords) && hasBounds(node)) {
      const bounds = node.absoluteBoundingBox;
      const margins = parseButtonMargins(node.name, defaults, keywords);
      const override = resolveOverrideMargins(marginOverrides, node.id);
      if (override) {
        if (override.top !== undefined) {
          margins.top = clamp(toInt(override.top, margins.top), 0, 10000);
        }
        if (override.bottom !== undefined) {
          margins.bottom = clamp(toInt(override.bottom, margins.bottom), 0, 10000);
        }
      }
      buttons.push({
        id: node.id,
        name: node.name,
        x: bounds.x - rootBounds.x,
        y: bounds.y - rootBounds.y,
        width: bounds.width,
        height: bounds.height,
        marginTop: margins.top,
        marginBottom: margins.bottom
      });
    }

    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        stack.push(child);
      }
    }
  }

  buttons.sort((a, b) => a.y - b.y);
  return buttons;
}

function collectIgnoredSections(rootNode, options) {
  if (!hasBounds(rootNode)) {
    return [];
  }

  const opts = options && typeof options === "object" ? options : {};
  const tokens = parseIgnoreSectionTokens(opts.tokens || opts.ignoreSectionTokens);
  if (!tokens.length) {
    return [];
  }

  const rootBounds = rootNode.absoluteBoundingBox;
  const stack = [rootNode];
  const sections = [];

  while (stack.length) {
    const node = stack.pop();
    if (!node || !node.visible) {
      continue;
    }

    if (node !== rootNode && hasBounds(node)) {
      const matchedToken = matchTokenInLayerName(node.name, tokens);
      if (matchedToken) {
        const bounds = node.absoluteBoundingBox;
        sections.push({
          id: node.id,
          name: node.name,
          matchedToken,
          y: bounds.y - rootBounds.y,
          height: bounds.height
        });
      }
    }

    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        stack.push(child);
      }
    }
  }

  sections.sort((a, b) => a.y - b.y);
  return sections;
}

function splitRange(top, bottom, maxHeight) {
  const slices = [];
  if (bottom <= top) {
    return slices;
  }

  const safeMaxHeight = maxHeight > 0 ? maxHeight : bottom - top;
  let cursor = top;
  while (cursor < bottom) {
    const next = Math.min(bottom, cursor + safeMaxHeight);
    slices.push({ top: cursor, bottom: next });
    cursor = next;
  }
  return slices;
}

function mergeProtectedZones(rawZones, imageHeight) {
  const clamped = rawZones
    .map((slice) => ({
      top: clamp(Math.floor(slice.top), 0, imageHeight),
      bottom: clamp(Math.ceil(slice.bottom), 0, imageHeight)
    }))
    .filter((slice) => slice.bottom > slice.top)
    .sort((a, b) => a.top - b.top);

  if (!clamped.length) {
    return [];
  }

  const merged = [];
  for (const current of clamped) {
    const last = merged[merged.length - 1];
    if (!last || current.top > last.bottom) {
      merged.push({
        top: current.top,
        bottom: current.bottom
      });
      continue;
    }
    last.bottom = Math.max(last.bottom, current.bottom);
  }

  return merged;
}

function computeSlices(buttons, imageHeight, settings) {
  const maxHeight = clamp(toInt(settings.maxHeight, 1400), 1, 100000);
  const exportScale = parseExportScale(settings.exportScale);

  const zones = mergeProtectedZones(
    buttons.map((button) => {
      const top = (button.y - button.marginTop) * exportScale;
      const bottom = (button.y + button.height + button.marginBottom) * exportScale;
      return { top, bottom };
    }),
    imageHeight
  );

  if (!zones.length) {
    return splitRange(0, imageHeight, maxHeight);
  }

  const slices = [];
  let cursor = 0;

  for (const zone of zones) {
    if (zone.top > cursor) {
      const gapSlices = splitRange(cursor, zone.top, maxHeight);
      for (const gapSlice of gapSlices) {
        slices.push(gapSlice);
      }
    }

    if (zone.bottom > zone.top) {
      const zoneTop = clamp(zone.top, 0, imageHeight);
      const zoneBottom = clamp(zone.bottom, 0, imageHeight);
      if (zoneBottom > zoneTop) {
        // Button is an exception: create a dedicated slice for button height + margins.
        slices.push({ top: zoneTop, bottom: zoneBottom });
      }
    }

    cursor = Math.max(cursor, zone.bottom);
  }

  if (cursor < imageHeight) {
    const tailSlices = splitRange(cursor, imageHeight, maxHeight);
    for (const tailSlice of tailSlices) {
      slices.push(tailSlice);
    }
  }

  const output = [];
  for (const slice of slices) {
    const top = clamp(Math.floor(slice.top), 0, imageHeight);
    const bottom = clamp(Math.ceil(slice.bottom), 0, imageHeight);
    if (bottom > top) {
      output.push({ top, bottom });
    }
  }

  return output;
}

function excludeZonesFromSlices(slices, rawZones, imageHeight) {
  const sourceSlices = Array.isArray(slices) ? slices : [];
  const zones = mergeProtectedZones(Array.isArray(rawZones) ? rawZones : [], imageHeight);
  if (!sourceSlices.length || !zones.length) {
    return sourceSlices.slice();
  }

  const output = [];
  for (const sourceSlice of sourceSlices) {
    let parts = [{
      top: clamp(Math.floor(sourceSlice.top), 0, imageHeight),
      bottom: clamp(Math.ceil(sourceSlice.bottom), 0, imageHeight)
    }].filter((part) => part.bottom > part.top);

    for (const zone of zones) {
      if (!parts.length) {
        break;
      }

      const nextParts = [];
      for (const part of parts) {
        if (zone.bottom <= part.top || zone.top >= part.bottom) {
          nextParts.push(part);
          continue;
        }

        if (zone.top > part.top) {
          nextParts.push({
            top: part.top,
            bottom: zone.top
          });
        }

        if (zone.bottom < part.bottom) {
          nextParts.push({
            top: zone.bottom,
            bottom: part.bottom
          });
        }
      }

      parts = nextParts
        .map((part) => ({
          top: clamp(Math.floor(part.top), 0, imageHeight),
          bottom: clamp(Math.ceil(part.bottom), 0, imageHeight)
        }))
        .filter((part) => part.bottom > part.top);
    }

    for (const part of parts) {
      output.push(part);
    }
  }

  output.sort((a, b) => {
    if (a.top !== b.top) {
      return a.top - b.top;
    }
    return a.bottom - b.bottom;
  });
  return output;
}

function postNodeList() {
  figma.ui.postMessage({
    type: "nodes:list",
    payload: {
      nodes: listTopLevelNodes()
    }
  });
}

function detectButtons(payload) {
  const nodeId = payload && payload.nodeId;
  const node = getNodeForAction(nodeId);
  const rootBounds = node.absoluteBoundingBox;
  const keywords = parseButtonKeywords(payload && payload.buttonKeywords);
  const buttons = collectButtons(node, {
    defaultTop: DEFAULT_BUTTON_MARGIN,
    defaultBottom: DEFAULT_BUTTON_MARGIN,
    buttonKeywords: keywords
  });

  return {
    root: {
      id: node.id,
      name: node.name,
      slug: sanitizeFilenamePart(node.name),
      width: rootBounds.width,
      height: rootBounds.height
    },
    buttons,
    buttonKeywords: keywords
  };
}

async function runExport(payload) {
  const nodeId = payload && payload.nodeId;
  const node = getNodeForAction(nodeId);

  if (typeof node.exportAsync !== "function") {
    throw new Error("The selected node cannot be exported as an image.");
  }

  const exportScale = parseExportScale(payload && payload.exportScale);
  const maxHeight = clamp(toInt(payload.maxHeight, 1400), 1, 100000);
  const rootBounds = node.absoluteBoundingBox;
  const imageWidth = Math.max(1, Math.round(rootBounds.width * exportScale));
  const imageHeight = Math.max(1, Math.round(rootBounds.height * exportScale));
  const keywords = parseButtonKeywords(payload && payload.buttonKeywords);
  const ignoreSectionsEnabled = Boolean(payload && payload.ignoreSectionsEnabled);
  const ignoreSectionTokens = ignoreSectionsEnabled
    ? parseIgnoreSectionTokens(payload && payload.ignoreSectionTokens)
    : [];

  const buttons = collectButtons(node, {
    defaultTop: DEFAULT_BUTTON_MARGIN,
    defaultBottom: DEFAULT_BUTTON_MARGIN,
    marginOverrides: payload && payload.buttonMargins,
    buttonKeywords: keywords
  });
  const ignoredSections = ignoreSectionsEnabled
    ? collectIgnoredSections(node, { tokens: ignoreSectionTokens })
    : [];
  let slices = computeSlices(buttons, imageHeight, { maxHeight, exportScale });
  if (ignoredSections.length) {
    const ignoredZones = ignoredSections.map((section) => ({
      top: section.y * exportScale,
      bottom: (section.y + section.height) * exportScale
    }));
    slices = excludeZonesFromSlices(slices, ignoredZones, imageHeight);
  }

  const imageBytes = await node.exportAsync({
    format: "PNG",
    constraint: { type: "SCALE", value: exportScale }
  });

  return {
    exportScale,
    defaultButtonMargin: DEFAULT_BUTTON_MARGIN,
    maxHeight,
    root: {
      id: node.id,
      name: node.name,
      slug: sanitizeFilenamePart(node.name),
      width: rootBounds.width,
      height: rootBounds.height,
      imageWidth,
      imageHeight
    },
    buttonKeywords: keywords,
    ignoreSectionsEnabled,
    ignoreSectionTokens,
    ignoredSections,
    buttons,
    slices,
    imageBytes
  };
}

figma.ui.onmessage = async (msg) => {
  try {
    if (!msg || !msg.type) {
      return;
    }

    if (msg.type === "nodes:request") {
      postNodeList();
      return;
    }

    if (msg.type === "buttons:detect") {
      figma.ui.postMessage({
        type: "buttons:result",
        payload: detectButtons(msg.payload || {})
      });
      return;
    }

    if (msg.type === "export:run") {
      figma.ui.postMessage({
        type: "export:progress",
        payload: { message: "Exporting PNG and computing slices..." }
      });

      const data = await runExport(msg.payload || {});
      figma.ui.postMessage({
        type: "export:result",
        payload: data
      });
      return;
    }

    if (msg.type === "klaviyo:audiences:list" || msg.type === "klaviyo:send") {
      throw new Error("Klaviyo direct mode is disabled in this build. Use the Vercel proxy fields in the plugin UI.");
    }

    if (msg.type === "plugin:close") {
      figma.closePlugin();
    }
  } catch (error) {
    figma.ui.postMessage({
      type: "plugin:error",
      payload: {
        message: klaviyoErrorMessage(error)
      }
    });
  }
};

postNodeList();

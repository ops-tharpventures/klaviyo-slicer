const DEFAULT_BASE_URL = process.env.KLAVIYO_BASE_URL || "https://a.klaviyo.com";
const DEFAULT_REVISION = process.env.KLAVIYO_REVISION || "2026-01-15";
const API_KEY_PREFIX = "KLAVIYO_PRIVATE_API_KEY";

class KlaviyoHttpError extends Error {
  constructor(message, status, responseBody) {
    super(message);
    this.name = "KlaviyoHttpError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildAccountLabel(envName) {
  if (envName === API_KEY_PREFIX) {
    return "Default";
  }

  const suffix = envName.slice(API_KEY_PREFIX.length).replace(/^[_-]+/, "").trim();
  if (!suffix) {
    return envName;
  }

  return suffix.replace(/[_-]+/g, " ");
}

function listKlaviyoAccountsWithValues() {
  const entries = Object.entries(process.env || {})
    .filter(([name, value]) => name.startsWith(API_KEY_PREFIX) && typeof value === "string" && value.trim())
    .map(([envName, value]) => ({
      id: envName,
      envName,
      value: value.trim(),
      isDefault: envName === API_KEY_PREFIX,
      label: buildAccountLabel(envName)
    }));

  entries.sort((a, b) => {
    if (a.isDefault !== b.isDefault) {
      return a.isDefault ? -1 : 1;
    }
    return a.label.localeCompare(b.label);
  });

  return entries;
}

function listKlaviyoAccounts() {
  return listKlaviyoAccountsWithValues().map((item) => ({
    id: item.id,
    envName: item.envName,
    label: item.label,
    isDefault: item.isDefault
  }));
}

function resolveAuthorization(accessToken, keyId) {
  if (accessToken) {
    return `Bearer ${accessToken}`;
  }

  const configured = listKlaviyoAccountsWithValues();
  if (!configured.length) {
    throw new Error("Missing configuration: KLAVIYO_PRIVATE_API_KEY");
  }

  let selected = configured.find((item) => item.isDefault) || configured[0];
  if (typeof keyId === "string" && keyId.trim()) {
    const requested = keyId.trim();
    const match = configured.find((item) => item.id === requested);
    if (!match) {
      throw new Error(`Unknown Klaviyo account: ${requested}`);
    }
    selected = match;
  }

  return `Klaviyo-API-Key ${selected.value}`;
}

async function parseResponseBody(response) {
  const raw = await response.text();
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function klaviyoRequest({ path, method = "GET", body, accessToken, keyId, headers = {} }) {
  const url = `${DEFAULT_BASE_URL}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: resolveAuthorization(accessToken, keyId),
      revision: DEFAULT_REVISION,
      "Content-Type": "application/json",
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const parsed = await parseResponseBody(response);

  if (!response.ok) {
    throw new KlaviyoHttpError(
      `Klaviyo responded ${response.status} on ${path}`,
      response.status,
      parsed
    );
  }

  return parsed;
}

function toPathFromUrl(input) {
  if (typeof input !== "string" || !input.trim()) {
    return "";
  }
  try {
    const parsed = new URL(input);
    return `${parsed.pathname}${parsed.search || ""}`;
  } catch {
    return input;
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readPath(source, path) {
  let cursor = source;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || !(key in cursor)) {
      return null;
    }
    cursor = cursor[key];
  }
  return typeof cursor === "string" ? cursor : null;
}

function isLikelyPublicImageUrl(value) {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) {
    return false;
  }

  try {
    const parsed = new URL(value);
    if (parsed.pathname.startsWith("/api/")) {
      return false;
    }
  } catch {
    return false;
  }

  return true;
}

function findFirstPublicImageUrl(input, depth = 0) {
  if (depth > 6 || input == null) {
    return null;
  }

  if (typeof input === "string") {
    return isLikelyPublicImageUrl(input) ? input : null;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      const found = findFirstPublicImageUrl(item, depth + 1);
      if (found) {
        return found;
      }
    }
    return null;
  }

  if (typeof input === "object") {
    for (const value of Object.values(input)) {
      const found = findFirstPublicImageUrl(value, depth + 1);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

async function listResourcePages({ path, accessToken, keyId, maxPages = 20 }) {
  const items = [];
  let nextPath = path;
  let pageCount = 0;

  while (nextPath && pageCount < maxPages) {
    const payload = await klaviyoRequest({
      path: nextPath,
      method: "GET",
      accessToken,
      keyId
    });

    const pageItems = Array.isArray(payload && payload.data) ? payload.data : [];
    items.push(...pageItems);

    const rawNext = payload && payload.links ? payload.links.next : null;
    nextPath = rawNext ? toPathFromUrl(rawNext) : "";
    pageCount += 1;
  }

  return {
    items,
    hasMore: Boolean(nextPath)
  };
}

function getImageUrl(imagePayload) {
  if (!imagePayload || typeof imagePayload !== "object") {
    return null;
  }

  const preferredPaths = [
    ["data", "attributes", "url"],
    ["data", "attributes", "src"],
    ["data", "attributes", "image_url"],
    ["data", "attributes", "optimized_image_url"],
    ["data", "attributes", "original_url"],
    ["data", "attributes", "cdn_url"],
    ["data", "attributes", "public_url"]
  ];

  for (const path of preferredPaths) {
    const value = readPath(imagePayload, path);
    if (isLikelyPublicImageUrl(value)) {
      return value;
    }
  }

  return findFirstPublicImageUrl(imagePayload);
}

async function uploadImageFromBase64({ base64, contentType = "image/png", accessToken, keyId }) {
  const dataUrl = `data:${contentType};base64,${base64}`;

  const attempts = [
    // Current Klaviyo API field.
    {
      data: {
        type: "image",
        attributes: {
          import_from_url: dataUrl
        }
      }
    },
    // Backward-compat fallback for older revisions.
    {
      data: {
        type: "image",
        attributes: {
          src: dataUrl
        }
      }
    }
  ];

  let lastError = null;
  let imageResponse = null;
  for (const payload of attempts) {
    try {
      imageResponse = await klaviyoRequest({
        path: "/api/images",
        method: "POST",
        body: payload,
        accessToken,
        keyId
      });
      break;
    } catch (error) {
      lastError = error;
      if (!(error instanceof KlaviyoHttpError) || error.status < 400 || error.status >= 500) {
        throw error;
      }
    }
  }

  if (!imageResponse) {
    throw lastError || new Error("Failed to upload image to Klaviyo.");
  }

  const imageId = imageResponse && imageResponse.data ? imageResponse.data.id : null;
  let imageUrl = getImageUrl(imageResponse);

  // Some Klaviyo revisions return the ID first and populate URL shortly after.
  if (!imageUrl && imageId) {
    for (let i = 0; i < 5; i += 1) {
      if (i > 0) {
        await sleep(350);
      }
      try {
        const detailResponse = await klaviyoRequest({
          path: `/api/images/${encodeURIComponent(String(imageId))}`,
          method: "GET",
          accessToken,
          keyId
        });
        const resolved = getImageUrl(detailResponse);
        if (resolved) {
          imageUrl = resolved;
          imageResponse = detailResponse;
          break;
        }
      } catch (error) {
        if (!(error instanceof KlaviyoHttpError) || error.status >= 500) {
          throw error;
        }
      }
    }
  }

  return {
    raw: imageResponse,
    id: imageId,
    url: imageUrl
  };
}

async function createTemplate({ name, html, text, accessToken, keyId }) {
  const payload = {
    data: {
      type: "template",
      attributes: {
        name,
        editor_type: "CODE",
        html,
        text: text || ""
      }
    }
  };

  return klaviyoRequest({
    path: "/api/templates",
    method: "POST",
    body: payload,
    accessToken,
    keyId
  });
}

function normalizeImageEntries(entries) {
  const source = Array.isArray(entries) ? entries : [];
  return source
    .map((entry) => {
      if (typeof entry === "string") {
        return {
          url: entry,
          link: "",
          alt: ""
        };
      }
      if (!entry || typeof entry !== "object") {
        return null;
      }
      return {
        url: typeof entry.url === "string" ? entry.url : "",
        link: typeof entry.link === "string" ? entry.link.trim() : "",
        alt: typeof entry.alt === "string" ? entry.alt.trim() : ""
      };
    })
    .filter((item) => item && item.url);
}

function buildEmailHtmlFromImageUrls(entries, options = {}) {
  const background = options.backgroundColor || "#ffffff";
  const spacing = Number.isFinite(options.spacing) ? Math.max(0, options.spacing) : 0;
  const maxWidth = Number.isFinite(options.maxWidth) ? Math.max(320, options.maxWidth) : 600;
  const footerHtmlItems = [];
  const sourceFooterItems = Array.isArray(options.footerHtmlItems) ? options.footerHtmlItems : [];
  for (const item of sourceFooterItems) {
    const html = typeof item === "string" ? item.trim() : "";
    if (html) {
      footerHtmlItems.push(html);
    }
  }
  if (typeof options.footerHtml === "string" && options.footerHtml.trim()) {
    footerHtmlItems.push(options.footerHtml.trim());
  }
  const images = normalizeImageEntries(entries);

  const rows = images
    .map((image, index) => {
      const topPadding = index === 0 ? 0 : spacing;
      const altValue = typeof image.alt === "string" ? image.alt.trim() : "";
      const altAttr = altValue ? ` alt="${escapeHtml(altValue)}"` : "";
      const imageTag = `<img src="${escapeHtml(image.url)}"${altAttr} width="${maxWidth}" style="display:block;width:100%;max-width:${maxWidth}px;height:auto;border:0;outline:none;text-decoration:none;" />`;
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
    })
    .join("\n");

  const footerRows = footerHtmlItems
    .map((footerHtml, index) => `
        <tr>
          <td style="padding:${images.length || index > 0 ? spacing : 0}px 0 0 0;">
            ${footerHtml}
          </td>
        </tr>
      `)
    .join("\n");

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
            ${footerRows}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`.trim();
}

async function createCampaignDraft({
  name,
  includedAudienceIds,
  excludedAudienceIds,
  subject,
  previewText,
  fromEmail,
  fromLabel,
  replyToEmail,
  accessToken,
  keyId
}) {
  const emailContent = {
    subject,
    preview_text: previewText || "",
    from_email: fromEmail,
    from_label: fromLabel,
    reply_to_email: replyToEmail || fromEmail
  };

  const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const commonCoreAttributes = {
    name,
    audiences: {
      included: includedAudienceIds,
      excluded: excludedAudienceIds
    }
  };

  const commonDeliveryAttributes = {
    send_options: {
      use_smart_sending: false
    },
    tracking_options: {
      is_tracking_opens: true,
      is_tracking_clicks: true
    }
  };

  const messageDefinition = {
    channel: "email",
    label: subject,
    content: emailContent
  };

  function buildCampaignAttributes(sendStrategy, includeDeliveryAttributes) {
    return {
      ...commonCoreAttributes,
      ...(includeDeliveryAttributes ? commonDeliveryAttributes : {}),
      send_strategy: sendStrategy,
      "campaign-messages": {
        data: [
          {
            type: "campaign-message",
            attributes: {
              definition: messageDefinition
            }
          }
        ]
      }
    };
  }

  const attempts = [
    {
      name: "definition-immediate",
      body: {
        data: {
          type: "campaign",
          attributes: buildCampaignAttributes({ method: "immediate" }, true)
        }
      }
    },
    {
      name: "definition-static-options_static",
      body: {
        data: {
          type: "campaign",
          attributes: buildCampaignAttributes({
            method: "static",
            options_static: {
              datetime: scheduledAt
            }
          }, true)
        }
      }
    },
    {
      name: "definition-immediate-minimal",
      body: {
        data: {
          type: "campaign",
          attributes: buildCampaignAttributes({ method: "immediate" }, false)
        }
      }
    },
    {
      name: "definition-static-options_static-minimal",
      body: {
        data: {
          type: "campaign",
          attributes: buildCampaignAttributes({
            method: "static",
            options_static: {
              datetime: scheduledAt
            }
          }, false)
        }
      }
    },
    {
      name: "definition-static-options-minimal",
      body: {
        data: {
          type: "campaign",
          attributes: buildCampaignAttributes({
            method: "static",
            options: {
              datetime: scheduledAt,
              is_local: false
            }
          }, false)
        }
      }
    }
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return await klaviyoRequest({
        path: "/api/campaigns",
        method: "POST",
        body: attempt.body,
        accessToken,
        keyId
      });
    } catch (error) {
      lastError = error;
      if (error instanceof KlaviyoHttpError && error.responseBody && typeof error.responseBody === "object") {
        const previousMeta = error.responseBody.meta && typeof error.responseBody.meta === "object"
          ? error.responseBody.meta
          : {};
        error.responseBody = {
          ...error.responseBody,
          meta: {
            ...previousMeta,
            campaign_attempt: attempt.name
          }
        };
      }
      if (!(error instanceof KlaviyoHttpError) || error.status < 400 || error.status >= 500) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Failed to create campaign draft.");
}

function extractCampaignMessageId(campaignResponse) {
  const relationships = campaignResponse &&
    campaignResponse.data &&
    campaignResponse.data.relationships;

  if (
    relationships &&
    relationships["campaign-messages"] &&
    Array.isArray(relationships["campaign-messages"].data) &&
    relationships["campaign-messages"].data[0] &&
    relationships["campaign-messages"].data[0].id
  ) {
    return relationships["campaign-messages"].data[0].id;
  }

  const included = campaignResponse && Array.isArray(campaignResponse.included)
    ? campaignResponse.included
    : [];
  const message = included.find((item) => item && item.type === "campaign-message" && item.id);
  return message ? message.id : null;
}

async function assignTemplateToCampaignMessage({ campaignMessageId, templateId, accessToken, keyId }) {
  const attempts = [
    {
      data: {
        type: "campaign-message",
        id: campaignMessageId,
        relationships: {
          template: {
            data: {
              type: "template",
              id: templateId
            }
          }
        }
      }
    },
    {
      data: {
        type: "campaign-message-template",
        attributes: {
          campaign_message_id: campaignMessageId,
          template_id: templateId
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
              id: campaignMessageId
            }
          },
          template: {
            data: {
              type: "template",
              id: templateId
            }
          }
        }
      }
    }
  ];

  let lastError = null;
  for (const body of attempts) {
    try {
      return await klaviyoRequest({
        path: "/api/campaign-message-assign-template",
        method: "POST",
        body,
        accessToken,
        keyId
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Failed to assign template to campaign message.");
}

function mapAudience(resource, fallbackType) {
  const attributes = resource && resource.attributes ? resource.attributes : {};
  const id = resource && resource.id ? String(resource.id) : "";
  if (!id) {
    return null;
  }

  const type = resource && resource.type ? String(resource.type) : fallbackType;
  const name = typeof attributes.name === "string" && attributes.name.trim()
    ? attributes.name.trim()
    : `${fallbackType} ${id}`;

  return {
    id,
    type,
    name
  };
}

async function listAudiences({ accessToken, keyId }) {
  const warnings = [];

  const listPages = await listResourcePages({
    path: "/api/lists",
    accessToken,
    keyId,
    maxPages: 20
  });

  const lists = listPages.items
    .map((item) => mapAudience(item, "list"))
    .filter(Boolean);

  if (listPages.hasMore) {
    warnings.push("List results were truncated at 20 pages.");
  }

  let segments = [];
  try {
    const segmentPages = await listResourcePages({
      path: "/api/segments",
      accessToken,
      keyId,
      maxPages: 20
    });

    segments = segmentPages.items
      .map((item) => mapAudience(item, "segment"))
      .filter(Boolean);

    if (segmentPages.hasMore) {
      warnings.push("Segment results were truncated at 20 pages.");
    }
  } catch (error) {
    if (error instanceof KlaviyoHttpError) {
      warnings.push(`Segments unavailable (${error.status}). Make sure scope 'segments:read' is enabled.`);
    } else {
      warnings.push("Segments unavailable.");
    }
  }

  const audiences = lists.concat(segments).sort((a, b) => {
    if (a.type !== b.type) {
      return a.type.localeCompare(b.type);
    }
    return a.name.localeCompare(b.name);
  });

  return {
    lists,
    segments,
    audiences,
    warnings
  };
}

function normalizeUniversalContentItem(resource) {
  const id = resource && resource.id ? String(resource.id) : "";
  if (!id) {
    return null;
  }

  const attributes = resource && resource.attributes && typeof resource.attributes === "object"
    ? resource.attributes
    : {};
  const definition = attributes.definition && typeof attributes.definition === "object"
    ? attributes.definition
    : {};
  const type = typeof definition.type === "string" ? definition.type : "";
  const name = typeof attributes.name === "string" && attributes.name.trim()
    ? attributes.name.trim()
    : `${type || "content"} ${id}`;

  return {
    id,
    name,
    type
  };
}

function extractUniversalContentHtml(payload) {
  const resource = payload && payload.data && typeof payload.data === "object"
    ? payload.data
    : payload;
  const attributes = resource && resource.attributes && typeof resource.attributes === "object"
    ? resource.attributes
    : {};
  const definition = attributes.definition && typeof attributes.definition === "object"
    ? attributes.definition
    : {};
  const data = definition.data && typeof definition.data === "object"
    ? definition.data
    : {};

  const directCandidates = [
    data.content,
    data.html,
    attributes.content,
    attributes.html
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  if (typeof data === "string" && data.trim()) {
    return data.trim();
  }

  return "";
}

async function listUniversalContent({ accessToken, keyId }) {
  const pages = await listResourcePages({
    path: "/api/template-universal-content?page[size]=100",
    accessToken,
    keyId,
    maxPages: 20
  });

  const items = pages.items
    .map((item) => normalizeUniversalContentItem(item))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));

  const warnings = [];
  if (pages.hasMore) {
    warnings.push("Universal content results were truncated at 20 pages.");
  }

  return {
    items,
    warnings
  };
}

async function getUniversalContentFooterHtml({ id, accessToken, keyId }) {
  const universalContentId = typeof id === "string" ? id.trim() : "";
  if (!universalContentId) {
    return "";
  }

  const payload = await klaviyoRequest({
    path: `/api/template-universal-content/${encodeURIComponent(universalContentId)}`,
    method: "GET",
    accessToken,
    keyId
  });

  const html = extractUniversalContentHtml(payload);
  if (!html) {
    throw new Error(`Universal content '${universalContentId}' does not contain usable HTML content.`);
  }

  return html;
}

module.exports = {
  assignTemplateToCampaignMessage,
  createCampaignDraft,
  KlaviyoHttpError,
  buildEmailHtmlFromImageUrls,
  createTemplate,
  extractCampaignMessageId,
  getUniversalContentFooterHtml,
  klaviyoRequest,
  listKlaviyoAccounts,
  listAudiences,
  listUniversalContent,
  uploadImageFromBase64
};

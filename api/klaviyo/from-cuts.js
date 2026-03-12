const {
  assignTemplateToCampaignMessage,
  createCampaignDraft,
  KlaviyoHttpError,
  buildEmailHtmlFromImageUrls,
  createTemplate,
  extractCampaignMessageId,
  uploadImageFromBase64
} = require("../_lib/klaviyo");
const { handlePreflight, headerValue, readJsonBody, requireProxySecret, sendError, sendJson } = require("../_lib/http");

function requireString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid required field: ${fieldName}`);
  }
  return value.trim();
}

function parseIdList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
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

  let stage = "initial";
  try {
    const keyId = headerValue(req, "x-klaviyo-account").trim() || null;
    stage = "request-parse";
    const body = await readJsonBody(req);
    const templateName = requireString(body.templateName, "templateName");
    const images = Array.isArray(body.images) ? body.images : [];

    if (!images.length) {
      sendError(res, 400, "No images received.");
      return;
    }

    const maxWidth = Number.isFinite(body.maxWidth) ? body.maxWidth : 600;
    const spacing = Number.isFinite(body.spacing) ? body.spacing : 0;
    const backgroundColor = typeof body.backgroundColor === "string" ? body.backgroundColor : "#ffffff";
    const accessToken = typeof body.accessToken === "string" && body.accessToken.trim() ? body.accessToken.trim() : null;
    const campaignInput = body && body.campaign && typeof body.campaign === "object" ? body.campaign : {};
    const shouldCreateDraftCampaign = body.createDraftCampaign !== false;

    const uploaded = [];
    stage = "upload-images";
    for (let i = 0; i < images.length; i += 1) {
      const image = images[i] || {};
      const base64 = requireString(image.base64, `images[${i}].base64`);
      const contentType = typeof image.contentType === "string" ? image.contentType : "image/png";

      const upload = await uploadImageFromBase64({
        base64,
        contentType,
        accessToken,
        keyId
      });

      if (!upload.url) {
        const imageId = upload && upload.id ? String(upload.id) : "unknown";
        throw new Error(`Image ${i + 1} was created in Klaviyo (id: ${imageId}) but no public URL was returned.`);
      }

      uploaded.push({
        id: upload.id,
        url: upload.url,
        filename: typeof image.filename === "string" ? image.filename : `cut-${i + 1}.png`,
        link: typeof image.link === "string" ? image.link.trim() : "",
        alt: typeof image.alt === "string" ? image.alt.trim() : ""
      });
    }

    const html = buildEmailHtmlFromImageUrls(uploaded, { backgroundColor, spacing, maxWidth });

    stage = "create-template";
    const templateResponse = await createTemplate({
      name: templateName,
      html,
      accessToken,
      keyId
    });

    let campaignResult = null;
    if (shouldCreateDraftCampaign) {
      const templateId = templateResponse && templateResponse.data ? templateResponse.data.id : null;
      if (!templateId) {
        throw new Error("Template was created but no template ID was returned.");
      }

      const campaignName = typeof campaignInput.name === "string" && campaignInput.name.trim()
        ? campaignInput.name.trim()
        : `${templateName} Campaign`;
      const includedAudienceIds = parseIdList(campaignInput.includedAudienceIds);
      const excludedAudienceIds = parseIdList(campaignInput.excludedAudienceIds);
      const subject = requireString(campaignInput.subject, "campaign.subject");
      const fromEmail = requireString(campaignInput.fromEmail, "campaign.fromEmail");
      const fromLabel = requireString(campaignInput.fromLabel, "campaign.fromLabel");
      const previewText = typeof campaignInput.previewText === "string" ? campaignInput.previewText.trim() : "";
      const replyToEmail = typeof campaignInput.replyToEmail === "string" ? campaignInput.replyToEmail.trim() : "";

      if (!includedAudienceIds.length) {
        throw new Error("campaign.includedAudienceIds must include at least one ID.");
      }

      stage = "create-campaign";
      const campaignResponse = await createCampaignDraft({
        name: campaignName,
        includedAudienceIds,
        excludedAudienceIds,
        subject,
        previewText,
        fromEmail,
        fromLabel,
        replyToEmail,
        accessToken,
        keyId
      });

      const campaignId = campaignResponse && campaignResponse.data ? campaignResponse.data.id : null;
      if (!campaignId) {
        throw new Error("Campaign was created but no campaign ID was returned.");
      }

      const campaignMessageId = extractCampaignMessageId(campaignResponse);
      if (!campaignMessageId) {
        throw new Error("Campaign message ID not found in create campaign response.");
      }

      stage = "assign-template";
      const assignmentResponse = await assignTemplateToCampaignMessage({
        campaignMessageId,
        templateId,
        accessToken,
        keyId
      });

      campaignResult = {
        id: campaignId,
        messageId: campaignMessageId,
        templateAssigned: true,
        assignRaw: assignmentResponse
      };
    }

    sendJson(res, 200, {
      ok: true,
      template: {
        id: templateResponse && templateResponse.data ? templateResponse.data.id : null,
        raw: templateResponse
      },
      campaign: campaignResult,
      uploadedImages: uploaded,
      html
    });
  } catch (error) {
    if (error instanceof KlaviyoHttpError) {
      sendError(res, error.status || 502, "Klaviyo API request failed", {
        stage: typeof stage === "string" ? stage : "unknown",
        klaviyo: error.responseBody
      });
      return;
    }

    sendError(res, 400, error.message || "Invalid request");
  }
};

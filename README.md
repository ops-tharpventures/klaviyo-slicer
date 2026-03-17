# Figma to Klaviyo Cutter

Figma plugin + Vercel proxy workflow.

Last updated: 2026-03-16.

The plugin:
- lists top-level nodes (level 1)
- detects buttons by configurable tokens (contains match)
- exports the selected design and creates automatic slices
- protects button zones with per-button margins
- can ignore named sections from slices using token matching (for example: `footer`)
- supports per-slice link URL and alt text
- lets you optimize delivery output (`PNG/JPEG`, quality, width, `1x/2x`)
- lets you choose an optional footer from Klaviyo Universal Content
- lets you append an optional custom HTML footer
- sends slices to a Vercel API proxy
- supports `Template only` or `Template + Draft Campaign` mode in the plugin
- creates Klaviyo assets through that proxy

## 1) Install Plugin In Figma

1. In Figma: `Plugins` -> `Development` -> `Import plugin from manifest...`
2. Select: `figma-plugin/manifest.json`
3. Run the plugin

## 2) Deploy Vercel Proxy

1. Create a Vercel project from this repository.
2. In Vercel project settings, add environment variables:
- `KLAVIYO_PRIVATE_API_KEY` (required, `pk_...`)
- Optional multi-account keys (same prefix, different suffixes), for example:
  - `KLAVIYO_PRIVATE_API_KEY_SITE1`
  - `KLAVIYO_PRIVATE_API_KEY_SITE2`
  - `KLAVIYO_PRIVATE_API_KEY_BRAND_X`
  - use `_` in the variable name (Vercel env names do not support spaces)
- `KLAVIYO_BASE_URL` (optional, default: `https://a.klaviyo.com`)
- `KLAVIYO_REVISION` (optional, default: `2026-01-15`)
- `PROXY_SHARED_SECRET` (required, long random secret)
3. Deploy.
4. Copy your production URL, e.g. `https://your-project.vercel.app`.
5. In the plugin, set:
- `Proxy Base URL` = your deployed Vercel URL
- `Proxy Secret` = same value as `PROXY_SHARED_SECRET`
- Click `Refresh` in `Klaviyo Account` to load available accounts
- Pick the account you want in the dropdown before loading audiences/sending

Audience debug URL (optional):
- You can open audiences directly in browser with:
- `https://your-project.vercel.app/api/klaviyo/audiences?proxy_secret=YOUR_PROXY_SHARED_SECRET`
- With explicit account selection:
- `https://your-project.vercel.app/api/klaviyo/audiences?proxy_secret=YOUR_PROXY_SHARED_SECRET&klaviyo_account=KLAVIYO_PRIVATE_API_KEY_SITE1`
- This query fallback is enabled for the audiences and universal-content endpoints.

Universal content debug URL (optional):
- `https://your-project.vercel.app/api/klaviyo/universal-content?proxy_secret=YOUR_PROXY_SHARED_SECRET`
- With explicit account selection:
- `https://your-project.vercel.app/api/klaviyo/universal-content?proxy_secret=YOUR_PROXY_SHARED_SECRET&klaviyo_account=KLAVIYO_PRIVATE_API_KEY_SITE1`

CLI equivalent:
1. `npm i -g vercel` (if needed)
2. `vercel login`
3. `vercel` (first link/setup)
4. `vercel env add KLAVIYO_PRIVATE_API_KEY production`
5. `vercel env add KLAVIYO_BASE_URL production` (optional)
6. `vercel env add KLAVIYO_REVISION production` (optional)
7. `vercel env add PROXY_SHARED_SECRET production`
8. `vercel --prod`

Required Klaviyo key scopes:
- `templates:write`
- `templates:read` (required to load Universal Content footer options)
- `images:write`
- `campaigns:write`
- `lists:read`
- `segments:read`

## 3) Local Proxy (Optional)

For local testing instead of a deployed URL:

1. Create `.env` from `.env.example`.
2. Set `KLAVIYO_PRIVATE_API_KEY`.
3. Run `npm run dev` (starts `vercel dev`).
4. Use `http://localhost:3000` as `Proxy Base URL` in the plugin.

## 4) Button Detection

- Set `Button Match Tokens (contains)` (default: `button, btn, cta`)
- If a layer name contains any token, it is treated as a button
- For custom tokens, prefer explicit margin markers in the layer name:
  - `m=20`
- `mt=12 mb=24`
- Implicit `button 24` style works for default aliases (`button`, `btn`, `cta`)

## 5) Typical Flow

1. Select a top-level node
2. Click `Detect Buttons`
3. Adjust per-button margins
4. Set `Max Height` and export scale
5. (Optional) enable `Ignore Named Sections` and set tokens (for example: `footer`)
6. Click `Export + Generate Slices`
7. (Optional) Set link + alt text per slice
8. Choose mode:
- `Template only` to create only the template
- `Template + Draft Campaign` to also create the campaign draft
9. If campaign mode: (optional) click `Load Audiences` and add IDs to included/excluded
10. If campaign mode: fill campaign fields (`subject`, `from email`, `from name`, etc.)
11. (Optional) choose `Klaviyo Account` from the dropdown (multi-account setup)
12. (Optional) click `Load` in `Footer (Universal Content)` and select the footer block you want appended
13. (Optional) add `Custom Footer HTML`
14. Click `Send To Klaviyo` (or `Create Template In Klaviyo` in template-only mode)

## 6) Project Structure

```txt
figma-plugin/
  code.js
  manifest.json
  ui.html
api/ (Vercel serverless proxy endpoints)
```

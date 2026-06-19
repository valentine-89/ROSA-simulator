# AI Template Brief

Use this short brief before creating or editing a ROSA sample template.

## First read

1. Read `docs/template-authoring.md`.
2. If the template has QR pages, public displays, customer self-service pages, or any `system_pages` entry, also read `docs/secure-iot-page-flow.md`.
3. Inspect `sample_templates/manifest.json` and the closest existing template in `sample_templates/templates/`.

## Work scope

Create the template by copying and adapting the closest working template. Keep the work inside `sample_templates/`:

- Template files live under `sample_templates/templates/<template-id>/`.
- Shared browser assets may be reused from `sample_templates/shared/`.
- Register the template in `sample_templates/manifest.json`.
- Add dashboard HTML, setup HTML/JS, browser JS/CSS, images, and sample `.sqlite` files only when the template needs them.

Do not edit simulator runtime files, packaging files, npm files, backend routes, or build tooling. Do not add dependencies, frameworks, background services, Node workers, or a separate backend.

## Dashboard rules

- Preserve the `AI-BRIDGE` editable/locked marker pattern used by existing dashboard templates.
- Keep dashboard config JSON valid and minimal.
- Use existing telemetry, timeseries, command, setup bridge, and SQLite macro patterns already used by current templates.
- If a setup page is needed, use `DashboardSetupBridge`, render editable controls, and return a complete config JSON.

## Public IoT page rules

Public pages must use `/iot-page/{ioid}/{pageid}` and pageid-based APIs only. Never expose `sessionId@apikey`, real `sync_id`, API keys, or direct `/api/{sessionId}/{syncId}/...` URLs in browser HTML/JavaScript.

For public telemetry, timeseries, and SSE, configure readable fields in `system_pages.meta.publicApi.fields`. Browser code calls the public endpoint without sending the field list.

For public macros and commands, follow `docs/secure-iot-page-flow.md`.

## Finish checklist

Before considering the template complete:

```bash
npm run validate
npm run check
```

Both commands must pass.

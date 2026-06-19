# ROSA sample template authoring guide for AI

This document is written for AI agents and engineers creating a new ROSA sample dashboard template. For a compact task prompt, start with `docs/ai-template-brief.md`; this file is the detailed authoring contract.

Before creating a new template, inspect existing templates under `sample_templates/templates/` and copy the closest working template first. Prefer editing proven structure over writing a dashboard from scratch.

If the template includes QR pages, public displays, customer self-service pages, or any `system_pages` entry, also read `docs/secure-iot-page-flow.md` before editing. Public IoT pages have a stricter security boundary than private dashboards.

## Non-negotiable template scope

A new ROSA sample template is frontend-only. Build it as plain HTML, CSS, and browser JavaScript that runs inside the existing simulator. Do not add backend code.

Allowed template changes:

- Add or edit files under `sample_templates/templates/<template-id>/`.
- Reuse shared frontend assets from `sample_templates/shared/`.
- Register the template in `sample_templates/manifest.json`.
- Add sample images, CSS, browser JS, dashboard HTML, setup HTML, setup JS, and sample `.sqlite` files when the template needs database macros.

Forbidden changes unless the human explicitly asks for simulator development work:

- Do not edit `server.js`, `src/`, `simulator_ui/`, `scripts/`, `packaging/`, `package.json`, or `package-lock.json`.
- Do not add npm dependencies, build tools, frameworks, bundlers, TypeScript, React/Vue/Svelte projects, or generated build output.
- Do not create new API endpoints, backend routes, background services, WebSocket servers, workers that require Node, or any server-side persistence outside the existing simulator store.
- Do not require a separate backend, database server, cloud service, authentication service, or deployment step.
- Do not put business logic into simulator backend files just because a dashboard needs data. Express the behavior through frontend config, existing telemetry/timeseries APIs, command APIs, or SQLite macros in a sample `.sqlite` file.
- Do not put direct device credentials, `sessionId@apikey`, real `sync_id`, or direct `/api/{sessionId}/{syncId}/...` URLs into public page HTML/JavaScript.

If the requested template appears to need backend behavior, stop and model it within the existing template boundary instead. If that is not possible, explain the limitation and ask the human for permission before changing simulator/backend code.

## Required structure

Every template must be registered in `sample_templates/manifest.json`. A sample or locale entry must include:

- `id`, `name`, `description`, `html`, `setup.page` when setup UI exists.
- `sampleDatabase` only when the template uses SQLite macros.
- `default-fields`, always present as an array. Use `[]` for database-only templates with no telemetry/timeseries.

`default-fields` is simulator-only metadata. It is not shown in the template picker. The simulator uses it to suggest and prefill Telemetry / timeseries generators.

```json
"default-fields": [
  { "field": "O101", "kind": "onoff" },
  { "field": "#1021", "kind": "text" },
  { "field": "#1005", "kind": "number", "min": 0, "max": 100 },
  { "field": "temperature", "kind": "timeseries", "min": 25, "max": 35 }
]
```

Allowed keys are intentionally minimal:

- `field`: telemetry/timeseries/parameter field name.
- `kind`: one of `timeseries`, `number`, `text`, or `onoff`.
- `min`, `max`: optional numeric range for `timeseries` and `number` only.

Use `timeseries` only for float numeric data that should also append timeseries rows. Use `number` for float numeric telemetry without timeseries. Use `text` for fixed text, schedules, parameters, media strings, and CSV-like payloads. Use `onoff` for ON/OFF state fields. Do not create integer or CSV generator kinds; CSV payloads are plain `text`.

## AI BRIDGE markers

Dashboard HTML must preserve the same AI BRIDGE marker pattern used by existing templates:

- `AI-BRIDGE-EDITABLE HTML LAYOUT`
- `AI-BRIDGE-EDITABLE DASHBOARD CONFIG`
- `AI-BRIDGE-EDITABLE SAMPLE SCRIPT`
- `AI-BRIDGE-LOCKED RUNTIME SCRIPT`

The dashboard config marker contains the JSON config that setup UI edits. Keep it valid JSON and keep it minimal: only fields the runtime actually uses. Do not put current telemetry values in config.

## Theme and UI conventions

For theme support, copy the closest existing dashboard implementation. Reuse the shared theme stylesheet and the established theme picker behavior instead of inventing a new theme API.

When adding controls, inspect older templates for:

- How command URLs are built through `dashboard-command-template.js`.
- How theme selection is stored and applied.
- How setup GUI communicates through `setup_bridge.js`.
- How private dashboards use `<<sessionid>>` and `<<syncid>>` placeholders. Public IoT pages must use `/iot-page/{ioid}/{pageid}` and the pageid-based public APIs instead.

## Setup page checklist

For templates with setup UI:

- Create setup HTML/JS under the same template folder.
- Use `DashboardSetupBridge` and follow the existing `setup_*_vi.js` examples.
- Render clear editable controls for the dashboard config.
- Return a complete config JSON that matches the dashboard runtime.
- Keep labels, default values, and validation messages consistent with the selected template style.
- Register the setup page through the template's `setup.page` manifest field.

## Runtime and database conventions

Use telemetry endpoints for current field values and timeseries endpoints for chart history. Use SQLite macros only for actual database-backed state or history. Do not store telemetry snapshots in SQLite unless the template specifically manages historical business data.

Templates may call only the existing simulator/runtime endpoints already used by current templates. Do not invent new backend URLs and then modify `server.js` to support them. If a new data shape is needed, adapt the frontend config, reuse an existing macro pattern, or add data to the sample SQLite file.

Private dashboards may use the direct runtime APIs that include the active `sessionId` and `syncId`, because the user is already inside the authenticated/template runtime context.

Public IoT pages are different. If a template creates rows in `system_pages`, the browser-facing page must follow `docs/secure-iot-page-flow.md`:

- Render through `/iot-page/{ioid}/{pageid}`.
- Read `__ROSA_IOT_PAGE_META__` and `__ROSA_IOT_PAGE_CONTEXT__` from JSON script tags.
- Use `/api/iot-page-telemetry/{ioid}/{pageid}`, `/api/iot-page-timeseries/{ioid}/{pageid}`, and `/api/iot-page-realtime/{ioid}/{pageid}` for public telemetry/timeseries. Visible fields are configured server-side in `meta.publicApi.fields`; browser code does not send the field list.
- Use `/api/iot-page-macro/{ioid}/{pageid}` for public SQLite macros. Runnable macros are configured server-side in `meta.publicApi.macros`.
- Use `/api/iot-page-stream/{ioid}/{pageid}` only for database change notifications when `meta.publicApi.stream=true`.
- Use `/api/iot-cmd/{ioid}/{cmd_id}` for public commands defined in `system_cmds`. Do not build gateway commands or API-key URLs in browser code.
- Never ask the browser to send reserved keys: `apikey`, `api_key`, `syncid`, `sync_id`, `sessionid`, `session_id`, `ioid`, `macro`, `email`, `phone`, `username`, `__proto__`, `prototype`, or `constructor`.
- Do not declare reserved keys in `publicApi.context`, public macro params, or public command request bodies. Identity fields such as `email`, `username`, and `phone` are injected by the backend when `require_email` or `require_phone` is enabled.

For templates with setup UI, the setup page should receive context from `DashboardSetupBridge`, render editable config controls, and return a complete JSON config. Keep labels and Vietnamese text aligned with existing templates.

## Validation

Before running validation, verify the scope:

- The new template is registered in `sample_templates/manifest.json`.
- All new template implementation files are under `sample_templates/`.
- The dashboard/setup UI is plain HTML/CSS/browser JavaScript.
- No backend files, npm dependency files, packaging files, or simulator core files were changed for the template.
- Any database behavior is represented by a sample `.sqlite` file and macro examples, not a new backend service.
- Any public IoT page follows `docs/secure-iot-page-flow.md` and does not expose direct device credentials.

Run:

```bash
npm run validate
npm run check
```

Validation checks paths, markers, sample database files, and `default-fields`. A new template is not complete until both commands pass.

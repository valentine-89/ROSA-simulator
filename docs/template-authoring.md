# ROSA sample template authoring guide for AI

This document is written for AI agents and engineers creating a new ROSA sample dashboard template. Before creating a new template, inspect existing templates under `sample_templates/templates/` and copy the closest working template first. Prefer editing proven structure over writing a dashboard from scratch.

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
- How dashboards use `<<sessionid>>` and `<<syncid>>` placeholders.

## Runtime and database conventions

Use telemetry endpoints for current field values and timeseries endpoints for chart history. Use SQLite macros only for actual database-backed state or history. Do not store telemetry snapshots in SQLite unless the template specifically manages historical business data.

For templates with setup UI, the setup page should receive context from `DashboardSetupBridge`, render editable config controls, and return a complete JSON config. Keep labels and Vietnamese text aligned with existing templates.

## Validation

Run:

```bash
npm run validate
npm run check
```

Validation checks paths, markers, sample database files, and `default-fields`. A new template is not complete until both commands pass.

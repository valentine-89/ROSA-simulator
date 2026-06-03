# ROSA-simulator

Local-only Node.js simulator for developing ROSA sample dashboard templates.

## Run

```bash
npm install
npm start
```

Open `http://localhost:4177`.

## Validate

```bash
npm run validate
```

The simulator keeps template source under `sample_templates/` and serves compatibility URLs such as `/sample_dashboards/...`, `/dashboard-themes.css`, and `/dashboard-command-template.js`.

## Windows portable package

Build a customer-friendly Windows folder with an exe launcher:

```bash
npm run package:win
```

Output:

```text
dist/ROSA-simulator-win-x64/
  ROSA-simulator.exe
  runtime/node.exe
  server.js
  sample_templates/
  .sim/state/
```

The exe only launches the local Node server and opens the browser. Templates and simulator databases remain external in `sample_templates/` and `.sim/state/`, so partners can edit or replace them without rebuilding the exe.

## Template authoring

Use [docs/template-authoring.md](docs/template-authoring.md) when creating or reviewing a new sample template. It documents required AI BRIDGE markers, JSON config, theme reuse, and simulator `default-fields`.

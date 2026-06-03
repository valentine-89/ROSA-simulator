const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { parseDashboardEditableSections } = require('../src/dashboardEditableSections');

const ROOT = path.resolve(__dirname, '..');
const SAMPLE_ROOT = path.join(ROOT, 'sample_templates');
const TEMPLATE_ROOT = path.join(SAMPLE_ROOT, 'templates');
const SHARED_ROOT = path.join(SAMPLE_ROOT, 'shared');
const MANIFEST_PATH = path.join(SAMPLE_ROOT, 'manifest.json');
const ALLOWED_ROOT_ASSETS = new Set([
  '/dashboard-themes.css',
  '/dashboard-command-template.js',
  '/dashboard-basic-cards-engine.js',
  '../../dashboard-themes.css',
  '../../dashboard-command-template.js',
  '../../dashboard-basic-cards-engine.js'
]);
const ALLOWED_DEFAULT_FIELD_KINDS = new Set(['timeseries', 'number', 'text', 'onoff']);
const macroNameCache = new Map();

let failed = false;

function fail(message) {
  failed = true;
  console.error(`FAIL ${message}`);
}

function ok(message) {
  console.log(`OK   ${message}`);
}

function resolvePublicPath(value) {
  const normalized = String(value || '').split('?')[0].trim();
  if (!normalized) return '';
  if (normalized === '/sample_dashboards/manifest.json') return MANIFEST_PATH;
  if (normalized.startsWith('/sample_dashboards/')) {
    return path.join(TEMPLATE_ROOT, normalized.replace(/^\/sample_dashboards\//, ''));
  }
  if (normalized === '/dashboard-themes.css') return path.join(SHARED_ROOT, 'dashboard-themes.css');
  if (normalized === '/dashboard-command-template.js') return path.join(SHARED_ROOT, 'dashboard-command-template.js');
  if (normalized === '/dashboard-basic-cards-engine.js') return path.join(SHARED_ROOT, 'dashboard-basic-cards-engine.js');
  return '';
}

function assertFile(publicPath, label) {
  const filePath = resolvePublicPath(publicPath);
  if (!filePath || !fs.existsSync(filePath)) {
    fail(`${label} not found: ${publicPath}`);
    return '';
  }
  return filePath;
}

function collectRefs(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const refs = [];
  for (const match of source.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) refs.push(match[1].split('?')[0]);
  for (const match of source.matchAll(/script\.src\s*=\s*["']([^"']+)["']/gi)) refs.push(match[1].split('?')[0]);
  return refs;
}

function validateHtml(filePath, publicPath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const parsed = parseDashboardEditableSections(source);
  if (parsed.hasMarkers) {
    if (parsed.parseError) {
      fail(`AI-BRIDGE marker error in ${publicPath}: ${parsed.parseError}`);
    } else {
      try {
        JSON.parse(parsed.sections.config || '{}');
        ok(`markers/config valid: ${publicPath}`);
      } catch {
        fail(`dashboard config JSON invalid: ${publicPath}`);
      }
    }
  }

  for (const ref of collectRefs(filePath)) {
    if (ref.startsWith('http:') || ref.startsWith('https:') || ref.startsWith('data:')) continue;
    if (ref.startsWith('/sample_dashboards/')) {
      assertFile(ref, `asset referenced by ${publicPath}`);
      continue;
    }
    if (ref.startsWith('/dashboard-') || ref.startsWith('../../dashboard-')) {
      if (!ALLOWED_ROOT_ASSETS.has(ref)) fail(`root runtime is not allowed in ${publicPath}: ${ref}`);
      continue;
    }
  }
}

function validateSqlite(publicPath) {
  const filePath = assertFile(publicPath, 'sample database');
  if (!filePath) return;
  try {
    const db = new Database(filePath, { readonly: true, fileMustExist: true });
    db.prepare(`SELECT name FROM sqlite_master LIMIT 1`).all();
    db.close();
    ok(`sample database opens: ${publicPath}`);
  } catch (error) {
    fail(`sample database invalid ${publicPath}: ${error.message}`);
  }
}

function macroNamesForDatabase(publicPath) {
  if (macroNameCache.has(publicPath)) return macroNameCache.get(publicPath);
  const filePath = assertFile(publicPath, 'sample database for macro examples');
  if (!filePath) return null;
  try {
    const db = new Database(filePath, { readonly: true, fileMustExist: true });
    const names = new Set(db.prepare(`SELECT name FROM system_macros WHERE COALESCE(enabled, 1) <> 0`).all().map((row) => row.name));
    db.close();
    macroNameCache.set(publicPath, names);
    return names;
  } catch (error) {
    fail(`cannot read system_macros from ${publicPath}: ${error.message}`);
    return null;
  }
}

function localeEntries(sample) {
  const result = [];
  if (sample.html) result.push({ locale: sample.defaultLocale || 'default', ...sample });
  for (const [locale, entry] of Object.entries(sample.locales || {})) {
    result.push({ locale, ...entry });
  }
  return result;
}

function defaultFieldsFor(sample, entry) {
  if (entry && Object.prototype.hasOwnProperty.call(entry, 'default-fields')) return entry['default-fields'];
  if (sample && Object.prototype.hasOwnProperty.call(sample, 'default-fields')) return sample['default-fields'];
  return undefined;
}

function macroExamplesFor(sample, entry) {
  if (entry && Object.prototype.hasOwnProperty.call(entry, 'macro-examples')) return entry['macro-examples'];
  if (sample && Object.prototype.hasOwnProperty.call(sample, 'macro-examples')) return sample['macro-examples'];
  return undefined;
}

function validateDefaultFields(sample, entry) {
  const fields = defaultFieldsFor(sample, entry);
  const label = `${sample.id}/${entry.locale}`;
  if (!Array.isArray(fields)) {
    fail(`default-fields must be declared as an array: ${label}`);
    return;
  }
  fields.forEach((fieldConfig, index) => {
    if (!fieldConfig || typeof fieldConfig !== 'object' || Array.isArray(fieldConfig)) {
      fail(`default-fields[${index}] must be an object: ${label}`);
      return;
    }
    if (!String(fieldConfig.field || '').trim()) fail(`default-fields[${index}].field missing: ${label}`);
    const kind = String(fieldConfig.kind || '').trim();
    if (!ALLOWED_DEFAULT_FIELD_KINDS.has(kind)) {
      fail(`default-fields[${index}].kind must be timeseries, number, text, or onoff: ${label}`);
    }
    if ((kind === 'text' || kind === 'onoff')
      && (Object.prototype.hasOwnProperty.call(fieldConfig, 'min') || Object.prototype.hasOwnProperty.call(fieldConfig, 'max'))) {
      fail(`default-fields[${index}].min/max are only allowed for timeseries or number: ${label}`);
    }
    if (Object.prototype.hasOwnProperty.call(fieldConfig, 'min') && !Number.isFinite(Number(fieldConfig.min))) {
      fail(`default-fields[${index}].min must be numeric when present: ${label}`);
    }
    if (Object.prototype.hasOwnProperty.call(fieldConfig, 'max') && !Number.isFinite(Number(fieldConfig.max))) {
      fail(`default-fields[${index}].max must be numeric when present: ${label}`);
    }
  });
  ok(`default-fields valid: ${label}`);
}

function validateMacroExamples(sample, entry) {
  const examples = macroExamplesFor(sample, entry);
  const label = `${sample.id}/${entry.locale}`;
  const sampleDatabase = entry.sampleDatabase || sample.sampleDatabase;
  if (examples === undefined) {
    if (sampleDatabase) fail(`macro-examples missing for database template: ${label}`);
    return;
  }
  if (!Array.isArray(examples)) {
    fail(`macro-examples must be declared as an array: ${label}`);
    return;
  }
  const knownMacros = sampleDatabase ? macroNamesForDatabase(sampleDatabase) : null;
  examples.forEach((example, index) => {
    if (!example || typeof example !== 'object' || Array.isArray(example)) {
      fail(`macro-examples[${index}] must be an object: ${label}`);
      return;
    }
    if (!String(example.label || '').trim()) fail(`macro-examples[${index}].label missing: ${label}`);
    if (!example.payload || typeof example.payload !== 'object' || Array.isArray(example.payload)) {
      fail(`macro-examples[${index}].payload must be an object: ${label}`);
      return;
    }
    const macroName = String(example.payload.macro || '').trim();
    if (!macroName) {
      fail(`macro-examples[${index}].payload.macro missing: ${label}`);
    } else if (knownMacros && !knownMacros.has(macroName)) {
      fail(`macro-examples[${index}].payload.macro not found in system_macros (${macroName}): ${label}`);
    }
    if (Object.prototype.hasOwnProperty.call(example, 'gatewayCommand') && typeof example.gatewayCommand !== 'string') {
      fail(`macro-examples[${index}].gatewayCommand must be a string: ${label}`);
    }
  });
  ok(`macro-examples valid: ${label}`);
}

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    fail('manifest missing.');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (!Array.isArray(manifest.samples)) fail('manifest.samples must be an array.');

  for (const asset of ['dashboard-themes.css', 'dashboard-command-template.js', 'dashboard-basic-cards-engine.js']) {
    const filePath = path.join(SHARED_ROOT, asset);
    if (fs.existsSync(filePath)) ok(`shared asset exists: ${asset}`);
    else fail(`shared asset missing: ${asset}`);
  }

  for (const sample of manifest.samples || []) {
    if (!sample.id) {
      fail('sample id missing.');
      continue;
    }
    const entries = localeEntries(sample);
    for (const entry of entries) {
      validateDefaultFields(sample, entry);
      validateMacroExamples(sample, entry);
      const html = entry.html || sample.html;
      if (html) {
        const htmlPath = assertFile(html, `dashboard html for ${sample.id}/${entry.locale}`);
        if (htmlPath) validateHtml(htmlPath, html);
      }
      const setupPage = entry.setup && entry.setup.page || sample.setup && sample.setup.page;
      if (setupPage) assertFile(setupPage, `setup page for ${sample.id}/${entry.locale}`);
      const image = entry.image || sample.image;
      if (image) assertFile(image, `image for ${sample.id}/${entry.locale}`);
      const sampleDatabase = entry.sampleDatabase || sample.sampleDatabase;
      if (sampleDatabase) validateSqlite(sampleDatabase);
    }
  }

  if (failed) process.exit(1);
  ok('validation complete');
}

main();

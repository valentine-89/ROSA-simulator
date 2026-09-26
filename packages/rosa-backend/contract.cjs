"use strict";
const crypto = require("node:crypto");
const acorn = require("acorn");
const walk = require("acorn-walk");
const { Linter } = require("eslint");
const Ajv = require("ajv");
const schemaCache = new Map();
const VERSION = 1;
const LIMITS = Object.freeze({
  source: 262144,
  input: 65536,
  output: 262144,
  logs: 32768,
  sdkCalls: 1000,
  pendingSdk: 16,
});
const METHODS = [
  "db.macro",
  "db.report",
  "iot.latest",
  "iot.timeseries",
  "iot.command",
  "page.command",
];
function fail(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}
function name(value) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(value))
    throw fail(
      "INVALID_NAME",
      "Tên dùng a-z, 0-9, _ hoặc -, bắt đầu bằng chữ, tối đa 64 ký tự.",
    );
  return value;
}
function ioid(value) {
  if (typeof value !== "string" || !/^IO[A-Za-z0-9_-]{1,96}$/.test(value))
    throw fail("INVALID_IOID", "IOID không hợp lệ.");
  return value;
}
function json(value, bytes = LIMITS.input) {
  const encoded = JSON.stringify(value);
  if (encoded === undefined || Buffer.byteLength(encoded) > bytes)
    throw fail("PAYLOAD_TOO_LARGE", "Dữ liệu vượt giới hạn.", 413);
  const decoded = JSON.parse(encoded);
  function scan(v, depth) {
    if (depth > 32) throw fail("INVALID_JSON", "JSON quá sâu.");
    if (v && typeof v === "object")
      for (const k of Object.keys(v)) {
        if (["__proto__", "constructor", "prototype"].includes(k))
          throw fail("INVALID_JSON", "JSON chứa tên thuộc tính không hợp lệ.");
        scan(v[k], depth + 1);
      }
  }
  scan(decoded, 0);
  return decoded;
}
function validateSchema(schema, value) {
  const s = json(schema, 32768);
  if (!s || typeof s !== "object" || Array.isArray(s) || !s.type)
    throw fail("INVALID_SCHEMA", "Schema phải khai báo type.");
  // No remote references, custom code, regular expressions or recursive schemas from authors.
  function check(v) {
    if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (["$ref", "$dynamicRef", "pattern", "patternProperties"].includes(k))
          throw fail("INVALID_SCHEMA", `Schema không hỗ trợ ${k}.`);
        check(x);
      }
  }
  check(s);
  let validator = schemaCache.get(hash(s));
  try {
    if (!validator)
      validator = new Ajv({
        strict: true,
        allErrors: false,
        validateFormats: false,
      }).compile(s);
    if (schemaCache.size >= 128)
      schemaCache.delete(schemaCache.keys().next().value);
    schemaCache.set(hash(s), validator);
  } catch (e) {
    throw fail("INVALID_SCHEMA", String(e.message).slice(0, 500));
  }
  if (arguments.length > 1 && !validator(value))
    throw fail("SCHEMA_MISMATCH", new Ajv().errorsText(validator.errors));
  return s;
}
function analyze(source, syntaxOnly = false) {
  if (
    typeof source !== "string" ||
    !source.trim() ||
    Buffer.byteLength(source) > LIMITS.source
  )
    throw fail("INVALID_SOURCE", "Mã nguồn rỗng hoặc vượt 256 KB.");
  const diagnostics = [];
  let ast;
  try {
    ast = acorn.parse(source, {
      ecmaVersion: 2022,
      sourceType: "module",
      locations: true,
    });
  } catch (e) {
    return {
      ok: false,
      diagnostics: [
        {
          severity: "error",
          line: e.loc?.line || 1,
          column: (e.loc?.column || 0) + 1,
          message: e.message,
        },
      ],
    };
  }
  const entry = ast.body.find((n) => n.type === "ExportDefaultDeclaration");
  if (
    !entry ||
    ![
      "FunctionDeclaration",
      "ArrowFunctionExpression",
      "FunctionExpression",
    ].includes(entry.declaration.type)
  )
    diagnostics.push({
      severity: "error",
      line: 1,
      column: 1,
      message: "Cần export default một hàm main(input, rosa).",
    });
  if (syntaxOnly) return { ok: !diagnostics.length, diagnostics };
  walk.full(ast, (n) => {
    if (
      [
        "ImportDeclaration",
        "ImportExpression",
        "ExportAllDeclaration",
        "ExportNamedDeclaration",
      ].includes(n.type) ||
      (n.type === "Identifier" &&
        [
          "eval",
          "Function",
          "WebAssembly",
          "SharedArrayBuffer",
          "Atomics",
        ].includes(n.name))
    )
      diagnostics.push({
        severity: "error",
        line: n.loc.start.line,
        column: n.loc.start.column + 1,
        message: "Không hỗ trợ import, eval, Function hoặc bộ nhớ chia sẻ.",
      });
  });
  const globals = Object.fromEntries(
    [
      "console",
      "JSON",
      "Math",
      "Date",
      "Object",
      "Array",
      "String",
      "Number",
      "Boolean",
      "BigInt",
      "Map",
      "Set",
      "WeakMap",
      "WeakSet",
      "Promise",
      "Error",
      "TypeError",
      "RangeError",
      "RegExp",
      "Intl",
      "undefined",
      "NaN",
      "Infinity",
      "parseInt",
      "parseFloat",
      "isNaN",
      "isFinite",
      "encodeURIComponent",
      "decodeURIComponent",
      "ArrayBuffer",
      "Uint8Array",
      "Int8Array",
      "Uint16Array",
      "Int16Array",
      "Uint32Array",
      "Int32Array",
      "Float32Array",
      "Float64Array",
      "DataView",
    ].map((k) => [k, "readonly"]),
  );
  const messages = new Linter().verify(source, {
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals },
    rules: {
      "no-undef": "error",
      "no-unreachable": "error",
      "no-constant-condition": ["warn", { checkLoops: false }],
      "no-unused-vars": ["warn", { args: "none" }],
      "no-async-promise-executor": "error",
    },
  });
  diagnostics.push(
    ...messages.map((m) => ({
      severity: m.severity === 2 ? "error" : "warning",
      line: m.line,
      column: m.column,
      message: m.message,
    })),
  );
  return { ok: !diagnostics.some((d) => d.severity === "error"), diagnostics };
}
function definition(raw) {
  const d = json(raw, LIMITS.source + 131072);
  name(d.name);
  const result = analyze(d.source);
  if (!result.ok)
    throw fail("CODE_INVALID", JSON.stringify(result.diagnostics));
  d.inputSchema = validateSchema(
    d.inputSchema || {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  );
  d.outputSchema = validateSchema(d.outputSchema || { type: "object" });
  d.permissions = d.permissions || { macros: [], reports: [], devices: {} };
  if (d.permissions.pages !== undefined) {
    const pages = d.permissions.pages;
    const id = /^[A-Za-z0-9._:-]{1,128}$/;
    if (!pages || typeof pages !== 'object' || Array.isArray(pages) || Object.keys(pages).length > 100 ||
        Object.entries(pages).some(([page, commands]) => !id.test(page) || !Array.isArray(commands) ||
          commands.length > 100 || commands.some(command => typeof command !== 'string' || !id.test(command))))
      throw fail('INVALID_PERMISSIONS', 'pages phải khai báo tên trang và danh sách command.');
  }
  for (const field of ["macros", "reports"])
    if (
      !Array.isArray(d.permissions[field]) ||
      d.permissions[field].some((x) => typeof x !== "string" || x.length > 128)
    )
      throw fail(
        "INVALID_PERMISSIONS",
        `${field} phải là danh sách tên macro.`,
      );
  if (
    !d.permissions.devices ||
    typeof d.permissions.devices !== "object" ||
    Array.isArray(d.permissions.devices)
  )
    throw fail("INVALID_PERMISSIONS", "devices phải là object.");
  for (const [alias, p] of Object.entries(d.permissions.devices)) {
    name(alias);
    if (p.ioid !== "self") ioid(p.ioid);
    if (
      !Array.isArray(p.commands) ||
      p.commands.some((c) => typeof c !== "string" || c.length > 128)
    )
      throw fail("INVALID_PERMISSIONS", "commands phải là danh sách.");
    if (
      p.fields !== undefined &&
      (!Array.isArray(p.fields) || p.fields.some((x) => typeof x !== "string"))
    )
      throw fail("INVALID_PERMISSIONS", "fields phải là danh sách.");
    if (p.read !== undefined && typeof p.read !== "boolean")
      throw fail("INVALID_PERMISSIONS", "read phải là boolean.");
    if (p.read && (!p.fields?.length || p.fields.length > 128))
      throw fail("INVALID_PERMISSIONS", "Quyền đọc cần khai báo 1–128 fields.");
  }
  return {
    name: d.name,
    description: String(d.description || "").slice(0, 500),
    source: d.source,
    inputSchema: d.inputSchema,
    outputSchema: d.outputSchema,
    permissions: d.permissions,
    contractVersion: VERSION,
  };
}
function assertCapability(d, method, args) {
  json(args);
  if (!METHODS.includes(method))
    throw fail("CAPABILITY_DENIED", "SDK không được hỗ trợ.", 403);
  if (method === 'page.command') {
    if (!d.permissions.pages?.[args[0]]?.includes(args[1]))
      throw fail('CAPABILITY_DENIED', 'Trang/command chưa được cấp quyền.', 403);
    return;
  }
  if (method.startsWith("db.")) {
    if (
      !(
        d.permissions[method === "db.macro" ? "macros" : "reports"] || []
      ).includes(args[0])
    )
      throw fail("CAPABILITY_DENIED", "Macro chưa được cấp quyền.", 403);
  } else {
    const device = d.permissions.devices[args[0]];
    if (
      !device ||
      (method === "iot.command" && !device.commands.includes(args[1])) ||
      (method !== "iot.command" && !device.read)
    )
      throw fail(
        "CAPABILITY_DENIED",
        "Thiết bị/lệnh chưa được cấp quyền.",
        403,
      );
  }
}
function hash(value) {
  return crypto
    .createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}
function secretMatches(secret, digest) {
  return (
    typeof secret === "string" &&
    typeof digest === "string" &&
    digest.length === 64 &&
    crypto.timingSafeEqual(Buffer.from(hash(secret)), Buffer.from(digest))
  );
}
function authenticate(headers, config) {
  if (!config?.externalEnabled)
    throw fail("NOT_FOUND", "Backend không mở truy cập ngoài.", 404);
  const get = (k) =>
    typeof headers.get === "function"
      ? headers.get(k) || ""
      : headers[k.toLowerCase()] || "";
  let key = "";
  if (config.authType === "bearer") {
    const m = /^Bearer (\S+)$/i.exec(get("authorization"));
    key = m?.[1] || "";
  }
  if (config.authType === "api-key") key = get("x-api-key");
  if (config.authType === "basic") {
    const m = /^Basic ([A-Za-z0-9+/=]+)$/i.exec(get("authorization"));
    const text = m ? Buffer.from(m[1], "base64").toString("utf8") : "";
    const at = text.indexOf(":");
    if (at >= 0 && text.slice(0, at) === config.username)
      key = text.slice(at + 1);
  }
  if (!secretMatches(key, config.keyHash))
    throw fail("UNAUTHORIZED", "Xác thực không hợp lệ.", 401);
}
module.exports = {
  VERSION,
  LIMITS,
  METHODS,
  fail,
  name,
  ioid,
  json,
  validateSchema,
  analyze,
  definition,
  assertCapability,
  hash,
  secretMatches,
  authenticate,
};

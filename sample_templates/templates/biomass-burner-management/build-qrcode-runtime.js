const fs = require('fs');
const path = require('path');

// qrcode.react bundles Project Nayuki's MIT QR generator. Extract only that
// dependency and expose a tiny framework-free SVG renderer for this template.
const sourcePath = require.resolve('qrcode.react');
const source = fs.readFileSync(sourcePath, 'utf8');
const start = source.indexOf('// src/third-party/qrcodegen/index.ts');
const endMarker = 'var qrcodegen_default = qrcodegen;';
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('Unable to locate bundled QR generator');
const qrCore = source.slice(start, end + endMarker.length);
const output = `/*
 * QR Code generator: Copyright (c) Project Nayuki, MIT License.
 * Extracted from qrcode.react (ISC) by build-qrcode-runtime.js.
 */
(function(global){
"use strict";
${qrCore}
function pathData(modules, margin) {
  var ops = [];
  modules.forEach(function(row, y) {
    var start = null;
    row.forEach(function(cell, x) {
      if (cell && start === null) start = x;
      if ((!cell || x === row.length - 1) && start !== null) {
        var end = cell && x === row.length - 1 ? x + 1 : x;
        ops.push("M" + (start + margin) + " " + (y + margin) + "h" + (end - start) + "v1H" + (start + margin) + "z");
        start = null;
      }
    });
  });
  return ops.join("");
}
function svg(value, size) {
  var qr = qrcodegen_default.QrCode.encodeText(String(value || ""), qrcodegen_default.QrCode.Ecc.MEDIUM);
  var margin = 4;
  var viewSize = qr.size + margin * 2;
  return '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="QR" width="' + (size || 220) + '" height="' + (size || 220) + '" viewBox="0 0 ' + viewSize + ' ' + viewSize + '"><rect width="100%" height="100%" fill="#fff"/><path d="' + pathData(qr.getModules(), margin) + '" fill="#111827"/></svg>';
}
global.BiomassQr = { svg: svg, render: function(element, value, size) { element.innerHTML = svg(value, size); } };
})(window);
`;
fs.writeFileSync(path.join(__dirname, 'qrcode-runtime.js'), output);
console.log(path.join(__dirname, 'qrcode-runtime.js'));

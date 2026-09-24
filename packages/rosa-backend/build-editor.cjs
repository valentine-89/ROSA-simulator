const fs = require("node:fs");
const path = require("node:path");
const destination = path.resolve(
  process.argv[2] || path.join(__dirname, "../../public/backend"),
);
fs.mkdirSync(destination, { recursive: true });
for (const file of ["editor.html", "editor.css", "page-sdk.js", "guide.html"])
  if (fs.existsSync(path.join(__dirname, file)))
    fs.copyFileSync(path.join(__dirname, file), path.join(destination, file));
require("esbuild").buildSync({
  entryPoints: [path.join(__dirname, "editor.mjs")],
  bundle: true,
  minify: true,
  outfile: path.join(destination, "editor.js"),
  target: "es2020",
  legalComments: "eof",
});

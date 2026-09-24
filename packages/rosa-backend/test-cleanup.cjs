const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Delete the enumerated fixture files individually, then only empty directories.
module.exports = function removeFixture(root) {
  root = path.resolve(root);
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('rosa-')) {
    throw new Error('Refusing cleanup outside a ROSA temporary fixture');
  }
  const files = [], directories = [];
  function inventory(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) inventory(file);
      else files.push(file);
    }
    directories.push(directory);
  }
  inventory(root);
  for (const file of files) fs.unlinkSync(file);
  for (const directory of directories) fs.rmdirSync(directory);
};

const path = require('path');
const url = require('url');

const file = __filename;
const dir = path.dirname(file);

console.log({file, dir});

module.exports = {
  APP_ROOT: dir,
  dir,
  file
}


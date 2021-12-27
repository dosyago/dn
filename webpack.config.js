const path = require('path');
const webpack = require('webpack');

module.exports = {
  entry: "./src/app.js",
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: "22120.js"
  },
  target: "node",
  node: {
    __dirname: false
  },
  plugins: [
    new webpack.BannerPlugin({ banner: "#!/usr/bin/env node", raw: true }),
  ]
};

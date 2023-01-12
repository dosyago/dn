const path = require('path');
const webpack = require('webpack');

module.exports = {
  entry: "./src/app.js",
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: "22120.cjs"
  },
  optimization: {
    minimize: false
  },
  target: "node",
  node: {
    __dirname: false
  },
  externalsPresets: {
    node: true
  },
  externals: [
  ],
  plugins: [
    new webpack.BannerPlugin({ banner: "#!/usr/bin/env node", raw: true }),
  ],
  module: {
    rules: [
      {
        test: /\.node$/,
        loader: 'node-loader',
      },
    ],
  },
};

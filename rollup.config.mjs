import path from 'path';
//import commonjs from '@rollup/plugin-commonjs';
import { terser } from "rollup-plugin-terser";

export default {
  input: path.resolve('src', 'app.js'),
  output: {
    file: path.resolve('dist', '22120-module.js'),
    format: 'es',
    generatedCode: 'es2015'
  },
  plugins: [/*commonjs(),*/ terser()]
};

import path from 'path';

const server_port = process.env.PORT || process.argv[2] || 22120;
const mode = process.argv[3] || 'save';
const chrome_port = process.argv[4] || 9222;
const library_path = process.argv[5] || path.join(__dirname, 'public', 'library');

console.log(`Args usage: <server_port> <save|serve> <chrome_port> <library_path>`);

const args = {
  server_port, mode, 
  chrome_port,
  library_path
};

export default args;

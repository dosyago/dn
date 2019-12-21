const server_port = process.argv[2];
const chrome_port = process.argv[3];
const library_path = process.argv[4];


const args = {
  server_port, chrome_port,
  library_path
};

export default args;

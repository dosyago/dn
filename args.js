const server_port = process.argv[2];
const mode = process.argv[3];
const chrome_port = process.argv[4];
const library_path = process.argv[5];


const args = {
  server_port, mode, 
  chrome_port,
  library_path
};

export default args;

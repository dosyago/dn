import library_path from 'args';
import { Writable } from 'stream'
import { create } from 'ipfs-http-client'
import { filesFromPaths } from 'files-from-path'
import fs from 'fs';

// TODO: Move this to ./app.js, then pass this to the functions that are in this file.
// TODO: Make this configurable
const ipfs = IPFS.create({ host: 'localhost', port: 5001 });

function sendToIpfs(folder, ipfs) {
   ipfs.add(folder).then((result) => {
     const cid = result.cid.toString();
     console.log(`Directory added to IPFS with CID ${cid}`);
   }).catch((error) => {
     console.error(`Failed to add ${folder} to IPFS: ${error}`);
   });
}

function traverseLibrary(ipfs) {
  // Traverse the library, searching for un-IPFS-ed captures.
  // When we find one, call sendToIpfs with it as an argument.
  // TODO: Implement
}

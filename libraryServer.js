import fs from 'fs';
import path from 'path';
import express from 'express';

import args from './args.js';
import {say, sleep} from './common.js';
import Archivist from './archivist.js';

const SITE_PATH = path.resolve(__dirname, 'public');

const app = express();

let Server, upAt, port;

const LibraryServer = {
  start, stop
}

export default LibraryServer;

async function start({server_port}) {
  port = server_port;
  addHandlers();
  Server = app.listen(Number(port), err => {
    if ( err ) { 
      throw err;
    } 
    upAt = new Date;
    say({server_up:{upAt,port}});
  });
}

function addHandlers() {
  const {chrome_port} = args;

  app.use(express.urlencoded({extended:true}));
  app.use(express.static(SITE_PATH));

  if ( !! args.library_path() ) {
    app.use("/library", express.static(args.library_path()))
  }

  app.get('/search', async (req, res) => {
    res.end('Not implemented yet');
  });

  app.get('/mode', async (req, res) => {
    res.end(Archivist.getMode());
  });

  app.post('/mode', async (req, res) => {
    const {mode} = req.body;
    await Archivist.changeMode(mode);
    res.end(`Mode set to ${mode}`);
  });

  app.get('/base_path', async (req, res) => {
    res.end(args.getBasePath());
  });

  app.post('/base_path', async (req, res) => {
    const {base_path} = req.body;
    const change = args.updateBasePath(base_path);

    if ( change ) {
      Archivist.handlePathChanged();
      Server.close(async () => {
        console.log(`Server closed.`);
        console.log(`Waiting 1 second...`);
        await sleep(1000);
        await start({server_port:port});
        console.log(`Server restarted.`);
      });
      res.end(`Base path set to ${base_path} and saved to preferences. Server restarting...`);
    } else {
      res.end(`Base path not changed.`);
    }
  });
}

async function stop() {
  let resolve;
  const pr = new Promise(res => resolve = res);

  console.log(`Closing library server...`);

  Server.close(() => {
    console.log(`Library server closed.`);
    resolve();
  });

  return pr;
}


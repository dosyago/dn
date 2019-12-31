import fs from 'fs';
import path from 'path';
import express from 'express';

import args from './args.js';
import {say} from './common.js';
import Archivist from './archivist.js';

const SITE_PATH = path.join(__dirname, 'public');
const libraryPath = args.library_path;

const app = express();

let upAt;

const LibraryServer = {
  start
}

export default LibraryServer;

async function start({server_port}) {
  addHandlers();
  app.listen(Number(server_port), err => {
    if ( err ) { 
      throw err;
    } 
    upAt = new Date;
    say({server_up:{upAt,server_port}});
  });
}

function addHandlers() {
  const {chrome_port} = args;

  app.use(express.urlencoded({extended:true}));
  app.use(express.static(SITE_PATH));
  if ( !! libraryPath ) {
    app.use("/library", express.static(libraryPath))
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

  app.get('/library_path', async (req, res) => {
    res.end(Archivist.getLibraryPath());
  });

  app.post('/library_path', async (req, res) => {
    const {library_path} = req.body;
    await Archivist.changeLibraryPath(library_path);
    res.end(`Library path set to ${library_path}`);
  });
}


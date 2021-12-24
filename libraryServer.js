import fs from 'fs';
import path from 'path';
import express from 'express';

import args from './args.js';
import {DEBUG, say, sleep, APP_ROOT, SNIP_CONTEXT} from './common.js';
import Archivist from './archivist.js';
import {highlight} from './highlighter.js';

const SITE_PATH = path.resolve(APP_ROOT, 'public');

const app = express();
const INDEX_FILE = args.index_file;

let running = false;
let Server, upAt, port;

const LibraryServer = {
  start, stop
}

export default LibraryServer;

async function start({server_port}) {
  if ( running ) {
    DEBUG && console.warn(`Attempting to start server when it is not closed. Exiting start()...`);
    return;
  }
  running = true;
  try {
    port = server_port;
    addHandlers();
    Server = app.listen(Number(port), err => {
      if ( err ) { 
        running = false;
        throw err;
      } 
      upAt = new Date;
      say({server_up:{upAt,port}});
    });
  } catch(e) {
    running = false;
    DEBUG && console.error(`Error starting server`, e);
  }
}

function addHandlers() {
  const {chrome_port} = args;

  app.use(express.urlencoded({extended:true}));
  app.use(express.static(SITE_PATH));

  if ( !! args.library_path() ) {
    app.use("/library", express.static(args.library_path()))
  }

  app.get('/search(.json)?', async (req, res) => {
    await Archivist.isReady();
    const {query, results:resultIds, HL} = await Archivist.search(req.query.query);
    const results = resultIds.map(docId => Archivist.getDetails(docId));
    if ( req.path.endsWith('.json') ) {
      res.end(JSON.stringify({
        results, query
      }, null, 2));
    } else {
      results.forEach(r => {
        r.snippet = Archivist.findOffsets(query, 
          highlight(query, r.content).map(hl => hl.fragment.text).join('&hellip;')
        );
      });
      res.end(SearchResultView({results, query, HL}));
    }
  });

  app.get('/mode', async (req, res) => {
    res.end(Archivist.getMode());
  });

  app.get('/archive_index.html', async (req, res) => {
    Archivist.saveIndex();
    const index = Archivist.getIndex();
    res.end(IndexView(index));
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
    Archivist.beforePathChanged();
    const change = args.updateBasePath(base_path);

    if ( change ) {
      await Archivist.afterPathChanged();
      Server.close(async () => {
        running = false;
        console.log(`Server closed.`);
        console.log(`Waiting 50ms...`);
        await sleep(50);
        start({server_port:port});
        console.log(`Server restarting.`);
      });
      res.end(`Base path set to ${base_path} and saved to preferences. See console for progress. Server restarting...`);
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

function IndexView(urls) {
  return `
    <!DOCTYPE html>
    <meta charset=utf-8>
    <title>Your HTML Library</title>
    <style>
      :root {
        font-family: sans-serif;
        background: lavenderblush;
      }
      body {
        display: table;
        margin: 0 auto;
        background: silver;
        padding: 0.5em;
        box-shadow: 0 1px 1px purple;
      }
      form {
      }
      fieldset {
        border: thin solid purple;
      }
      button, input, output {
      }
      input.long {
        width: 100%;
        min-width: 250px;
      }
      output {
        font-size: smaller;
        color: purple;
      }
      h1 {
        margin: 0;
      }
      h2 {
        margin-top: 0;
      }
    </style>
    <h1><a href=/>22120</a></h1>
    <h2>Internet Offline Library</h2>
    <h2>Archive Index</h2>
    <form method=GET action=/search>
      <fieldset>
        <legend>Search your archive</legend>
        <input type=search name=query placeholder="search your library">
        <button>Search</button>
      </fieldset>
    </form>
    <ul>
    ${
      urls.map(([url,{title, id}]) => `
        <li>
          ${DEBUG ? id + ':' : ''} <a target=_blank href=${url}>${title||url}</a>
        </li>
      `).join('\n')
    }
    </ul>
  `
}

function SearchResultView({results, query, HL}) {
  return `
    <!DOCTYPE html>
    <meta charset=utf-8>
    <title>${query} - 22120 search results</title>
    <style>
      :root {
        font-family: sans-serif;
        background: lavenderblush;
      }
      body {
        display: table;
        margin: 0 auto;
        background: silver;
        padding: 0.5em;
        box-shadow: 0 1px 1px purple;
      }
      form {
      }
      fieldset {
        border: thin solid purple;
      }
      button, input, output {
      }
      input.long {
        width: 100%;
        min-width: 250px;
      }
      output {
        font-size: smaller;
        color: purple;
      }
      h1 {
        margin: 0;
      }
      h2 {
        margin-top: 0;
      }
    </style>
    <h1><a href=/>22120</a></h1>
    <h2>Search results</h2>
    <form method=GET action=/search>
      <fieldset>
        <legend>Search again</legend>
        <input type=search name=query placeholder="search your library" value="${query}">
        <button>Search</button>
      </fieldset>
    </form>
    <p>
      Showing results for <b>${query}</b>
    </p>
    <ol>
    ${
      results.map(({snippet, url,title,id}) => `
        <li>
          ${DEBUG ? id + ':' : ''} <a target=_blank href=${url}>${HL.get(id)?.title||title||url}</a>
          <br>
          <small>${(HL.get(id)?.url||url).slice(0,128)}</small>
          <p>${snippet}</p>
        </li>
      `).join('\n')
    }
    </ol>
  `
}


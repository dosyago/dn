import path from 'path';
import express from 'express';

import args from './args.js';
import {
  MAX_REAL_URL_LENGTH,
  MAX_HEAD, MAX_HIGHLIGHTABLE_LENGTH, DEBUG, 
  say, sleep, APP_ROOT,
  RichError
} from './common.js';
import {startCrawl, Archivist} from './archivist.js';
import {trilight, /*highlight*/} from './highlighter.js';

const SITE_PATH = path.resolve(APP_ROOT, '..', 'public');

const app = express();

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
  app.use(express.urlencoded({extended:true}));
  app.use(express.static(SITE_PATH));

  if ( args.library_path() ) {
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
        /*
        r.snippet = '... ' + highlight(query, r.content, {maxLength:MAX_HIGHLIGHTABLE_LENGTH})
          .sort(({fragment:{offset:a}}, {fragment:{offset:b}}) => a-b)
          .map(hl => Archivist.findOffsets(query, hl.fragment.text))
          .join(' ... ');
        */
        r.snippet = '... ' + trilight(query, r.content, {maxLength:MAX_HIGHLIGHTABLE_LENGTH})
          .map(segment => Archivist.findOffsets(query, segment))
          .join(' ... ');
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

  app.get('/edit_index.html', async (req, res) => {
    Archivist.saveIndex();
    const index = Archivist.getIndex();
    res.end(IndexView(index, {edit:true}));
  });

  app.post('/edit_index.html', async (req, res) => {
    const {url_to_delete} = req.body;
    await Archivist.deleteFromIndexAndSearch(url_to_delete);
    res.redirect('/edit_index.html');
  });

  app.post('/mode', async (req, res) => {
    const {mode} = req.body;
    Archivist.changeMode(mode);
    //res.end(`Mode set to ${mode}`);
    res.redirect('/');
  });

  app.get('/base_path', async (req, res) => {
    res.end(args.getBasePath());
  });

  app.post('/base_path', async (req, res) => {
    const {base_path} = req.body;
    const change = args.updateBasePath(base_path, {before: [
      () => Archivist.beforePathChanged(base_path)
    ]});

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
      //res.end(`Base path set to ${base_path} and saved to preferences. See console for progress. Server restarting...`);
      res.redirect('/#new_base_path');
    } else {
      //res.end(`Base path did not change.`);
      res.redirect('/');
    }
  });

  app.post('/crawl', async (req, res) => {
    try {
      let {links, timeout, depth} = req.body;
      const oTimeout = timeout;
      timeout = Math.round(parseFloat(timeout)*1000);
      depth = Math.round(parseInt(depth));
      if ( Number.isNaN(timeout) || Number.isNaN(depth) || typeof links != 'string' ) {
        console.warn({invalid:{timeout,depth,links}});
        throw new RichError({
          status: 400, 
          message: 'Invalid parameters: timeout, depth or links'
        });
      }
      const urls = links.split(/[\n\s\r]+/g).map(u => u.trim()).filter(u => {
        const tooShort = u.length === 0;
        if ( tooShort ) return false;

        const tooLong = u.length > MAX_REAL_URL_LENGTH;
        if ( tooLong ) return false;

        let invalid = false;
        try {
          new URL(u);
        } catch { 
          invalid = true;
        };
        if ( invalid ) return false;

        return true;
      }).map(url => ({url,depth:1}));
      console.log(`Starting crawl from ${urls.length} URLs, waiting ${oTimeout} seconds for each to load, and continuing to a depth of ${depth} clicks...`); 
      await startCrawl({urls, timeout, depth});
      res.end(`Starting crawl from ${urls.length} URLs, waiting ${oTimeout} seconds for each to load, and continuing to a depth of ${depth} clicks...`);
    } catch(e) {
      if ( e instanceof RichError ) { 
        console.warn(e);
        const {status, message} = JSON.parse(e.message);
        res.status(status);
        res.end(message);
      } else {
        console.warn(e);
        res.sendStatus(500);
      }
      return;
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

function IndexView(urls, {edit:edit = false} = {}) {
  return `
    <!DOCTYPE html>
    <meta charset=utf-8>
    <title>
      ${ edit ? 'Editing ' : ''}
      Your HTML Library
    </title>
    <link rel=stylesheet href=/style.css>
    ${ edit ? `
    <script>
      const sleep = ms => new Promise(res => setTimeout(res, ms));
      const StrikeThrough = 'line-through';
    </script>
    ` : ''}
    <header>
      <h1><a href=/>22120</a> &mdash; Archive Index</h1>
    </header>
    <form method=GET action=/search style="margin-bottom: 1em;">
      <fieldset class=search>
        <legend>Search your archive</legend>
        <input class=search type=search name=query placeholder="search your library">
        <button>Search</button>
      </fieldset>
    </form>
    <form style="display:flex; justify-content: end; margin-bottom:0" 
        method=GET 
        action=${ edit ? '/archive_index.html' : '/edit_index.html' }>
      <details>
        <summary style="display:inline-block; cursor: default;">
          ${ edit ? `
            <button 
              style="
                border: 0; 
                background: 0; 
                font-size: x-large;
                line-height: 0.5;
              "
            >
              &check;
            </button>`
              :
            '&hellip;' 
          }
        </summary>
        <div style="position: absolute;">
          <button><em style="
              font-size:x-large;
              line-height:0.5;
              position: relative;
              top: 0.185em;
            ">
              &#9986;
             </em>
             edit
         </button>
        </div>
      </details>
    </form>
    <ul>
    ${
      urls.map(([url,{title, id}]) => `
        <li>
          ${ DEBUG ? id + ':' : ''} 
          <a target=_blank href=${url}>${(title||url).slice(0, MAX_HEAD)}</a>
          ${ edit ? `
          <form style=display:contents; method=POST action=/edit_index.html>
            <input name=url_to_delete type=url hidden value="${url}">
            <button 
              style="font-size: smaller; line-height: 0.618;" 
              type=button 
              onclick="double_confirm(event);"
            >
              X
            </button>
          </form>
          ` : ''}
        </li>
      `).join('\n')
    }
    </ul>
    ${ edit ? `
    <script>
      async function double_confirm(deleteClick) {
        const form = deleteClick.target.closest('form');
        const link = form.previousElementSibling;
        const original = link.style.textDecoration;
        link.style.textDecoration = StrikeThrough;
        let {host} = new URL(form.url_to_delete.value);
        host = host.replace(/^www./i, '');
        await sleep(200);
        const reallyDelete = confirm(
          \`\n are you sure you want to delete this \n\n  \${host} \n\n from the internet?\n\`
        );
        if ( reallyDelete ) return form.submit();
        link.style.textDecoration = original;
      }
    </script>
    ` : ''}
  `
}

function SearchResultView({results, query, HL}) {
  return `
    <!DOCTYPE html>
    <meta charset=utf-8>
    <title>${query} - 22120 search results</title>
    <link rel=stylesheet href=/style.css>
    <header>
      <h1><a href=/>22120</a> &mdash; Search Results</h1>
    </header>
    <p>
    View <a href=/archive_index.html>your index</a>, or
    </p>
    <form method=GET action=/search>
      <fieldset class=search>
        <legend>Search again</legend>
        <input class=search type=search name=query placeholder="search your library" value="${query}">
        <button>Search</button>
      </fieldset>
    </form>
    <p>
      Showing results for <b>${query}</b>
    </p>
    <ol class=results>
    ${
      results.map(({snippet, url,title,id}) => `
        <li>
          ${DEBUG ? id + ':' : ''} <a target=_blank href=${url}>${
            HL.get(id)?.title||(title||url||'').slice(0, MAX_HEAD)
          }</a>
          <br>
          <small class=url>${
            HL.get(id)?.url||(url||'').slice(0, MAX_HEAD)
          }</small>
          <p>${snippet}</p>
        </li>
      `).join('\n')
    }
    </ol>
  `
}


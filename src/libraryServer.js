import sea from 'node:sea';
import http from 'http';
import https from 'https';
import fs from 'fs';
import os from 'os'; // Included as it was in your original list, though not directly used in this server logic
import path from 'path';

import express from 'express';

import args from './args.js';
import {
  GO_SECURE,
  CERT_PATH,
  DEBUG,
  MAX_REAL_URL_LENGTH,
  MAX_HEAD, MAX_HIGHLIGHTABLE_LENGTH,
  say, sleep, APP_ROOT,
  RichError
} from './common.js';
import {startCrawl, Archivist} from './archivist.js';
import {trilight, highlight} from './highlighter.js'; // trilight is imported but its usage was commented out in original

const SITE_PATH = path.resolve(APP_ROOT, '..', 'public'); // Serves static files like style.css from here

const SearchCache = new Map();

const app = express();

let running = false;
let Server, upAt, port;

const LibraryServer = {
  start, stop
}

const secure_options = {};
const protocol = GO_SECURE ? https : http;

export default LibraryServer;

// --- PageLayout Helper ---
// (Incorporates changes for new default page and /settings path)
function PageLayout({ title, content, currentNav, layoutType = 'default' }) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - DownloadNet</title>
      <link rel="stylesheet" href="/style.css">
      <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>💾</text></svg>">
    </head>
    <body>
      <div class="container">
        <header class="site-header">
          <h1><a href="/">DownloadNet</a></h1>
          <nav class="main-nav">
            <ul>
              <li><a href="/archive_index.html" class="${currentNav === 'index' ? 'active' : ''}">View Index</a></li>
              <li><a href="/search" class="${currentNav === 'search' ? 'active' : ''}">Search Archive</a></li>
              <li><a href="/settings" class="${currentNav === 'settings' ? 'active' : ''}">Crawl & Settings</a></li>
            </ul>
          </nav>
        </header>
        <main class="${layoutType === 'sidebar' ? 'page-with-sidebar' : ''}">
          ${content}
        </main>
        <footer class="site-footer">
          <p>© ${new Date().getFullYear()} DownloadNet. Server up since: ${upAt ? upAt.toLocaleString() : 'N/A'}.</p>
        </footer>
      </div>
    </body>
    </html>
  `;
}


async function start({server_port}) {
  if ( running ) {
    DEBUG.verboseSlow && console.warn(`Attempting to start server when it is not closed. Exiting start()...`);
    return;
  }
  running = true;
  
  if (GO_SECURE) {
    try {
      const certPathDir = CERT_PATH(); // Call once
      const sec = {
        key: fs.readFileSync(path.resolve(certPathDir, 'privkey.pem')),
        cert: fs.readFileSync(path.resolve(certPathDir, 'fullchain.pem')),
        ca: fs.existsSync(path.resolve(certPathDir, 'chain.pem')) ?
            fs.readFileSync(path.resolve(certPathDir, 'chain.pem'))
          :
            undefined
      };
      DEBUG.debugSec && console.log({sec});
      Object.assign(secure_options, sec);
    } catch(e) {
      console.warn(`GO_SECURE is true, but SSL certs not found or unreadable at ${CERT_PATH()}. Will attempt to use insecure HTTP. Error: ${e.message}`);
    }
  }

  try {
    port = server_port;
    addHandlers();
    const useSecureServer = GO_SECURE && secure_options.key && secure_options.cert;
    const selectedProtocol = useSecureServer ? https : http;

    const server = selectedProtocol.createServer.apply(
        selectedProtocol, 
        useSecureServer ? [secure_options, app] : [app]
    );

    Server = server.listen(Number(port), err => {
      if ( err ) { 
        running = false;
        throw err;
      } 
      upAt = new Date();
      say({server_up:{
        upAt,
        port,
        protocol: useSecureServer ? 'https' : 'http',
        ...(DEBUG.verboseSlow ? {
          static_site_path: SITE_PATH,
          app_root: APP_ROOT,
        } : {})
      }});
    });
  } catch(e) {
    running = false;
    DEBUG.verboseSlow && console.error(`Error starting server`, e);
    process.exit(1);
  }
}

// --- addHandlers function with routing changes ---
function addHandlers() {
  app.use(express.urlencoded({extended:true, limit: '50mb'}));

  if ( args.library_path() ) {
    app.use("/library", express.static(args.library_path()))
  }

  // --- Root path now redirects to View Index ---
  app.get('/', (req, res) => {
    res.redirect('/archive_index.html');
  });

  // --- New path for Crawl & Settings page ---
  app.get('/settings', (req, res) => {
    // MainApplicationView now uses currentNav: 'settings'
    res.send(MainApplicationView());
  });
  
  app.get(['/search', '/search.json'], async (req, res) => {
    await Archivist.isReady();
    let {query:oquery} = req.query;
    let page = req.query.page;

    if (!oquery || typeof oquery !== 'string' || oquery.trim() === "") {
      // SearchResultView uses currentNav: 'search'
      return res.send(SearchResultView({results:[], query:'', HL:new Map, page:1, hasMore: false}));
    }
    oquery = oquery.trim();

    if ( ! page || ! Number.isInteger(parseInt(page)) || parseInt(page) < 1 ) {
      page = 1;
    } else {
      page = parseInt(page);
    }

    let resultIds, query, HL;
    if ( SearchCache.has(oquery) ) {
      ({query, resultIds, HL} = SearchCache.get(oquery));
    } else {
      ({query, results:resultIds, HL} = await Archivist.search(oquery));
      SearchCache.set(oquery, {query, resultIds, HL});
    }

    const startIdx = (page-1)*args.results_per_page;
    const paginatedResultIds = resultIds.slice(startIdx, startIdx + args.results_per_page);
    const results = paginatedResultIds.map(docId => Archivist.getDetails(docId));
    const hasMore = resultIds.length > startIdx + args.results_per_page;

    if ( req.path.endsWith('.json') ) {
      res.json({ results, query, page, hasMore });
    } else {
      results.forEach(r => {
        if (r && r.content) {
          r.snippet = '... ' + highlight(query, r.content, {
              maxLength: MAX_HIGHLIGHTABLE_LENGTH, 
              around: '<mark>',
              before: '</mark>'
            })
            .sort(({fragment:{offset:a}}, {fragment:{offset:b}}) => a-b)
            .map(hl => hl.fragment.text)
            .join(' ... ');
        } else {
          r.snippet = 'Content not available for snippet.';
        }
      });
      // SearchResultView uses currentNav: 'search'
      res.send(SearchResultView({results, query, HL, page, hasMore}));
    }
  });

  app.get('/mode', async (req, res) => {
    res.send(Archivist.getMode());
  });

  app.get('/archive_index.html', async (req, res) => {
    Archivist.saveIndex();
    const index = Archivist.getIndex();
    // IndexView uses currentNav: 'index'
    res.send(IndexView(index, {edit:false}));
  });

  app.get('/edit_index.html', async (req, res) => {
    Archivist.saveIndex();
    const index = Archivist.getIndex();
    // IndexView uses currentNav: 'index'
    res.send(IndexView(index, {edit:true}));
  });

  app.post('/edit_index.html', async (req, res) => {
    const {url_to_delete} = req.body;
    if (url_to_delete && typeof url_to_delete === 'string') {
        await Archivist.deleteFromIndexAndSearch(url_to_delete);
    }
    res.redirect('/edit_index.html');
  });

  app.post('/mode', async (req, res) => {
    const {mode} = req.body;
    if (mode && typeof mode === 'string' && ['record', 'replay', 'live'].includes(mode)) {
        Archivist.changeMode(mode);
    }
    // Redirect to /settings page with hash
    res.redirect('/settings#mode-settings');
  });

  app.get('/base_path', async (req, res) => {
    res.send(args.getBasePath());
  });

  app.post('/base_path', async (req, res) => {
    const {base_path} = req.body;
    if (typeof base_path !== 'string') {
        // Redirect to /settings page with error and hash
        return res.redirect(`/settings?error=${encodeURIComponent('Invalid base_path provided.')}#base-path-settings`);
    }
    const change = args.updateBasePath(base_path, {before: [
      () => Archivist.beforePathChanged(base_path)
    ]});

    if ( change ) {
      await Archivist.afterPathChanged();
      if (Server) {
        Server.close(async () => {
          running = false;
          console.log(`Server closed for base_path change.`);
          await sleep(50);
          start({server_port:port});
          console.log(`Server restarting with new base_path.`);
        });
      } else {
          console.log(`Server was not running. Attempting to start with new base_path.`);
          await sleep(50);
          start({server_port:port});
      }
      // Redirect to /settings page with hash
      res.redirect('/settings#base-path-settings');
    } else {
      // Redirect to /settings page with hash
      res.redirect('/settings#base-path-settings');
    }
  });

  app.post('/crawl', async (req, res) => {
    try {
      let {
        links, timeout, depth, saveToFile, 
        maxPageCrawlTime, minPageCrawlTime, batchSize,
        program,
      } = req.body;

      const oTimeout = timeout;
      timeout = Math.round(parseFloat(timeout)*1000);
      depth = Math.round(parseInt(depth));
      batchSize = Math.round(parseInt(batchSize));
      saveToFile = !!(saveToFile && saveToFile !== 'false');
      minPageCrawlTime = Math.round(parseInt(minPageCrawlTime)*1000);
      maxPageCrawlTime = Math.round(parseInt(maxPageCrawlTime)*1000);

      if ( Number.isNaN(timeout) || timeout < 0 ||
           Number.isNaN(depth) || depth < 0 ||
           typeof links !== 'string' ) {
        console.warn({invalid_crawl_params:{timeout,depth,links}});
        throw new RichError({
          status: 400, 
          message: 'Invalid parameters: timeout, depth or links must be valid and non-negative.'
        });
      }

      const urls = links.split(/[\n\s\r]+/g)
        .map(u => u.trim())
        .filter(u => {
          if (u.length === 0 || u.length > MAX_REAL_URL_LENGTH) return false;
          try {
            new URL(u);
            return true;
          } catch { return false; }
        }).map(url => ({url,depth:1}));

      if (urls.length === 0) {
        throw new RichError({
            status: 400,
            message: 'No valid URLs provided for crawling.'
        });
      }
      
      console.log(`Starting crawl from ${urls.length} URLs, waiting ${oTimeout} seconds for each to load, and continuing to a depth of ${depth} clicks...`); 
      startCrawl({
        urls, timeout, depth, saveToFile, batchSize, minPageCrawlTime, maxPageCrawlTime, program,
      }).catch(crawlError => {
          console.error("Error during background crawl process:", crawlError);
      });
      // Redirect to /settings page with hash
      res.redirect('/settings#crawl-form');
    } catch(e) {
      let errorMessage = 'An unexpected error occurred during crawl setup.';
      if ( e instanceof RichError ) { 
        console.warn(e);
        try {
            const parsedError = JSON.parse(e.message);
            errorMessage = parsedError.message || errorMessage;
        } catch { /* Use default error message */ }
      } else {
        console.warn(e);
      }
      // Redirect to /settings page with error and hash
      return res.redirect(`/settings?error=${encodeURIComponent(errorMessage)}#crawl-form`);
    }
  });

  app.get(/^\/.*/, async (req, res) => {
    const requestedPath = (req?.params?.path || req.path).slice(1);
    DEBUG.verbose && console.log({requestedPath});
    const file = requestedPath === '' ? 'index.html' : requestedPath; // Should be archive_index.html due to root redirect
    
    if (file === 'style.css') {
      if ( sea.isSea() ) {
        try {
            const asset = await sea.getAsset('style.css');
            res.type('css').send(Buffer.from(asset));
            return;
        } catch (e) {
            console.warn(`Failed to load style.css from SEA:`, e);
        }
      }
    }

    let asset;
    if ( sea.isSea() ) {
      try {
        asset = await sea.getAsset(file);
      } catch(e) {
        if (!file.endsWith('.html')) {
            try {
                asset = await sea.getAsset(file + '.html');
            } catch (e2) { /* console.warn for debugging */ }
        } else { /* console.warn for debugging */ }
      }
    } else {
      asset = fs.readFileSync(path.resolve(SITE_PATH, file));
    }

    if ( asset ) {
      const type = path.extname(file).slice(1) || 'html';
      res.type(type);
      let data = Buffer.from(asset);
      if (['html', 'js', 'css', 'json', 'txt', 'xml', 'svg'].includes(type)) {
        data = data.toString('utf8');
      } 
      res.send(data);
    } else {
      // If root path ('') falls through, it means /archive_index.html wasn't found in SEA
      // or another specific handler like /settings wasn't found.
      if (requestedPath === '' || file === 'archive_index.html' || file === 'settings') {
          console.error(`Error: SEA handler reached for a primary path (${file}), but it should have been handled or found.`);
          res.status(404).send(`Primary application asset not found in SEA: ${file}`);
      } else {
          res.status(404).send(`Asset not found in SEA: ${file}`);
      }
    }
  });
}

async function stop() {
  let resolve;
  const pr = new Promise(res => resolve = res);
  console.log(`Closing library server...`);
  if ( Server ) {
    Server.close((err) => {
      if (err) console.error("Error closing library server:", err);
      else console.log(`Library server closed.`);
      running = false; Server = null; resolve();
    });
  } else {
    console.log(`Library server was not running or already closed.`);
    running = false; resolve();
  }
  return pr;
}

// --- MainApplicationView (for /settings page) ---
function MainApplicationView() {
  const currentBasePath = args.getBasePath();
  const currentMode = Archivist.getMode();

  const content = `
    <aside class="page-sidebar">
      <h3>Settings Sections</h3>
      <nav class="sidebar-nav" aria-label="Settings sections">
        <ul>
          <li><a href="#crawl-form" data-section="crawl-form">New Crawl</a></li>
          <li><a href="#mode-settings" data-section="mode-settings">Archivist Mode</a></li>
          <li><a href="#base-path-settings" data-section="base-path-settings">Library Base Path</a></li>
        </ul>
      </nav>
    </aside>

    <div class="main-content-area">
      <section id="crawl-form" aria-labelledby="crawl-form-legend" class="active-section">
        <form method="POST" action="/crawl">
          <fieldset>
            <legend id="crawl-form-legend">Start a New Crawl</legend>
            <div class="form-group">
              <label for="links">Enter URLs (one per line):</label>
              <textarea id="links" name="links" rows="5" required placeholder="https://example.com\nhttps://another.example.org"></textarea>
            </div>
            <div class="form-group">
              <label for="depth">Crawl Depth:</label>
              <input type="number" id="depth" name="depth" value="1" min="0" required>
              <small>0 for current page only, 1 for one level of links, etc.</small>
            </div>
            <div class="form-group">
              <label for="timeout">Page Load Timeout (seconds):</label>
              <input type="number" id="timeout" name="timeout" value="30" min="1" step="0.1" required>
            </div>
            <div class="form-group">
              <label for="minPageCrawlTime">Min Page Crawl Time (seconds):</label>
              <input type="number" id="minPageCrawlTime" name="minPageCrawlTime" value="1" min="0" step="1" required>
            </div>
            <div class="form-group">
              <label for="maxPageCrawlTime">Max Page Crawl Time (seconds):</label>
              <input type="number" id="maxPageCrawlTime" name="maxPageCrawlTime" value="60" min="1" step="1" required>
            </div>
            <div class="form-group">
              <label for="batchSize">Batch Size (pages per batch):</label>
              <input type="number" id="batchSize" name="batchSize" value="5" min="1" required>
            </div>
            <div class="form-group">
              <label for="program">Crawl Program (optional):</label>
              <input type="text" id="program" name="program" placeholder="e.g., my_custom_script.js">
            </div>
            <div class="form-group" style="display: flex; align-items: center;">
              <input type="checkbox" id="saveToFile" name="saveToFile" value="true" checked style="width: auto; margin-right: var(--spacing-sm);">
              <label for="saveToFile" style="display: inline-block; margin-bottom: 0; font-weight: normal;">Save to File (MHTML)</label>
            </div>
            <button type="submit">Start Crawl</button>
          </fieldset>
        </form>
      </section>

      <section id="mode-settings" aria-labelledby="mode-settings-legend">
        <form method="POST" action="/mode">
          <fieldset>
            <legend id="mode-settings-legend">Archivist Mode</legend>
            <div class="form-group">
              <label for="mode">Current Mode: <strong>${currentMode}</strong>. Select new mode:</label>
              <select id="mode" name="mode">
                <option value="record" ${currentMode === 'record' ? 'selected' : ''}>Record Mode</option>
                <option value="replay" ${currentMode === 'replay' ? 'selected' : ''}>Replay Mode</option>
                <option value="live" ${currentMode === 'live' ? 'selected' : ''}>Live Mode</option>
              </select>
            </div>
            <button type="submit">Set Mode</button>
          </fieldset>
        </form>
      </section>

      <section id="base-path-settings" aria-labelledby="base-path-settings-legend">
        <form method="POST" action="/base_path">
          <fieldset>
            <legend id="base-path-settings-legend">Library Base Path</legend>
            <div class="form-group">
              <label for="base_path">Current Path: <code>${currentBasePath}</code>. Enter new path:</label>
              <input type="text" id="base_path" name="base_path" value="${currentBasePath}" required>
              <small>Set the root directory for storing archives. Server will restart if changed.</small>
            </div>
            <button type="submit">Update Base Path</button>
          </fieldset>
        </form>
      </section>
    </div> 
    <script>
      document.addEventListener('DOMContentLoaded', () => {
        const sidebarLinks = document.querySelectorAll('.sidebar-nav a[data-section]');
        const contentSections = document.querySelectorAll('.main-content-area > section');
        
        function setActiveSection(sectionId) {
          let sectionFound = false;
          sidebarLinks.forEach(link => {
            link.classList.toggle('active', link.dataset.section === sectionId);
          });
          contentSections.forEach(section => {
            const isActive = section.id === sectionId;
            section.classList.toggle('active-section', isActive);
            if (isActive) sectionFound = true;
          });
          if (!sectionFound && contentSections.length > 0) {
             contentSections[0].classList.add('active-section');
             if(sidebarLinks.length > 0) sidebarLinks[0].classList.add('active');
          }
        }

        sidebarLinks.forEach(link => {
          link.addEventListener('click', (event) => {
            const sectionId = event.currentTarget.dataset.section;
            setActiveSection(sectionId);
            if (history.pushState) {
                 history.pushState(null, null, '#' + sectionId);
            } else {
                 window.location.hash = sectionId;
            }
          });
        });

        const urlParams = new URLSearchParams(window.location.search);
        const generalError = urlParams.get('error');
        let initialSectionId = window.location.hash.substring(1);

        if (generalError && initialSectionId) {
          const targetSection = document.getElementById(initialSectionId);
          if (targetSection) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'form-error-message';
            errorDiv.textContent = 'Error: ' + decodeURIComponent(generalError);
            const formInErrorSection = targetSection.querySelector('form');
            if (formInErrorSection) {
                formInErrorSection.insertBefore(errorDiv, formInErrorSection.firstChild);
            } else {
                targetSection.insertBefore(errorDiv, targetSection.firstChild);
            }
          }
        }
        
        if (!initialSectionId && sidebarLinks.length > 0) {
            initialSectionId = sidebarLinks[0].dataset.section;
        }
        setActiveSection(initialSectionId);

        if (window.location.hash) {
          setTimeout(() => {
            try {
              const targetElement = document.querySelector(window.location.hash);
              if (targetElement) {
                targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            } catch (e) { console.warn('Invalid hash for scrolling:', window.location.hash); }
          }, 100);
        }
      });
    </script>
  `;
  // Use layoutType: 'sidebar' and currentNav: 'settings' for this specific view
  return PageLayout({ title: 'Crawl & Settings', content, currentNav: 'settings', layoutType: 'sidebar' });
}


// --- IndexView ---
function IndexView(urls, {edit = false} = {}) {
  const pageTitle = edit ? 'Edit Your HTML Library Index' : 'Your HTML Library Index';
  const content = `
    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--spacing-md); margin-bottom: var(--spacing-lg);">
      <h2 class="page-title" style="margin-bottom: 0;">${pageTitle}</h2>
      <div class="edit-toggle-section" style="margin-bottom: 0;">
        <form method="GET" action="${edit ? '/archive_index.html' : '/edit_index.html'}">
          <button type="submit" class="button secondary">
            ${edit ? '✓ View Index' : '✎ Edit Index'}
          </button>
        </form>
      </div>
    </div>
    
    <form method="GET" action="/search" class="mb-0">
      <fieldset>
        <legend>Search Your Archive</legend>
        <div class="input-group">
          <input autofocus type="search" name="query" placeholder="Enter search terms...">
          <button type="submit">Search</button>
        </div>
      </fieldset>
    </form>

    ${urls.length === 0 ? '<p style="margin-top: var(--spacing-lg); text-align: center;">Your index is currently empty. Start a crawl to add items!</p>' : ''}
    <ul class="item-list">
    ${
      urls.map(([url,{title, id}]) => `
        <li>
          ${ DEBUG ? `<small class="debug-info">ID: ${id}</small>` : ''} 
          <h3 class="item-title"><a target="_blank" href="${url}" rel="noopener noreferrer">${(title || url).slice(0, MAX_HEAD)}</a></h3>
          <small class="item-url"><a target="_blank" href="${url}" rel="noopener noreferrer">${url.slice(0, MAX_HEAD)}</a></small>
          ${ edit ? `
          <div class="item-actions">
            <form class="delete-form" method="POST" action="/edit_index.html">
              <input name="url_to_delete" type="hidden" value="${url}">
              <button type="button" class="delete-button" title="Delete this item" onclick="confirmDelete(event);">
                🗑️ Delete
              </button>
            </form>
          </div>
          ` : ''}
        </li>
      `).join('\n')
    }
    </ul>
    ${ edit ? `
    <script>
      const sleep = ms => new Promise(res => setTimeout(res, ms));
      async function confirmDelete(event) {
        const button = event.currentTarget;
        const form = button.closest('form');
        const listItem = button.closest('li');
        const linkElement = listItem.querySelector('.item-title a');
        
        button.disabled = true;
        const originalTextDecoration = linkElement.style.textDecoration;
        linkElement.classList.add('strikethrough');
        
        let {host} = new URL(form.url_to_delete.value);
        host = host.replace(/^www\\./i, '');
        
        await sleep(100);
        
        const reallyDelete = confirm(
          \`Are you sure you want to delete this item from the index and search?\\n\\n  \${host} \n\\nThis action cannot be undone easily.\`
        );
        
        if (reallyDelete) {
          form.submit();
        } else {
          linkElement.classList.remove('strikethrough');
          linkElement.style.textDecoration = originalTextDecoration;
          button.disabled = false;
        }
      }
    </script>
    ` : ''}
  `;
  // Uses default layout and currentNav: 'index'
  return PageLayout({ title: pageTitle, content, currentNav: 'index' });
}

// --- SearchResultView ---
function SearchResultView({results, query, HL, page, hasMore = false}) {
  const pageTitle = query ? `Search Results for "${query}"` : "Search Archive";
  const content = `
    <h2 class="page-title">${pageTitle}</h2>
    <form method="GET" action="/search" class="mb-0">
      <fieldset>
        <legend>Search Your Archive</legend>
        <div class="input-group">
          <input autofocus type="search" name="query" placeholder="Enter search terms..." value="${query || ''}">
          <button type="submit">Search</button>
        </div>
      </fieldset>
    </form>

    ${query && results.length === 0 ? '<p style="margin-top: var(--spacing-lg); text-align: center;">No results found for your query.</p>' : ''}
    ${!query && results.length === 0 ? '<p style="margin-top: var(--spacing-lg); text-align: center;">Please enter a search term above to begin.</p>' : ''}


    ${results.length > 0 ? `
    <p style="margin-top: var(--spacing-lg);">Showing results for: <strong>${query}</strong></p>
    <ol class="item-list" start="${(page-1)*args.results_per_page+1}">
    ${
      results.map(({snippet, url, title, id}) => `
        <li>
          ${DEBUG ? `<small class="debug-info">ID: ${id}</small>` : ''}
          <h3 class="item-title">
            <a target="_blank" href="${url}" rel="noopener noreferrer">${
              HL.get(id)?.title || (title || url || '').slice(0, MAX_HEAD)
            }</a>
          </h3>
          <small class="item-url">
            <a target="_blank" href="${url}" rel="noopener noreferrer">${
              HL.get(id)?.url || (url || '').slice(0, MAX_HEAD)
            }</a>
          </small>
          ${snippet ? `<p class="item-snippet">${snippet}</p>` : ''}
        </li>
      `).join('\n')
    }
    </ol>
    ` : ''}

    ${(results.length > 0 || page > 1) ? `
    <nav class="pagination" aria-label="Search results pagination">
      ${page > 1 ? `
      <a href="/search?query=${encodeURIComponent(query)}&page=${encodeURIComponent(page-1)}">
        « Previous
      </a>` : `<span class="disabled">« Previous</span>`}
      
      <span aria-current="page">Page ${page}</span>
      
      ${hasMore ? `
      <a href="/search?query=${encodeURIComponent(query)}&page=${encodeURIComponent(page+1)}">
        Next »
      </a>` : `<span class="disabled">Next »</span>`}
    </nav>
    ` : ''}
  `;
  // Uses default layout and currentNav: 'search'
  return PageLayout({ title: `Search: ${query || 'Archive'}`, content, currentNav: 'search' });
}

import fs from 'fs';
import {parseStringPromise} from 'xml2js';

start();
async function start() {
 const data = await parseStringPromise(fs.readFileSync('sitemap.xml').toString());
 const rows = data.urlset.url;
 rows.sort(({lastmod:[a]},{lastmod:[b]}) => (new Date(b)).getTime() - (new Date(a)).getTime());
 const urls = rows.map(({loc:[href]}) => href);
 fs.writeFileSync('urls.json', JSON.stringify(urls,null,2));
}

import {bookmarkChanges} from './src/bookmarker.js';

start();

async function start() {
  for await ( const change of bookmarkChanges() ) {
    console.log(change);
  }
}

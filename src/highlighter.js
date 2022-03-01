import ukkonen from 'ukkonen';
import {DEBUG} from './common.js';

const MAX_ACCEPT_SCORE = 0.5;
const CHUNK_SIZE = 12;

//testHighlighter();

function params(qLength, chunkSize = CHUNK_SIZE) {
  const MaxDist = chunkSize;
  const MinScore = Math.abs(qLength - chunkSize);
  const MaxScore = Math.max(qLength, chunkSize) - MinScore;
  return {MaxDist,MinScore,MaxScore};
}

export function highlight(query, doc, {
  /* 0 is no maxLength */
  maxLength: maxLength = 0,
  maxAcceptScore: maxAcceptScore = MAX_ACCEPT_SCORE,
  chunkSize: chunkSize = CHUNK_SIZE
} = {}) {
  if ( chunkSize % 2 ) {
    throw new TypeError(`chunkSize must be even. Was: ${chunkSize} which is odd.`);
  }
  doc = Array.from(doc);
  if ( maxLength ) {
    doc = doc.slice(0, maxLength);
  }
  const highlights = [];
  const extra = chunkSize;
  // use array from then length rather than string length to 
  // give accurate length for all unicode
  const qLength = Array.from(query).length;
  const {MaxDist,MinScore,MaxScore} = params(qLength, chunkSize);
  const doc2 = Array.from(doc);
  // make doc length === 0 % chunkSize
  doc.splice(doc.length, 0, ...(new Array((chunkSize - doc.length % chunkSize) % chunkSize)).join(' ').split(''));
  const fragments = doc.reduce(getFragmenter(chunkSize), []);
  //console.log(fragments);
  // pad start of doc2 by half chunkSize
  doc2.splice(0, 0, ...(new Array(chunkSize/2 + 1)).join(' ').split(''));
  // make doc2 length === 0 % chunkSize
  doc2.splice(doc2.length, 0, ...(new Array((chunkSize - doc2.length % chunkSize) % chunkSize)).join(' ').split(''));
  const fragments2 = doc2.reduce(getFragmenter(chunkSize), []);  
  query.toLocaleLowerCase();
  DEBUG && console.log(fragments);

  const scores = [...fragments, ...fragments2].map(fragment => {
    const distance = ukkonen(query, fragment.text.toLocaleLowerCase(), MaxDist);
    // the min score possible = the minimum number of edits between 
    const scaledScore = (distance - MinScore)/MaxScore;
    return {score: scaledScore, fragment};
  });

  // sort ascending (smallest scores win)
  scores.sort(({score:a}, {score:b}) => a-b);

  for( const {score, fragment} of scores ) {
    if ( score > maxAcceptScore ) {
      break;
    }
    highlights.push({score,fragment});
  }

  let result;

  if ( highlights.length === 0 ) {
    DEBUG && console.log('Zero highlights, showing first score', scores[0]);
    result = scores.slice(0,1);
  } else {
    let better = Array.from(highlights).slice(0, 10);
    better = better.map(hl => {
      const length = Array.from(hl.fragment.text).length;
      let {offset, symbols} = hl.fragment;
      const newText = symbols.slice(Math.max(0,offset - extra), offset).join('') + hl.fragment.text + symbols.slice(offset + length, offset + length + extra).join('');
      DEBUG && console.log({newText, oldText:hl.fragment.text, p:[Math.max(0,offset-extra), offset, offset+length, offset+length+extra], trueText: symbols.slice(offset, offset+length).join('')});
      hl.fragment.text = newText;
      const {MaxDist,MinScore,MaxScore} = params(Array.from(newText).length);
      const distance = ukkonen(query, hl.fragment.text.toLocaleLowerCase(), MaxDist);
      // the min score possible = the minimum number of edits between 
      const scaledScore = (distance - MinScore)/MaxScore;
      hl.score = scaledScore;
      return hl;
    });
    better.sort(({score:a}, {score:b}) => a-b);
    DEBUG && console.log(JSON.stringify({better},null,2));
    result = better.slice(0,3);
  }

  return result;
}

// use overlapping trigrams to index
export function trilight(query, doc, {
  /* 0 is no maxLength */
  maxLength: maxLength = 0,
  ngramSize: ngramSize = 3,
  /*minSegmentGap: minSegmentGap = 20,*/
  maxSegmentSize: maxSegmentSize = 140,
} = {}) {
  query = Array.from(query);
  const oDoc = Array.from(doc);
  doc = Array.from(doc.toLocaleLowerCase());
  if ( maxLength ) {
    doc = doc.slice(0, maxLength);
  }

  const trigrams = doc.reduce(getFragmenter(ngramSize, {overlap:true}), []);
  const index = trigrams.reduce((idx, frag) => {
    let counts = idx.get(frag.text);
    if ( ! counts ) {
      counts = [];
      idx.set(frag.text, counts);
    }
    counts.push(frag.offset);
    return idx;
  }, new Map);
  const qtris = query.reduce(getFragmenter(ngramSize, {overlap:true}), []);
  const entries = qtris.reduce((E, {text}, qi) => {
    const counts = index.get(text);
    if ( counts ) {
      counts.forEach(di => {
        const entry = {text, qi, di};
        E.push(entry);
      });
    }
    return E;
  }, []);
  entries.sort(({di:a}, {di:b}) => a-b);
  let lastQi;
  let lastDi;
  let run;
  const runs = entries.reduce((R, {text,qi,di}) => {
    if ( ! run ) {
      run = {
        tris: [text],
        qi, di
      };
    } else {
      const dQi = qi - lastQi; 
      const dDi = di - lastDi;
      if ( dQi === 1 && dDi === 1 ) {
        run.tris.push(text);
      } else {
        /* add two for the size 2 suffix of the final trigram */
        run.length = run.tris.length + (ngramSize - 1); 
        R.push(run);
        run = {
          qi, di, 
          tris: [text]
        };
      }
    }
    lastQi = qi;
    lastDi = di;
    return R;
  }, []);
  let lastRun;
  const gaps = runs.reduce((G, run) => {
    if ( lastRun ) {
      const gap = {runs: [lastRun, run], gap: run.di - (lastRun.di + lastRun.length)};
      G.push(gap);
    }
    lastRun = run;
    return G;
  }, []);
  gaps.sort(({gap:a}, {gap:b}) => a-b);
  const segments = [];
  const runSegMap = {};
  while(gaps.length) {
    const nextGap = gaps.shift();
    const {runs} = nextGap;
    const leftSeg = runSegMap[runs[0].di];
    const rightSeg = runSegMap[runs[1].di];
    let newSegmentLength = 0;
    let assigned = false;
    if ( leftSeg ) {
      newSegmentLength = runs[1].di + runs[1].length - leftSeg.start;
      if ( newSegmentLength <= maxSegmentSize ) {
        leftSeg.end = runs[1].di + runs[1].length;
        leftSeg.score += runs[1].length;
        runSegMap[runs[1].di] = leftSeg;
        assigned = leftSeg;
      }
    } else if ( rightSeg ) {
      newSegmentLength = rightSeg.end - runs[0].di;
      if ( newSegmentLength <= maxSegmentSize ) {
        rightSeg.start = runs[0].di;
        rightSeg.score += runs[0].length;
        runSegMap[runs[0].di] = rightSeg;
        assigned = rightSeg;
      }
    } else {
      const newSegment = {
        start: runs[0].di,
        end: runs[0].di + runs[0].length + nextGap.gap + runs[1].length,
        score: runs[0].length + runs[1].length
      };
      if ( newSegment.end - newSegment.start <= maxSegmentSize ) {
        runSegMap[runs[0].di] = newSegment;
        runSegMap[runs[1].di] = newSegment;
        segments.push(newSegment);
        assigned = newSegment;
        newSegmentLength = newSegment.end - newSegment.start;
      }
    }
    if ( assigned ) {
      DEBUG && console.log('Assigned ', nextGap, 'to segment', assigned, 'now having length', newSegmentLength);
    } else {
      DEBUG && console.log('Gap ', nextGap, `could not be assigned as it would have made an existing 
        as it would have made an existing segment too long, or it was already too long itself.`
      );
    }
  }
  segments.sort(({score:a}, {score:b}) => b-a);
  const textSegments = segments.map(({start,end}) => oDoc.slice(start,end).join(''));
  //console.log(JSON.stringify({gaps}, null, 2));
  DEBUG && console.log(segments, textSegments);

  if ( textSegments.length === 0 ) {
    DEBUG && console.log({query, doc, maxLength, ngramSize, maxSegmentSize, 
      trigrams,
      index,
      entries,
      runs,
      gaps,
      segments,
      textSegments
    });
  }

  return textSegments.slice(0,3);
}

// returns a function that creates non-overlapping fragments
function getFragmenter(chunkSize, {overlap: overlap = false} = {}) {
  if ( !Number.isInteger(chunkSize) || chunkSize < 1 ) {
    throw new TypeError(`chunkSize needs to be a whole number greater than 0`);
  }

  let currentLength;

  return function fragment(frags, nextSymbol, index, symbols) {
    const pushBack = [];
    let currentFrag;
    // logic:
      // if there are no running fragments OR
      // adding the next symbol would exceed chunkSize
      // then start a new fragment OTHERWISE
      // keep adding to the currentFragment
    if ( overlap || (frags.length && ((currentLength + 1) <= chunkSize)) ) {
      let count = 1;
      if ( overlap ) {
        count = Math.min(index+1, chunkSize);
        currentFrag = {text:'', offset:index, symbols};
        frags.push(currentFrag);
      }
      while(count--) {
        currentFrag = frags.pop();
        //console.log({frags,nextSymbol,index,currentFrag});
        pushBack.push(currentFrag);
        currentFrag.text += nextSymbol;
      }
    } else {
      currentFrag = {text:nextSymbol, offset:index, symbols};
      currentLength = 0;
      pushBack.push(currentFrag);
    }
    currentLength++;
    while(pushBack.length) {
      frags.push(pushBack.pop());
    }
    return frags;
  }
}

// returns a function that creates overlapping fragments
// todo - try this one as well


// tests
  /*
    function testHighlighter() {
      const query = 'metahead search';
      const doc = `
            Hacker News new | past | comments | ask | show | jobs | submit 	login
          1. 	
            AWS appears to be down again
            417 points by riknox 2 hours ago | hide | 260 comments
          2. 	
            FreeBSD Jails for Fun and Profit (topikettunen.com)
            42 points by kettunen 1 hour ago | hide | discuss
          3. 	
            IMF, 10 countries simulate cyber attack on global financial system (nasdaq.com)
            33 points by pueblito 1 hour ago | hide | 18 comments
          4. 	
            DNA seen through the eyes of a coder (berthub.eu)
            116 points by dunefox 3 hours ago | hide | 37 comments
          5. 	
            Pure Bash lightweight web server (github.com/remileduc)
            74 points by turrini 2 hours ago | hide | 46 comments
          6. 	
            Parser Combinators in Haskell (serokell.io)
            18 points by aroccoli 1 hour ago | hide | 3 comments
          7. 	
            DeepMind’s New AI with a Memory Outperforms Algorithms 25 Times Its Size (singularityhub.com)
            233 points by darkscape 9 hours ago | hide | 88 comments
          8. 	
            Tinder just permabanned me or the problem with big tech (paulefou.com)
            90 points by svalee 1 hour ago | hide | 106 comments
          9. 	
            Rocky Mountain Basic (wikipedia.org)
            12 points by mattowen_uk 1 hour ago | hide | 5 comments
          10. 	
            Teller Reveals His Secrets (2012) (smithsonianmag.com)
            56 points by Tomte 4 hours ago | hide | 26 comments
          11. 	
            Heroku Is Currently Down (heroku.com)
            129 points by iamricks 2 hours ago | hide | 29 comments
          12. 		Convictional (YC W19) is hiring engineers to build the future of B2B trade-Remote (ashbyhq.com)
            2 hours ago | hide
          13. 	
            Scientists find preserved dinosaur embryo preparing to hatch like a bird (theguardian.com)
            187 points by Petiver 9 hours ago | hide | 111 comments
          14. 	
            I did a Mixergy interview so bad they didn't even release it (robfitz.com)
            15 points by robfitz 1 hour ago | hide | 7 comments
          15. 	
            Now DuckDuckGo is building its own desktop browser (zdnet.com)
            132 points by waldekm 2 hours ago | hide | 64 comments
          16. 	
            English has been my pain for 15 years (2013) (antirez.com)
            105 points by Tomte 1 hour ago | hide | 169 comments
          17. 	
            Polish opposition duo hacked with NSO spyware (apnews.com)
            102 points by JumpCrisscross 2 hours ago | hide | 35 comments
          18. 	
            Linux Has Grown into a Viable PC Gaming Platform and the Steam Stats Prove It (hothardware.com)
            119 points by rbanffy 3 hours ago | hide | 105 comments
          19. 	
            LG’s new 16:18 monitor (theverge.com)
            50 points by tosh 1 hour ago | hide | 25 comments
          20. 	
            Construction of radio equipment in a Japanese PoW camp (bournemouth.ac.uk)
            117 points by marcodiego 9 hours ago | hide | 16 comments
          21. 	
            Everything I've seen on optimizing Postgres on ZFS (vadosware.io)
            27 points by EntICOnc 4 hours ago | hide | 2 comments
          22. 	
            Microsoft Teams: 1 feature, 4 vulnerabilities (positive.security)
            269 points by kerm1t 4 hours ago | hide | 196 comments
          23. 	
            Analog computers were the most powerful computers for thousands of years [video] (youtube.com)
            103 points by jdkee 9 hours ago | hide | 55 comments
          24. 	
            Shipwrecks, Stolen Jewels, Skull-Blasting Are Some of This Year’s Best Mysteries (atlasobscura.com)
            8 points by CapitalistCartr 1 hour ago | hide | 1 comment
          25. 	
            Isolating Xwayland in a VM (roscidus.com)
            94 points by pmarin 9 hours ago | hide | 32 comments
          26. 	
            Show HN: Metaheads, a search engine for Facebook comments (metaheads.xyz)
            4 points by jawerty 1 hour ago | hide | 15 comments
          27. 	
            Quantum theory based on real numbers can be experimentally falsified (nature.com)
            159 points by SquibblesRedux 14 hours ago | hide | 93 comments
          28. 	
            Founder of Black Girls Code has been ousted as head of the nonprofit (businessinsider.com)
            29 points by healsdata 1 hour ago | hide | 7 comments
          29. 	
            Waffle House Poet Laureate (2019) (atlantamagazine.com)
            5 points by brudgers 1 hour ago | hide | 4 comments
          30. 	
            Earth’s magnetic field illuminates Biblical history (economist.com)
            46 points by helsinkiandrew 8 hours ago | hide | 17 comments
            More
        `;

      console.log(JSON.stringify(highlight(
        query, doc
      ).map(({fragment:{text,offset}}) => offset + ':' + text), null, 2));
      console.log(trilight('metahead search', doc.toLocaleLowerCase().replace(/\s+/g, ' ')));
    }
  */

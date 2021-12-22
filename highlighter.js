import ukkonen from 'ukkonen';

const MAX_ACCEPT_SCORE = 0.5;
const CHUNK_SIZE = 24;

testHighlighter();

export function highlight(query, doc, {
  maxAcceptScore: maxAcceptScore = MAX_ACCEPT_SCORE
} = {}) {
  const MaxDist = CHUNK_SIZE;
  const highlights = [];
  // use array from then length rather than string length to 
  // give accurate length for all unicode
  const qLength = Array.from(query).length;
  const MinScore = Math.abs(qLength - CHUNK_SIZE);
  const MaxScore = Math.max(qLength, CHUNK_SIZE) - MinScore;

  const fragments = Array.from(doc).reduce(getFragmenter(CHUNK_SIZE), []);

  const scores = fragments.map(fragment => {
    const distance = ukkonen(query, fragment, MaxDist);
    // the min score possible = the minimum number of edits between 
    const scaledScore = (distance - MinScore)/MaxScore;
    return {score: scaledScore, fragment};
  });

  // sort ascending (smallest scores win)
  scores.sort(({score:a}, {score:b}) => a-b);
  console.log({scores});

  for( const {score, fragment} of scores ) {
    if ( score > maxAcceptScore ) {
      break;
    }
    highlights.push({score,fragment});
  }

  if ( highlights.length === 0 ) {
    console.log('Zero highlights, showing first score', scores[0]);
  }

  return highlights;
}

// returns a function that creates non-overlapping fragments
function getFragmenter(chunkSize) {
  if ( !Number.isInteger(chunkSize) || chunkSize < 1 ) {
    throw new TypeError(`chunkSize needs to be a whole number greater than 0`);
  }

  let currentLength;

  return function fragment(frags, nextSymbol, index, symbols) {
    let currentFrag;
    // logic:
      // if there are no running fragments OR
      // adding the next symbol would exceed chunkSize
      // then start a new fragment OTHERWISE
      // keep adding to the currentFragment
    if ( frags.length && ((currentLength + 1) <= chunkSize) ) {
      currentFrag = frags.pop();
      currentFrag += nextSymbol;
    } else {
      currentFrag = nextSymbol;
      currentLength = 0;
    }
    currentLength++;
    frags.push(currentFrag);
    return frags;
  }
}

// returns a function that creates overlapping fragments
// todo - try this one as well


// tests
function testHighlighter() {
  console.log(JSON.stringify(highlight(
		'metahead search',
    `
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
    `
  ), null, 2));
}

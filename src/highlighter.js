// highlighter.js

import ukkonen from 'ukkonen';
import {DEBUG} from './common.js';

const MAX_ACCEPT_SCORE = 0.5; // Default, can be overridden by options
const CHUNK_SIZE = 12; // Default, can be overridden by options

// --- calculateUkkonenParams (renamed from params for clarity) ---
function calculateUkkonenParams(queryLength, chunkSize = CHUNK_SIZE) {
  const maxDistance = chunkSize; 
  // A more flexible MaxDist could be:
  // const maxDistance = Math.min(chunkSize, Math.floor(queryLength * 0.4) + 1);

  const minPossibleScore = Math.abs(queryLength - chunkSize);
  let maxScoreRange = Math.max(queryLength, chunkSize) - minPossibleScore;
  if (maxScoreRange === 0) maxScoreRange = 1; // Avoid division by zero
  return {maxDistance, minPossibleScore, maxScoreRange};
}

// --- markText (helper for adding <mark> tags) ---
function markText(text, query) {
    if (!text || !query) return text;
    try {
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp('(' + escapedQuery + ')', 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    } catch (e) {
        console.warn("markText: Regex failed for query:", query, e);
        return text;
    }
}

export function highlight(query, docString, { // Renamed doc to docString for clarity
  maxLength = 0,
  maxAcceptScore = MAX_ACCEPT_SCORE, // Use the constant as default
  chunkSize = CHUNK_SIZE,         // Use the constant as default
  // around, before are effectively handled by internalMarkText
  numResults = 3,
  contextChars = 30
} = {}) {
  if (chunkSize % 2 !== 0 && chunkSize !== 1) {
     if ( chunkSize % 2 ) { // Original constraint
        console.warn(`highlight: chunkSize should ideally be even. Was: ${chunkSize}. Adjusting to ${chunkSize+1}`);
        chunkSize = chunkSize + 1;
     }
  }

  let docChars = Array.from(docString); // Work with array for Unicode safety
  if (maxLength > 0 && docChars.length > maxLength) {
    docChars = docChars.slice(0, maxLength);
  }

  if (docChars.length === 0 || query.trim() === "") {
    return [];
  }

  const queryLower = query.toLocaleLowerCase(); // Lowercase query once for consistency
  const queryCharsArray = Array.from(queryLower); // For Ukkonen distance
  const queryOriginalCase = query; // Keep original case for marking if needed, though markText is case-insensitive
  const qLength = queryCharsArray.length;

  if (qLength === 0) return [];

  // --- Fragment Generation: Overlapping Chunks ---
  const fragments = [];
  const step = Math.max(1, Math.floor(chunkSize / 2)); 

  for (let i = 0; i <= docChars.length - chunkSize; i += step) {
    const fragmentTextChars = docChars.slice(i, i + chunkSize);
    fragments.push({
      text: fragmentTextChars.join(''), // Original case text for the chunk
      // textChars: fragmentTextChars, // Not strictly needed if we lowercase fragment.text directly
      offset: i,
    });
  }
  // Handle cases where doc is shorter than chunkSize or last partial chunk
   if (fragments.length === 0 && docChars.length > 0) { // Case: doc is shorter than chunkSize
        fragments.push({
            text: docChars.join(''),
            // textChars: [...docChars],
            offset: 0,
        });
    } else if (docChars.length > chunkSize) { // Ensure there's a last fragment if not perfectly divisible
        const lastProcessedOffset = fragments.length > 0 ? fragments[fragments.length-1].offset : -step;
        if (lastProcessedOffset + step < docChars.length - chunkSize) { // If there's a gap before the absolute end
            const finalFragmentStart = docChars.length - chunkSize;
            if (finalFragmentStart > lastProcessedOffset) { // Ensure it's a new fragment
                 const fragmentTextChars = docChars.slice(finalFragmentStart);
                 fragments.push({
                    text: fragmentTextChars.join(''),
                    // textChars: fragmentTextChars,
                    offset: finalFragmentStart,
                });
            }
        }
    }


  if (fragments.length === 0) return [];
  DEBUG.verboseSlow && console.log("Generated fragments:", fragments.length);

  // Use the renamed calculateUkkonenParams
  const { maxDistance, minPossibleScore, maxScoreRange } = calculateUkkonenParams(qLength, chunkSize);

  const scoredFragments = fragments.map(fragment => {
    const fragmentTextLower = fragment.text.toLocaleLowerCase(); // Lowercase here for comparison
    const distance = ukkonen(queryLower, fragmentTextLower, maxDistance);
    
    let scaledScore;
    if (distance === -1) {
        scaledScore = Infinity; 
    } else {
        // Using the simpler scaling: distance / query_length
        scaledScore = distance / Math.max(1, qLength); 
    }
    return { score: scaledScore, fragment }; // fragment is {text, offset}
  });

  scoredFragments.sort((a, b) => a.score - b.score);
  DEBUG.verboseSlow && console.log("Top 5 scored fragments:", scoredFragments.slice(0, 5).map(sf => ({s: sf.score, t: sf.fragment.text.substring(0,20)})));

  const bestHighlightsCandidates = [];
  const seenFragmentStartOffsets = new Set(); 

  for (const { score, fragment } of scoredFragments) {
    // Stop if we have enough distinct candidates for the final numResults
    if (bestHighlightsCandidates.length >= numResults) {
        // Optimization: if current score is much worse than last added, can break early
        if (bestHighlightsCandidates.length > 0 && score > bestHighlightsCandidates[bestHighlightsCandidates.length-1].score + 0.1) { // Heuristic
             break;
        }
        // Otherwise, continue to see if a slightly worse score might be from a very different location
    }

    if (score > maxAcceptScore) {
      if (bestHighlightsCandidates.length === 0 && score !== Infinity) { 
          // Allow if it's the only potential candidate, even if slightly over threshold
      } else {
          // If we already have some candidates, or if this score is terrible,
          // and we are trying to fill up to numResults, we might be more lenient
          // But if we already have numResults candidates, we can be stricter.
          if (bestHighlightsCandidates.length >= numResults) break; // Strict break if already have enough
          continue; // Otherwise, skip this one if too bad
      }
    }
    
    // Check for significant overlap with already selected highlights' core fragments
    let isTooOverlapping = false;
    for (const existingOffset of seenFragmentStartOffsets) {
        if (Math.abs(fragment.offset - existingOffset) < chunkSize) { // If core chunks are closer than one chunk size
            isTooOverlapping = true;
            break;
        }
    }
    if (isTooOverlapping) {
        continue;
    }

    bestHighlightsCandidates.push({ score, fragment });
    seenFragmentStartOffsets.add(fragment.offset);
  }
  
  DEBUG.verboseSlow && console.log("Filtered bestHighlightsCandidates (before context/marking):", bestHighlightsCandidates.length);

  // Fallback: if no candidates met criteria, take the absolute best one(s) if any exist
  if (bestHighlightsCandidates.length === 0 && scoredFragments.length > 0 && scoredFragments[0].score !== Infinity) {
    let count = 0;
    for (const sf of scoredFragments) {
        if (count < numResults && sf.score !== Infinity) {
            // Basic overlap check for fallback
            let tooClose = false;
            for(const bhc of bestHighlightsCandidates) {
                if(Math.abs(bhc.fragment.offset - sf.fragment.offset) < chunkSize) {
                    tooClose = true; break;
                }
            }
            if(!tooClose) {
                bestHighlightsCandidates.push(sf);
                count++;
            }
        } else {
            break;
        }
    }
    DEBUG.verboseSlow && console.log('No highlights passed filters, taking absolute best scored fragment(s). Count:', bestHighlightsCandidates.length);
  }

  // Construct final snippets from the chosen candidates
  const finalSnippets = bestHighlightsCandidates
    // Ensure we don't exceed numResults, even if fallback added more than initially desired due to relaxed overlap
    .slice(0, numResults) 
    .map(({ score, fragment }) => {
      const matchActualStart = fragment.offset;
      // fragment.text is the original chunk text, its length is chunkSize or less
      const matchActualEnd = fragment.offset + Array.from(fragment.text).length; 

      const contextStart = Math.max(0, matchActualStart - contextChars);
      const contextEnd = Math.min(docString.length, matchActualEnd + contextChars);
      
      let snippetTextWithContext = docString.substring(contextStart, contextEnd);

      // Mark the original query (not queryLower) within this expanded snippet
      snippetTextWithContext = markText(snippetTextWithContext, queryOriginalCase);

      return {
        // score, // Optionally include score for debugging or UI
        fragment: {
          text: snippetTextWithContext,
          offset: matchActualStart, 
        }
      };
    });
    
  DEBUG.verboseSlow && console.log("Final snippets to return:", finalSnippets.length);
  return finalSnippets;
}


// --- trilight function (and its helper getFragmenter) ---
// (Assuming trilight and getFragmenter are as you posted them,
//  and trilight also uses its numResults parameter to return multiple snippets)

function getFragmenter(chunkSize, {overlap = false, step = 1, symbolsArray = null, initialOffset = 0} = {}) {
  // This version of getFragmenter was from your "faithful refactor"
  // It's complex and its behavior for highlight (overlap=false) might differ from the simple loop.
  // For this "heavy revision" of highlight, we used a direct loop for fragment generation.
  // If trilight depends on this specific getFragmenter, it should be kept for trilight.
  // For clarity, highlight should use its own simpler fragment generation loop.

  // The getFragmenter you posted with the highlight function was:
  /*
    function getFragmenter(chunkSize, {overlap = false, step = 1} = {}) {
      if (!Number.isInteger(chunkSize) || chunkSize < 1) { //...}
      if (overlap) { // for ngrams
        return function ngramFragmenter(frags, _nextSymbol, index, symbols) { //... }
      } else { // for non-overlapping chunks
        return function chunkFragmenter(frags, _nextSymbol, index, symbols) { //... }
      }
    }
  */
  // This one is fine for trilight if it expects `reduce` behavior.
  // The `highlight` function above now has its own explicit loop for fragment generation.
  // So, this getFragmenter would only be for trilight.

  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new TypeError(`chunkSize needs to be a whole number greater than 0`);
  }
  if (!Number.isInteger(step) || step < 1) { // step is not used in this version of getFragmenter
    throw new TypeError(`step needs to be a whole number greater than 0`);
  }

  let currentFragmentCharCount; 

  return function fragmentReducer(fragmentsAccumulator, nextCharSymbol, charIndex, fullSymbolArray) {
    const effectiveSymbolsArray = symbolsArray || fullSymbolArray;
    const effectiveCharIndex = charIndex + initialOffset; 

    if (overlap) {
      if (charIndex <= fullSymbolArray.length - chunkSize) {
        const ngramChars = fullSymbolArray.slice(charIndex, charIndex + chunkSize);
        fragmentsAccumulator.push({
          text: ngramChars.join(''),
          offset: effectiveCharIndex, 
          symbols: effectiveSymbolsArray // trilight might need this if it refers to fragment.symbols
        });
      }
    } else { // Non-overlapping, for highlight's original reduce-based chunking
      if (fragmentsAccumulator.length === 0 || currentFragmentCharCount >= chunkSize) {
        fragmentsAccumulator.push({
          text: nextCharSymbol,
          offset: effectiveCharIndex, 
          symbols: effectiveSymbolsArray
        });
        currentFragmentCharCount = 1;
      } else {
        const currentFragment = fragmentsAccumulator[fragmentsAccumulator.length - 1];
        currentFragment.text += nextCharSymbol;
        currentFragmentCharCount++;
      }
    }
    return fragmentsAccumulator;
  };
}


export function trilight(query, docString, { // Renamed doc to docString
  maxLength = 0,
  ngramSize = 3,
  maxSegmentSize = 140,
  numResults = 3
} = {}) {
  const originalDocChars = Array.from(docString); 
  const queryCharsLower = Array.from(query.toLocaleLowerCase()); 
  const queryOriginalCase = query;
  
  let docCharsForProcessing = Array.from(docString.toLocaleLowerCase());
  if (maxLength > 0 && docCharsForProcessing.length > maxLength) {
    docCharsForProcessing = docCharsForProcessing.slice(0, maxLength);
  }

  if (docCharsForProcessing.length < ngramSize || queryCharsLower.length < ngramSize) {
    return [];
  }

  // Use the getFragmenter that was paired with your trilight
  const docNgrams = docCharsForProcessing.reduce(getFragmenter(ngramSize, {overlap: true, symbolsArray: originalDocChars}), []);
  const queryNgrams = queryCharsLower.reduce(getFragmenter(ngramSize, {overlap: true, symbolsArray: queryCharsLower }), []);


  if (docNgrams.length === 0 || queryNgrams.length === 0) return [];

  const docNgramIndex = new Map();
  docNgrams.forEach(ngram => {
    if (!docNgramIndex.has(ngram.text)) {
      docNgramIndex.set(ngram.text, []);
    }
    docNgramIndex.get(ngram.text).push(ngram.offset);
  });

  const matchingEntries = [];
  queryNgrams.forEach((queryNgram, queryNgramIndex) => {
    const docOffsetsForNgram = docNgramIndex.get(queryNgram.text);
    if (docOffsetsForNgram) {
      docOffsetsForNgram.forEach(docCharOffset => {
        matchingEntries.push({
          ngramText: queryNgram.text,
          queryNgramIndex: queryNgramIndex, 
          docCharOffset: docCharOffset    
        });
      });
    }
  });
  matchingEntries.sort((a, b) => a.docCharOffset - b.docCharOffset); 

  const runs = [];
  if (matchingEntries.length > 0) {
    let currentRun = {
      ngramsInRun: [matchingEntries[0].ngramText],
      startQueryNgramIndex: matchingEntries[0].queryNgramIndex,
      startDocCharOffset: matchingEntries[0].docCharOffset
    };
    let lastQueryNgramIndexInRun = matchingEntries[0].queryNgramIndex;
    let lastDocCharOffsetInRun = matchingEntries[0].docCharOffset;

    for (let i = 1; i < matchingEntries.length; i++) {
      const entry = matchingEntries[i];
      const queryIndexDiff = entry.queryNgramIndex - lastQueryNgramIndexInRun;
      const docOffsetDiff = entry.docCharOffset - lastDocCharOffsetInRun;

      if (queryIndexDiff === 1 && docOffsetDiff === 1) { 
        currentRun.ngramsInRun.push(entry.ngramText);
      } else {
        currentRun.charLengthInDoc = currentRun.ngramsInRun.length + (ngramSize - 1);
        runs.push(currentRun);
        currentRun = {
          ngramsInRun: [entry.ngramText],
          startQueryNgramIndex: entry.queryNgramIndex,
          startDocCharOffset: entry.docCharOffset
        };
      }
      lastQueryNgramIndexInRun = entry.queryNgramIndex;
      lastDocCharOffsetInRun = entry.docCharOffset;
    }
    currentRun.charLengthInDoc = currentRun.ngramsInRun.length + (ngramSize - 1);
    runs.push(currentRun);
  }
  
  DEBUG.verboseSlow && console.log("trilight: identified runs:", runs.length);

  const gaps = [];
  if (runs.length > 1) {
    for (let i = 0; i < runs.length - 1; i++) {
      const run1 = runs[i];
      const run2 = runs[i+1];
      gaps.push({
        connectedRuns: [run1, run2],
        gapSize: run2.startDocCharOffset - (run1.startDocCharOffset + run1.charLengthInDoc)
      });
    }
  }
  gaps.sort((a, b) => a.gapSize - b.gapSize); 

  const segments = [];
  const runToSegmentMap = new Map(); 

  runs.forEach(run => {
      if (run.charLengthInDoc <= maxSegmentSize) {
          const newSegment = {
              startOffset: run.startDocCharOffset,
              endOffset: run.startDocCharOffset + run.charLengthInDoc,
              score: run.charLengthInDoc 
          };
          segments.push(newSegment);
          runToSegmentMap.set(run.startDocCharOffset, newSegment);
      }
  });

  for (const gapInfo of gaps) {
    const runLeft = gapInfo.connectedRuns[0];
    const runRight = gapInfo.connectedRuns[1];
    const segmentForLeftRun = runToSegmentMap.get(runLeft.startDocCharOffset);
    const segmentForRightRun = runToSegmentMap.get(runRight.startDocCharOffset);

    if (segmentForLeftRun && segmentForRightRun && segmentForLeftRun === segmentForRightRun) continue;

    let merged = false;
    if (segmentForLeftRun && !segmentForRightRun) { 
      const potentialNewEnd = runRight.startDocCharOffset + runRight.charLengthInDoc;
      if ((potentialNewEnd - segmentForLeftRun.startOffset) <= maxSegmentSize) {
        segmentForLeftRun.endOffset = potentialNewEnd;
        segmentForLeftRun.score += runRight.charLengthInDoc; 
        runToSegmentMap.set(runRight.startDocCharOffset, segmentForLeftRun); 
        const rightRunStandaloneSegmentIndex = segments.findIndex(s => s.startOffset === runRight.startDocCharOffset && s.endOffset === (runRight.startDocCharOffset + runRight.charLengthInDoc) && s !== segmentForLeftRun);
        if (rightRunStandaloneSegmentIndex > -1) segments.splice(rightRunStandaloneSegmentIndex, 1);
        merged = true;
      }
    } else if (!segmentForLeftRun && segmentForRightRun) { 
      const potentialNewStart = runLeft.startDocCharOffset;
      if ((segmentForRightRun.endOffset - potentialNewStart) <= maxSegmentSize) {
        segmentForRightRun.startOffset = potentialNewStart;
        segmentForRightRun.score += runLeft.charLengthInDoc;
        runToSegmentMap.set(runLeft.startDocCharOffset, segmentForRightRun);
        const leftRunStandaloneSegmentIndex = segments.findIndex(s => s.startOffset === runLeft.startDocCharOffset && s.endOffset === (runLeft.startDocCharOffset + runLeft.charLengthInDoc) && s !== segmentForRightRun);
        if (leftRunStandaloneSegmentIndex > -1) segments.splice(leftRunStandaloneSegmentIndex, 1);
        merged = true;
      }
    } else if (segmentForLeftRun && segmentForRightRun) { 
        const potentialNewLength = segmentForRightRun.endOffset - segmentForLeftRun.startOffset;
        if (potentialNewLength <= maxSegmentSize) {
            segmentForLeftRun.endOffset = segmentForRightRun.endOffset;
            segmentForLeftRun.score += segmentForRightRun.score; 
            for (const [runStartOffset, seg] of runToSegmentMap.entries()) {
                if (seg === segmentForRightRun) {
                    runToSegmentMap.set(runStartOffset, segmentForLeftRun);
                }
            }
            const rightSegmentIndex = segments.indexOf(segmentForRightRun);
            if (rightSegmentIndex > -1) segments.splice(rightSegmentIndex, 1);
            merged = true;
        }
    }
    if (merged) { DEBUG.verboseSlow && console.log('trilight: Merged gap'); }
  }
  
  const uniqueSegments = Array.from(new Set(segments.filter(s => s))); 
  uniqueSegments.sort((a, b) => b.score - a.score); 

  const textSegments = uniqueSegments.slice(0, numResults).map(segment => {
    const snippetText = originalDocChars.slice(segment.startOffset, segment.endOffset).join('');
    return { 
        fragment: {
            text: markText(snippetText, queryOriginalCase), // Use original query case for marking
            offset: segment.startOffset
        }
    };
  });

  DEBUG.verboseSlow && console.log("trilight: final textSegments:", textSegments.length);

  if (textSegments.length === 0 && originalDocChars.length > 0) {
    DEBUG.verboseSlow && console.log("trilight: No segments found, returning beginning of doc.");
    const fallbackText = originalDocChars.slice(0, Math.min(maxSegmentSize, originalDocChars.length)).join('');
    return [{ fragment: { text: markText(fallbackText, queryOriginalCase), offset: 0 } }];
  }

  return textSegments;
}

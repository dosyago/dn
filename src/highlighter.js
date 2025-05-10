// highlighter.js

import ukkonen from 'ukkonen';
import {DEBUG} from './common.js';

const MAX_ACCEPT_SCORE = 0.5;
const CHUNK_SIZE = 12;

// Helper to wrap query terms with <mark> tags within a text
// This function will be used by both highlight and trilight before returning results.
function internalMarkText(textToMark, queryToFind) {
    if (!textToMark || !queryToFind) return textToMark;
    try {
        // Case-insensitive replacement, escaping regex special characters in query
        const escapedQuery = queryToFind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp('(' + escapedQuery + ')', 'gi');
        return textToMark.replace(regex, '<mark>$1</mark>');
    } catch (e) {
        console.warn("internalMarkText: Regex failed for query:", queryToFind, e);
        return textToMark; // Fallback to original text if regex fails
    }
}


function calculateUkkonenParams(queryLength, chunkSize = CHUNK_SIZE) {
  // Renamed from 'params' for clarity
  const maxDistance = chunkSize; // Max edit distance for Ukkonen
  const minPossibleScore = Math.abs(queryLength - chunkSize); // Minimum edits based on length difference
  // Max possible score range (denominator for scaling)
  let maxScoreRange = Math.max(queryLength, chunkSize) - minPossibleScore;
  if (maxScoreRange === 0) maxScoreRange = 1; // Avoid division by zero

  return {maxDistance, minPossibleScore, maxScoreRange};
}

export function highlight(query, docString, {
  maxLength = 0,
  maxAcceptScore = MAX_ACCEPT_SCORE,
  chunkSize = CHUNK_SIZE,
  // Options from server (around, before) are now handled internally by <mark>
  // numResults and contextChars are effectively handled by the original logic's
  // "better.slice(0,3)" and "extra" context respectively.
} = {}) {
  if (chunkSize % 2) {
    // Original code threw an error. Preserving this behavior.
    throw new TypeError(`chunkSize must be even. Was: ${chunkSize} which is odd.`);
  }

  let docChars = Array.from(docString); // Use character array for Unicode safety
  if (maxLength > 0 && docChars.length > maxLength) {
    docChars = docChars.slice(0, maxLength);
  }

  if (docChars.length === 0 || query.trim() === "") {
    return [];
  }

  const queryLower = query.toLocaleLowerCase(); // Lowercase query once
  const queryLength = Array.from(query).length; // Unicode-safe query length

  if (queryLength === 0) return [];

  const {maxDistance, minPossibleScore, maxScoreRange} = calculateUkkonenParams(queryLength, chunkSize);

  // --- Fragment Generation (Identical to original) ---
  // First set of fragments (docChars1)
  const docChars1 = [...docChars]; // Create a mutable copy
  // Pad to make length a multiple of chunkSize
  const padding1Length = (chunkSize - docChars1.length % chunkSize) % chunkSize;
  docChars1.push(...Array(padding1Length).fill(' '));
  const fragments1 = docChars1.reduce(getFragmenter(chunkSize, {symbolsArray: docChars}), []); // Pass original docChars for context

  // Second set of fragments (docChars2) with offset
  const docChars2 = [...docChars]; // Create another mutable copy
  // Pad start by half chunkSize
  docChars2.splice(0, 0, ...Array(chunkSize / 2).fill(' '));
  // Pad end to make length a multiple of chunkSize
  const padding2Length = (chunkSize - docChars2.length % chunkSize) % chunkSize;
  docChars2.push(...Array(padding2Length).fill(' '));
  const fragments2 = docChars2.reduce(getFragmenter(chunkSize, {symbolsArray: docChars, initialOffset: -(chunkSize/2)}), []); // Adjust offset

  DEBUG.verboseSlow && console.log("highlight: fragments1 count:", fragments1.length, "fragments2 count:", fragments2.length);

  const allFragments = [...fragments1, ...fragments2];
  const scoredFragments = allFragments.map(fragment => {
    // fragment.text is already from the original doc, no need to lowercase it here for distance calculation
    // ukkonen should compare queryLower with fragment.text.toLocaleLowerCase()
    const distance = ukkonen(queryLower, fragment.text.toLocaleLowerCase(), maxDistance);
    
    let scaledScore;
    if (distance === -1) { // Exceeded maxDistance
        scaledScore = Infinity;
    } else {
        scaledScore = (distance - minPossibleScore) / maxScoreRange;
    }
    return {score: scaledScore, fragment}; // fragment object contains {text, offset, symbols}
  });

  // Sort ascending (smallest scores win)
  scoredFragments.sort((a, b) => a.score - b.score);

  const initialHighlights = [];
  for (const {score, fragment} of scoredFragments) {
    if (score > maxAcceptScore) {
      // If we already have some highlights, we can stop if scores get too bad.
      // If we have none, we might continue to find at least one, even if poor.
      if (initialHighlights.length > 0) break; 
    }
    initialHighlights.push({score, fragment});
    if (initialHighlights.length >= 10 + 1) break; // Get a bit more than needed for the "better" selection (original took 10 for "better")
  }
  
  DEBUG.verboseSlow && console.log("highlight: initialHighlights count:", initialHighlights.length);

  let topSnippets;

  if (initialHighlights.length === 0) {
    DEBUG.verboseSlow && console.log('highlight: Zero initial highlights. Considering first scored fragment if available.');
    // Original logic: scores.slice(0,1) - this implies taking the best raw score if no "good" highlights
    if (scoredFragments.length > 0 && scoredFragments[0].score !== Infinity) {
        // Take the single best fragment, expand context, and mark it.
        const bestFragment = scoredFragments[0].fragment;
        const contextChars = chunkSize; // Original 'extra' was chunkSize
        const start = Math.max(0, bestFragment.offset - contextChars);
        const end = Math.min(docChars.length, bestFragment.offset + Array.from(bestFragment.text).length + contextChars);
        const snippetText = docChars.slice(start, end).join('');
        
        topSnippets = [{
            // score: scoredFragments[0].score, // Keep score if needed
            fragment: {
                text: internalMarkText(snippetText, query),
                offset: bestFragment.offset // Original offset of the core matched chunk
            }
        }];
    } else {
        topSnippets = []; // Truly no usable fragments
    }
  } else {
    // --- "Better" loop for context expansion and re-scoring (Identical logic to original) ---
    const contextCharsForBetterLoop = chunkSize; // Original 'extra' was chunkSize
    let betterScoredSnippets = initialHighlights.slice(0, 10).map(hl => {
      const originalFragment = hl.fragment;
      const originalFragmentTextChars = Array.from(originalFragment.text); // Unicode safe length
      const originalFragmentLength = originalFragmentTextChars.length;

      // Expand context using original document characters (hl.fragment.symbols)
      const startContext = Math.max(0, originalFragment.offset - contextCharsForBetterLoop);
      const endContext = Math.min(originalFragment.symbols.length, originalFragment.offset + originalFragmentLength + contextCharsForBetterLoop);
      
      const expandedText = originalFragment.symbols.slice(startContext, endContext).join('');
      const expandedTextLength = Array.from(expandedText).length; // Unicode safe

      // Re-calculate Ukkonen parameters for this new expanded text against the query
      const {
          maxDistance: newMaxDist, 
          minPossibleScore: newMinScore, 
          maxScoreRange: newMaxScoreRange
      } = calculateUkkonenParams(queryLength, expandedTextLength); // chunkSize is now expandedTextLength

      const newDistance = ukkonen(queryLower, expandedText.toLocaleLowerCase(), newMaxDist);
      
      let newScaledScore;
      if (newDistance === -1) {
          newScaledScore = Infinity;
      } else {
          newScaledScore = (newDistance - newMinScore) / newMaxScoreRange;
      }
      
      // The fragment text for output is the expanded text
      return {
          score: newScaledScore, 
          fragment: { // New fragment object
              text: expandedText, // This text will be marked later
              // The offset should ideally be the start of this expanded snippet in the original document
              offset: startContext, 
              // symbols: originalFragment.symbols // Not needed in final output
          }
      };
    });

    betterScoredSnippets.sort((a, b) => a.score - b.score);
    DEBUG.verboseSlow && console.log("highlight: betterScoredSnippets (after re-scoring with context):", JSON.stringify(betterScoredSnippets.slice(0,3),null,2));
    
    // Take top 3 from these "better" snippets and apply marking
    topSnippets = betterScoredSnippets.slice(0, 3).map(item => ({
        // score: item.score, // Keep score if needed
        fragment: {
            text: internalMarkText(item.fragment.text, query),
            offset: item.fragment.offset
        }
    }));
  }
  
  DEBUG.verboseSlow && console.log("highlight: final topSnippets to return:", topSnippets);
  return topSnippets;
}


// --- getFragmenter (Helper for highlight and trilight) ---
// Preserving its original logic as much as possible, with clearer parameters.
// The `symbolsArray` and `initialOffset` are for `highlight`'s specific needs.
function getFragmenter(chunkSize, {overlap = false, symbolsArray = null, initialOffset = 0} = {}) {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new TypeError(`chunkSize needs to be a whole number greater than 0`);
  }

  let currentFragmentCharCount; // Renamed from currentLength for clarity

  return function fragmentReducer(fragmentsAccumulator, nextCharSymbol, charIndex, fullSymbolArray) {
    // `fullSymbolArray` is the array being reduced.
    // `symbolsArray` (passed in options) is the *original* document characters,
    // used by `highlight` to ensure fragment.symbols points to the original doc.
    const effectiveSymbolsArray = symbolsArray || fullSymbolArray;
    const effectiveCharIndex = charIndex + initialOffset; // Adjust index for highlight's second pass

    if (overlap) {
      // Logic for overlapping fragments (primarily for trilight's n-grams)
      // This part of original getFragmenter was complex and seemed to modify previous frags.
      // For n-grams, it's simpler: create a new fragment for each possible n-gram.
      if (charIndex <= fullSymbolArray.length - chunkSize) {
        const ngramChars = fullSymbolArray.slice(charIndex, charIndex + chunkSize);
        fragmentsAccumulator.push({
          text: ngramChars.join(''),
          offset: effectiveCharIndex, // Offset in the original document
          symbols: effectiveSymbolsArray
        });
      }
    } else {
      // Logic for non-overlapping fragments (for highlight's chunking)
      if (fragmentsAccumulator.length === 0 || currentFragmentCharCount >= chunkSize) {
        // Start a new fragment
        fragmentsAccumulator.push({
          text: nextCharSymbol,
          offset: effectiveCharIndex, // Offset in the original document
          symbols: effectiveSymbolsArray
        });
        currentFragmentCharCount = 1;
      } else {
        // Add to the current fragment
        const currentFragment = fragmentsAccumulator[fragmentsAccumulator.length - 1];
        currentFragment.text += nextCharSymbol;
        currentFragmentCharCount++;
      }
    }
    return fragmentsAccumulator;
  };
}


// --- trilight function ---
// Preserving original algorithm and segment generation logic with clarity and <mark> support.
export function trilight(query, docString, {
  maxLength = 0,
  ngramSize = 3,
  maxSegmentSize = 140,
  // numResults is implicitly 3 due to .slice(0,3) at the end
} = {}) {
  const originalDocChars = Array.from(docString); // For final slicing, Unicode safe
  const queryChars = Array.from(query.toLocaleLowerCase()); // Lowercase query once
  
  let docCharsForProcessing = Array.from(docString.toLocaleLowerCase());
  if (maxLength > 0 && docCharsForProcessing.length > maxLength) {
    docCharsForProcessing = docCharsForProcessing.slice(0, maxLength);
  }

  if (docCharsForProcessing.length < ngramSize || queryChars.length < ngramSize) {
    return [];
  }

  // Generate n-grams for document and query using the getFragmenter
  // For n-grams, getFragmenter should be called with overlap: true
  const docNgrams = docCharsForProcessing.reduce(getFragmenter(ngramSize, {overlap: true, symbolsArray: originalDocChars}), []);
  const queryNgrams = queryChars.reduce(getFragmenter(ngramSize, {overlap: true, symbolsArray: queryChars}), []); // symbolsArray here is queryChars

  if (docNgrams.length === 0 || queryNgrams.length === 0) return [];

  // Index document n-grams by their text
  const docNgramIndex = new Map();
  docNgrams.forEach(ngram => {
    if (!docNgramIndex.has(ngram.text)) {
      docNgramIndex.set(ngram.text, []);
    }
    // Store original character offset of the ngram in the document
    docNgramIndex.get(ngram.text).push(ngram.offset);
  });

  // --- Find matching entries (Identical to original logic) ---
  const matchingEntries = [];
  queryNgrams.forEach((queryNgram, queryNgramIndex) => {
    const docOffsetsForNgram = docNgramIndex.get(queryNgram.text);
    if (docOffsetsForNgram) {
      docOffsetsForNgram.forEach(docCharOffset => {
        matchingEntries.push({
          ngramText: queryNgram.text,
          queryNgramIndex: queryNgramIndex, // Index of ngram within queryNgrams list
          docCharOffset: docCharOffset    // Character offset of ngram in original document
        });
      });
    }
  });
  matchingEntries.sort((a, b) => a.docCharOffset - b.docCharOffset); // Sort by document offset

  // --- Identify runs of consecutive matching n-grams (Identical to original logic) ---
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

      if (queryIndexDiff === 1 && docOffsetDiff === 1) { // Consecutive in both query and doc
        currentRun.ngramsInRun.push(entry.ngramText);
      } else {
        // End current run, add its length, then push
        currentRun.charLengthInDoc = currentRun.ngramsInRun.length + (ngramSize - 1);
        runs.push(currentRun);
        // Start new run
        currentRun = {
          ngramsInRun: [entry.ngramText],
          startQueryNgramIndex: entry.queryNgramIndex,
          startDocCharOffset: entry.docCharOffset
        };
      }
      lastQueryNgramIndexInRun = entry.queryNgramIndex;
      lastDocCharOffsetInRun = entry.docCharOffset;
    }
    // Add the last run
    currentRun.charLengthInDoc = currentRun.ngramsInRun.length + (ngramSize - 1);
    runs.push(currentRun);
  }
  
  DEBUG.verboseSlow && console.log("trilight: identified runs:", runs.length);

  // --- Calculate gaps between runs (Identical to original logic) ---
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
  gaps.sort((a, b) => a.gapSize - b.gapSize); // Sort by smallest gap

  // --- Merge runs into segments (Identical to original logic) ---
  const segments = [];
  const runToSegmentMap = new Map(); // Maps run's startDocCharOffset to the segment it belongs to

  // Initialize segments with individual runs if they are not too long
  runs.forEach(run => {
      if (run.charLengthInDoc <= maxSegmentSize) {
          const newSegment = {
              startOffset: run.startDocCharOffset,
              endOffset: run.startDocCharOffset + run.charLengthInDoc,
              score: run.charLengthInDoc // Initial score is its own length
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

    if (segmentForLeftRun && segmentForRightRun && segmentForLeftRun === segmentForRightRun) {
      continue; // Already in the same segment
    }

    let merged = false;
    if (segmentForLeftRun && !segmentForRightRun) { // Try to extend left segment with right run
      const potentialNewEnd = runRight.startDocCharOffset + runRight.charLengthInDoc;
      if ((potentialNewEnd - segmentForLeftRun.startOffset) <= maxSegmentSize) {
        segmentForLeftRun.endOffset = potentialNewEnd;
        segmentForLeftRun.score += runRight.charLengthInDoc; // Add length of right run
        runToSegmentMap.set(runRight.startDocCharOffset, segmentForLeftRun); // Right run now points to left's segment
        // Remove standalone segment for right run if it existed (it shouldn't if !segmentForRightRun)
        const rightRunStandaloneSegmentIndex = segments.findIndex(s => s.startOffset === runRight.startDocCharOffset && s.endOffset === runRight.startDocCharOffset + runRight.charLengthInDoc);
        if (rightRunStandaloneSegmentIndex > -1) segments.splice(rightRunStandaloneSegmentIndex, 1);
        merged = true;
      }
    } else if (!segmentForLeftRun && segmentForRightRun) { // Try to extend right segment with left run
      const potentialNewStart = runLeft.startDocCharOffset;
      if ((segmentForRightRun.endOffset - potentialNewStart) <= maxSegmentSize) {
        segmentForRightRun.startOffset = potentialNewStart;
        segmentForRightRun.score += runLeft.charLengthInDoc;
        runToSegmentMap.set(runLeft.startDocCharOffset, segmentForRightRun);
        const leftRunStandaloneSegmentIndex = segments.findIndex(s => s.startOffset === runLeft.startDocCharOffset && s.endOffset === runLeft.startDocCharOffset + runLeft.charLengthInDoc);
        if (leftRunStandaloneSegmentIndex > -1) segments.splice(leftRunStandaloneSegmentIndex, 1);
        merged = true;
      }
    } else if (segmentForLeftRun && segmentForRightRun) { // Both runs are in existing (different) segments, try to merge these segments
        const potentialNewLength = segmentForRightRun.endOffset - segmentForLeftRun.startOffset;
        if (potentialNewLength <= maxSegmentSize) {
            segmentForLeftRun.endOffset = segmentForRightRun.endOffset;
            segmentForLeftRun.score += segmentForRightRun.score; // Combine scores

            // All runs that were part of segmentForRightRun now point to segmentForLeftRun
            for (const [runStartOffset, seg] of runToSegmentMap.entries()) {
                if (seg === segmentForRightRun) {
                    runToSegmentMap.set(runStartOffset, segmentForLeftRun);
                }
            }
            // Remove segmentForRightRun from segments array
            const rightSegmentIndex = segments.indexOf(segmentForRightRun);
            if (rightSegmentIndex > -1) segments.splice(rightSegmentIndex, 1);
            merged = true;
        }
    }
    // Original code also had a case for creating a new segment from two runs not yet in segments.
    // This is covered by the initialization of segments with individual runs, and then merging.
    // The provided logic for merging was:
    // else { /* if (!leftSeg && !rightSeg) */
    //   const newSegment = { start: runs[0].di, end: runs[0].di + runs[0].length + nextGap.gap + runs[1].length, score: runs[0].length + runs[1].length };
    //   if ( newSegment.end - newSegment.start <= maxSegmentSize ) { runSegMap[runs[0].di] = newSegment; runSegMap[runs[1].di] = newSegment; segments.push(newSegment); assigned = newSegment; }
    // }
    // This specific "else" is tricky to map directly if segments are pre-initialized.
    // The current merging logic tries to extend existing segments. If two runs are not in segments
    // and their combined length (including gap) is <= maxSegmentSize, they should form a new segment.
    // This is implicitly handled if they were small enough to be individual segments initially and then get merged.
    // The key is that `runToSegmentMap` correctly tracks which segment a run belongs to.

    if (merged) {
      DEBUG.verboseSlow && console.log('trilight: Merged gap, new segment length:', segmentForLeftRun ? segmentForLeftRun.endOffset - segmentForLeftRun.startOffset : segmentForRightRun.endOffset - segmentForRightRun.startOffset);
    } else {
      DEBUG.verboseSlow && console.log('trilight: Gap could not be merged or runs not in mappable segments.');
    }
  }
  
  // Deduplicate segments that might have become identical after merges (e.g., if map pointed multiple runs to same segment object)
  const uniqueSegments = Array.from(new Set(segments.filter(s => s))); // Filter out undefined/null if any
  uniqueSegments.sort((a, b) => b.score - a.score); // Sort by score (descending)

  const textSegments = uniqueSegments.slice(0, 3).map(segment => {
    const snippetText = originalDocChars.slice(segment.startOffset, segment.endOffset).join('');
    return { // Return in the same format as highlight()
        fragment: {
            text: internalMarkText(snippetText, query),
            offset: segment.startOffset
        }
    };
  });

  DEBUG.verboseSlow && console.log("trilight: final textSegments:", textSegments.length);

  if (textSegments.length === 0 && originalDocChars.length > 0) {
    DEBUG.verboseSlow && console.log("trilight: No segments found, returning beginning of doc.");
    const fallbackText = originalDocChars.slice(0, Math.min(maxSegmentSize, originalDocChars.length)).join('');
    return [{ fragment: { text: internalMarkText(fallbackText, query), offset: 0 } }];
  }

  return textSegments;
}

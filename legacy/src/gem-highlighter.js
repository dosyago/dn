// highlighter.js

import ukkonen from 'ukkonen';
import {DEBUG} from './common.js';

const MAX_ACCEPT_SCORE = 0.5;
const CHUNK_SIZE = 12; // Default, can be overridden

function params(qLength, chunkSize = CHUNK_SIZE) {
  // MaxDist is the maximum edit distance we're willing to consider for a chunk.
  // If chunkSize is small, MaxDist might be too restrictive for longer queries.
  // Consider making MaxDist also a function of qLength, e.g., Math.min(chunkSize, qLength / 2)
  const MaxDist = chunkSize; // This was the original.
  // A more flexible MaxDist could be:
  // const MaxDist = Math.min(chunkSize, Math.floor(qLength * 0.4) + 1); // Allow up to 40% of query length as edits

  // MinScore: if distance is 0, this is the "best" raw score.
  // If qLength and chunkSize are very different, distance can't be 0.
  // The distance between two strings is at least abs(len1 - len2).
  const MinScore = Math.abs(qLength - chunkSize);

  // MaxScore: used for scaling. (distance - MinScore) / MaxScore_Range
  // The maximum possible distance is max(qLength, chunkSize).
  // So, the range of distances is from MinScore to max(qLength, chunkSize).
  // The length of this range is max(qLength, chunkSize) - MinScore.
  const MaxScore_Range = Math.max(qLength, chunkSize) - MinScore;

  // If MaxScore_Range is 0 (e.g., qLength === chunkSize, so MinScore is 0, and max distance is qLength),
  // avoid division by zero. In this case, any distance > 0 is "bad".
  // A distance of 0 would be a perfect match.
  return {MaxDist, MinScore, MaxScore_Range: MaxScore_Range === 0 ? 1 : MaxScore_Range};
}

// Helper to wrap query terms with <mark> tags within a text
function markText(text, query) {
    if (!text || !query) return text;
    try {
        // Case-insensitive replacement
        const regex = new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    } catch (e) {
        // Regex might fail for complex queries, fallback to original text
        console.warn("Marking text failed for query:", query, e);
        return text;
    }
}

export function highlight(query, doc, {
  maxLength = 0,
  maxAcceptScore = MAX_ACCEPT_SCORE,
  chunkSize = CHUNK_SIZE,
  // NEW options for server integration
  around = '', // e.g. '<mark>' - but we'll handle this internally now
  before = '', // e.g. '</mark>' - but we'll handle this internally now
  numResults = 3, // How many top snippets to return
  contextChars = 30 // How many characters before/after the matched chunk
} = {}) {
  if (chunkSize % 2 !== 0 && chunkSize !== 1) { // Allow chunkSize 1 for exact char matching if desired
    // Original code threw error for odd chunkSize.
    // Relaxing this slightly, but even is generally better for the overlapping strategy.
    // For simplicity, let's stick to the original constraint or make it more robust.
    // For now, let's assume it's usually even or we adjust.
    // If we keep the original overlapping strategy, even chunkSize is important for the offset.
    // Let's keep the original constraint for now:
     if ( chunkSize % 2 ) {
        console.warn(`highlight: chunkSize should ideally be even. Was: ${chunkSize}. Adjusting to ${chunkSize+1}`);
        chunkSize = chunkSize + 1; // Or throw error as original
     }
  }

  const originalDocString = doc; // Keep the original string for final snippet extraction
  doc = Array.from(doc); // Work with array of characters for unicode safety

  if (maxLength > 0 && doc.length > maxLength) {
    doc = doc.slice(0, maxLength);
  }

  if (doc.length === 0 || query.trim() === "") {
    return []; // No document or query, no highlights
  }

  const queryChars = Array.from(query.toLocaleLowerCase()); // Lowercase query once
  const qLength = queryChars.length;

  if (qLength === 0) return [];


  // --- Fragment Generation ---
  // The original code created two sets of fragments with different offsets.
  // This is a strategy to catch matches that might fall across non-overlapping chunk boundaries.
  // Let's simplify this for clarity first, then consider re-adding if necessary.
  // A simpler approach: overlapping chunks.
  const step = Math.max(1, Math.floor(chunkSize / 2)); // Create overlapping chunks
  const fragments = [];
  for (let i = 0; i <= doc.length - chunkSize; i += step) {
    const fragmentTextChars = doc.slice(i, i + chunkSize);
    fragments.push({
      text: fragmentTextChars.join(''),
      textChars: fragmentTextChars, // Keep char array for lowercase version
      offset: i,
      // symbols: doc // Reference to the full document character array (for context later)
                      // This can be memory intensive if doc is huge.
                      // We'll use originalDocString and offsets for context.
    });
  }
  // Add last fragment if doc.length is not a multiple of step
  if (doc.length % chunkSize !== 0 && doc.length > chunkSize) {
      const i = Math.floor((doc.length - chunkSize)/step) * step; // last full step
      if (i + chunkSize < doc.length) { // if there's a remainder smaller than chunkSize
        const remainderOffset = i + step > doc.length - chunkSize ? doc.length - chunkSize : i + step;
        if (remainderOffset < doc.length -1 && remainderOffset > 0) { // ensure it's a valid offset
            const fragmentTextChars = doc.slice(remainderOffset, Math.min(remainderOffset + chunkSize, doc.length));
             if (fragmentTextChars.length > 0) {
                fragments.push({
                    text: fragmentTextChars.join(''),
                    textChars: fragmentTextChars,
                    offset: remainderOffset,
                });
            }
        }
      } else if (doc.length < chunkSize) { // if doc is smaller than chunksize
        // The loop for fragments won't run, so add the whole doc as one fragment
        if (fragments.length === 0) {
             fragments.push({
                text: doc.join(''),
                textChars: doc,
                offset: 0,
            });
        }
      }
  }
   if (fragments.length === 0 && doc.length > 0) { // Case: doc is shorter than chunkSize
        fragments.push({
            text: doc.join(''),
            textChars: doc,
            offset: 0,
        });
    }


  DEBUG.verboseSlow && console.log("Generated fragments:", fragments.length);

  const { MaxDist, MinScore, MaxScore_Range } = params(qLength, chunkSize);

  const scoredFragments = fragments.map(fragment => {
    const fragmentTextLower = fragment.textChars.join('').toLocaleLowerCase();
    // Ukkonen distance between the lowercase query and lowercase fragment text
    const distance = ukkonen(queryChars.join(''), fragmentTextLower, MaxDist);
    
    // Scale the score: 0 is best (perfect match or close), 1 is worst (MaxDist or more)
    // If distance is -1 (meaning it exceeded MaxDist), assign a very high score.
    let scaledScore;
    if (distance === -1) {
        scaledScore = Infinity; // Or a value > 1, e.g., 2
    } else {
        // scaledScore = (distance - MinScore) / MaxScore_Range;
        // Simpler scaling: distance / qLength (fraction of query that is "wrong")
        // This makes maxAcceptScore more intuitive (e.g., 0.2 means up to 20% difference)
        scaledScore = distance / Math.max(1, qLength); // Avoid division by zero for empty query (already handled)
    }
    
    return { score: scaledScore, fragment };
  });

  // Sort by score (ascending, lower is better)
  scoredFragments.sort((a, b) => a.score - b.score);

  DEBUG.verboseSlow && console.log("Top 5 scored fragments:", scoredFragments.slice(0, 5));

  const bestHighlights = [];
  const seenOffsets = new Set(); // To avoid overly similar/overlapping snippets

  for (const { score, fragment } of scoredFragments) {
    if (bestHighlights.length >= numResults * 2) break; // Get a slightly larger pool initially

    if (score > maxAcceptScore) {
      // If even the best scores are too high, we might not have good matches.
      // However, if we have *some* results already, we might stop.
      // If bestHighlights is empty and score > maxAcceptScore, then we have no good matches.
      if (bestHighlights.length === 0 && score !== Infinity) { // If it's the first one and bad, but not impossible
          // Potentially keep it if we want to *always* return something
      } else if (score === Infinity || score > maxAcceptScore) {
          continue; // Skip clearly bad or too fuzzy matches if we have better options
      }
    }
    
    // Check for overlap with already selected highlights
    let isOverlapping = false;
    for (const existingOffset of seenOffsets) {
        if (Math.abs(fragment.offset - existingOffset) < chunkSize / 2) { // Heuristic for overlap
            isOverlapping = true;
            break;
        }
    }
    if (isOverlapping) continue;

    bestHighlights.push({ score, fragment });
    seenOffsets.add(fragment.offset);
  }
  
  DEBUG.verboseSlow && console.log("Filtered bestHighlights (before context/marking):", bestHighlights.length);


  if (bestHighlights.length === 0 && scoredFragments.length > 0 && scoredFragments[0].score !== Infinity) {
    // If no highlights passed the filter but there was at least one scorable fragment,
    // take the absolute best one, regardless of maxAcceptScore, to ensure we return *something*.
    // This was the behavior of the original code's "Zero highlights, showing first score"
    if (scoredFragments[0].fragment) { // Check if fragment exists
        bestHighlights.push(scoredFragments[0]);
         DEBUG.verboseSlow && console.log('No highlights passed filters, taking the absolute best scored fragment.');
    }
  }


  // Now, construct the final snippets with context and <mark> tags
  const finalSnippets = bestHighlights
    .slice(0, numResults) // Take the top N results
    .map(({ score, fragment }) => {
      const start = Math.max(0, fragment.offset - contextChars);
      const end = Math.min(originalDocString.length, fragment.offset + fragment.text.length + contextChars);
      
      let snippetText = originalDocString.substring(start, end);

      // Apply <mark> tags. This is the crucial part for server integration.
      // We mark the original query within this expanded snippet.
      snippetText = markText(snippetText, query);

      return {
        // score, // Optionally include score if useful for UI
        fragment: {
          text: snippetText,
          offset: fragment.offset, // Original offset of the core matched chunk
          // No need for 'symbols' anymore in the returned fragment
        }
      };
    });
    
  // The original code had a "better" loop that re-scored with more context.
  // This can be useful but adds complexity. For now, the above provides context around the best chunks.
  // If re-scoring is desired:
  // 1. Take top N initial highlights.
  // 2. For each, expand context (as done above).
  // 3. Re-run Ukkonen on this expanded (but not yet marked) snippet.
  // 4. Re-sort based on these new scores.
  // 5. Then apply <mark> tags.
  // This was what your "better = better.map(hl => { ... })" loop was doing.
  // Let's defer re-implementing that precisely unless the current results are insufficient.

  DEBUG.verboseSlow && console.log("Final snippets to return:", finalSnippets);
  return finalSnippets;
}


// --- trilight function (and its helper getFragmenter) ---
// This function seems to be an alternative highlighting/segmentation strategy.
// It's not directly used by the server's current highlight call, but I'll review it.

// (getFragmenter is used by both highlight (implicitly if we restore original frag logic) and trilight)
// returns a function that creates fragments
function getFragmenter(chunkSize, {overlap = false, step = 1} = {}) {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new TypeError(`chunkSize needs to be a whole number greater than 0`);
  }
  if (!Number.isInteger(step) || step < 1) {
    throw new TypeError(`step needs to be a whole number greater than 0`);
  }

  // This function is complex due to its use of reduce and mutating frags array.
  // A generator function or a simple loop might be clearer for fragment generation.
  // However, let's keep its logic for now if it's specific to trilight's needs.

  // The original getFragmenter was stateful in a way that's tricky with `reduce`
  // if `overlap` is true and it tries to modify previous elements of `frags`.
  // Let's simplify its signature and usage for `trilight` if it's only for n-grams.

  // If for n-grams (overlap=true, step=1 typically for n-grams)
  if (overlap) {
    return function ngramFragmenter(frags, _nextSymbol, index, symbols) {
      if (index <= symbols.length - chunkSize) {
        const ngramChars = symbols.slice(index, index + chunkSize);
        frags.push({
          text: ngramChars.join(''),
          offset: index,
          // symbols: symbols // Avoid if not strictly needed or doc is large
        });
      }
      return frags;
    };
  } else {
    // Non-overlapping chunks (or controlled overlap via step)
    // This is more like the fragment generation now in `highlight`
    return function chunkFragmenter(frags, _nextSymbol, index, symbols) {
        // This will be called for each symbol, which is inefficient for chunking.
        // It's better to do chunking in a loop outside.
        // For now, to match original structure if trilight depends on it:
        if (index % chunkSize === 0) { // Start new chunk
            const chunkChars = symbols.slice(index, Math.min(index + chunkSize, symbols.length));
            if (chunkChars.length > 0) {
                 frags.push({
                    text: chunkChars.join(''),
                    offset: index,
                    // symbols: symbols
                });
            }
        }
        return frags;
    };
  }
}


export function trilight(query, doc, {
  maxLength = 0,
  ngramSize = 3,
  maxSegmentSize = 140,
  numResults = 3 // How many segments to return
} = {}) {
  const originalDocString = doc; // For final slicing
  query = Array.from(query.toLocaleLowerCase());
  const docCharsLower = Array.from(doc.toLocaleLowerCase());
  
  let effectiveDoc = docCharsLower;
  if (maxLength > 0 && effectiveDoc.length > maxLength) {
    effectiveDoc = effectiveDoc.slice(0, maxLength);
  }

  if (effectiveDoc.length === 0 || query.length === 0 || query.length < ngramSize) {
    return [];
  }

  // Generate n-grams for document and query
  const docNgrams = [];
  for (let i = 0; i <= effectiveDoc.length - ngramSize; i++) {
    docNgrams.push({ text: effectiveDoc.slice(i, i + ngramSize).join(''), offset: i });
  }

  const queryNgrams = [];
  for (let i = 0; i <= query.length - ngramSize; i++) {
    queryNgrams.push({ text: query.slice(i, i + ngramSize).join(''), offset: i });
  }
  
  if (docNgrams.length === 0 || queryNgrams.length === 0) return [];

  // Index document n-grams
  const docNgramIndex = new Map();
  for (const ngram of docNgrams) {
    if (!docNgramIndex.has(ngram.text)) {
      docNgramIndex.set(ngram.text, []);
    }
    docNgramIndex.get(ngram.text).push(ngram.offset);
  }

  // Find matching n-gram sequences (Longest Common Subsequence of N-gram Offsets)
  // This is essentially what your 'entries' and 'runs' logic is doing.
  // It's finding diagonals in a dot plot of query n-gram index vs doc n-gram index.
  const runs = [];
  for (let qi = 0; qi < queryNgrams.length; qi++) {
    const qNgramText = queryNgrams[qi].text;
    const docOffsets = docNgramIndex.get(qNgramText);
    if (docOffsets) {
      for (const docOffset of docOffsets) {
        // This is a potential start of a run.
        // Try to extend it.
        let currentRunLength = 1;
        let qIdx = qi + 1;
        let dIdx = docOffset + 1; // Next char, not next ngram offset
                                  // Original logic: dDi = di - lastDi; if (dQi === 1 && dDi === 1)
                                  // This implies matching characters, not just ngrams.
                                  // Let's stick to ngram matching for runs.
                                  // A "run" is a sequence of matching n-grams where their relative positions are maintained.
                                  // q_ngram[i] matches d_ngram[j]
                                  // q_ngram[i+1] matches d_ngram[j+1] (if ngramSize=1, this is char matching)
                                  // q_ngram[i+k] matches d_ngram[j+k]

        // To find runs more directly:
        // For each match (q_ngram_idx, d_ngram_idx), the value (d_ngram_idx - q_ngram_idx) is constant along a diagonal.
        // Group matches by this diagonal value. Then, within each diagonal, find longest contiguous sequences.
      }
    }
  }
  // The original 'runs' logic is quite specific. Let's try to replicate its intent.
  // It finds consecutive n-grams that match with a consistent offset.
  const entries = [];
  queryNgrams.forEach((qNgram, qNgramIndex) => {
    const docOffsets = docNgramIndex.get(qNgram.text);
    if (docOffsets) {
      docOffsets.forEach(docNgramActualOffset => {
        entries.push({
          qNgramIndex, // Index of the ngram in the query's ngram list
          docNgramActualOffset, // Actual character offset in the document
          text: qNgram.text // The ngram text itself
        });
      });
    }
  });

  // Sort entries primarily by document offset, then by query ngram index
  // This helps in identifying consecutive runs.
  entries.sort((a, b) => {
    if (a.docNgramActualOffset !== b.docNgramActualOffset) {
      return a.docNgramActualOffset - b.docNgramActualOffset;
    }
    return a.qNgramIndex - b.qNgramIndex;
  });
  
  const identifiedRuns = [];
  if (entries.length > 0) {
    let currentRun = {
        startDocOffset: entries[0].docNgramActualOffset,
        startQueryNgramIndex: entries[0].qNgramIndex,
        lengthNgrams: 1, // Length in terms of number of ngrams
        // ngrams: [entries[0].text] // For debugging
    };

    for (let i = 1; i < entries.length; i++) {
        const prevEntry = entries[i-1];
        const currentEntry = entries[i];

        // Check for contiguity:
        // Query ngrams are consecutive: currentEntry.qNgramIndex === prevEntry.qNgramIndex + 1
        // Document ngrams are consecutive (offsets advance by 1 for each char in ngram):
        // currentEntry.docNgramActualOffset === prevEntry.docNgramActualOffset + 1 (if ngrams overlap by n-1)
        // This is the condition from your original code: dQi === 1 && dDi === 1
        // where dDi was char offset difference.
        if (currentEntry.qNgramIndex === (currentRun.startQueryNgramIndex + currentRun.lengthNgrams) &&
            currentEntry.docNgramActualOffset === (currentRun.startDocOffset + currentRun.lengthNgrams) ) {
            currentRun.lengthNgrams++;
            // currentRun.ngrams.push(currentEntry.text);
        } else {
            // End of current run, save it
            identifiedRuns.push({
                docOffset: currentRun.startDocOffset,
                queryNgramStartIndex: currentRun.startQueryNgramIndex,
                // Actual character length of the run in the document:
                // start offset + (num_ngrams - 1) for overlaps + ngramSize for the last one
                docLengthChars: currentRun.lengthNgrams + ngramSize - 1,
                numMatchingNgrams: currentRun.lengthNgrams
            });
            // Start a new run
            currentRun = {
                startDocOffset: currentEntry.docNgramActualOffset,
                startQueryNgramIndex: currentEntry.qNgramIndex,
                lengthNgrams: 1,
                // ngrams: [currentEntry.text]
            };
        }
    }
    // Push the last run
    identifiedRuns.push({
        docOffset: currentRun.startDocOffset,
        queryNgramStartIndex: currentRun.startQueryNgramIndex,
        docLengthChars: currentRun.lengthNgrams + ngramSize - 1,
        numMatchingNgrams: currentRun.lengthNgrams
    });
  }
  
  DEBUG.verboseSlow && console.log("Trilight identifiedRuns:", identifiedRuns);

  // The original code then merges runs based on 'gaps'. This is a form of segment clustering.
  // Let's simplify: take the longest runs as primary segments.
  // Sort runs by numMatchingNgrams (as a proxy for quality/length)
  identifiedRuns.sort((a, b) => b.numMatchingNgrams - a.numMatchingNgrams);

  const finalSegments = [];
  const addedRunOffsets = new Set();

  for (const run of identifiedRuns) {
    if (finalSegments.length >= numResults) break;

    // Avoid adding segments that heavily overlap with already chosen ones
    let overlaps = false;
    for(let i = run.docOffset; i < run.docOffset + run.docLengthChars; i++) {
        if (addedRunOffsets.has(i)) {
            overlaps = true;
            break;
        }
    }
    if (overlaps && finalSegments.length > 0) continue; // Allow first segment even if it's the only one

    const segmentStart = run.docOffset;
    const segmentEnd = run.docOffset + run.docLengthChars;
    
    // Ensure segment does not exceed maxSegmentSize (original logic was more complex during merging)
    // Here, we just check the individual run. If merging is desired, it's more complex.
    if (run.docLengthChars > maxSegmentSize) {
        // If a single best run is too long, we might truncate it or skip it.
        // For now, let's allow it but be aware.
        // Or, we could try to find a sub-segment centered around the query.
    }

    let text = originalDocString.substring(segmentStart, Math.min(segmentEnd, originalDocString.length));
    
    // Mark the text within this segment
    text = markText(text, query.join('')); // query is array of chars

    finalSegments.push({
        fragment: { text, offset: segmentStart } // Keep consistent with `highlight` output
    });

    for(let i = run.docOffset; i < run.docOffset + run.docLengthChars; i++) {
        addedRunOffsets.add(i);
    }
  }
  
  DEBUG.verboseSlow && console.log("Trilight finalSegments:", finalSegments);

  // If no segments, return a small part of the beginning of the document as a fallback
  if (finalSegments.length === 0 && originalDocString.length > 0) {
    DEBUG.verboseSlow && console.log("Trilight: No segments found, returning beginning of doc.");
    let fallbackText = originalDocString.substring(0, Math.min(maxSegmentSize, originalDocString.length));
    fallbackText = markText(fallbackText, query.join(''));
    return [{ fragment: { text: fallbackText, offset: 0 } }];
  }

  return finalSegments;
}

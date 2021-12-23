/**
 * Modified Dec 23 2021 by Cris Stringfellow
 * fuzzy.js v0.1.0
 * (c) 2016 Ben Ripkens
 * @license: MIT
 */
  // NOTES
    /*
     * Whether or not fuzzy.js should analyze sub-terms, i.e. also
     * check term starting positions != 0.
     *
     * Example:
     * Given the term 'Halleluja' and query 'luja'
     *
     * Fuzzy.js scores this combination with an 8, when analyzeSubTerms is
     * set to false, as the following matching string will be calculated:
     * Ha[l]lel[uja]
     *
     * If you activate sub temr analysis though, the query will reach a score
     * of 10, as the matching string looks as following:
     * Halle[luja]
     *
     * Naturally, the second version is more expensive than the first one.
     * You should therefore configure how many sub terms you which to analyse.
     * This can be configured through fuzzy.analyzeSubTermDepth = 10.
     */
  fuzzy.analyzeSubTerms = false;
    /*
     * How many sub terms should be analyzed.
     */
  fuzzy.analyzeSubTermDepth = 10;
  fuzzy.highlighting = {
    before: '<em>',
    after: '</em>'
  };
  fuzzy.matchComparator = function matchComparator(m1, m2) {
    return (m2.score - m1.score != 0) ? m2.score - m1.score : m1.term.length - m2.term.length;
  };

  export default function fuzzy(term, query) {
    var max = calcFuzzyScore(term, query);
    var termLength = term.length;

    if (fuzzy.analyzeSubTerms) {

      for (var i = 1; i < termLength && i < fuzzy.analyzeSubTermDepth; i++) {
        var subTerm = term.substring(i);
        var score = calcFuzzyScore(subTerm, query);
        if (score.score > max.score) {
          // we need to correct 'term' and 'matchedTerm', as calcFuzzyScore
          // does not now that it operates on a substring. Doing it only for
          // new maximum score to save some performance.
          score.term = term;
          score.highlightedTerm = term.substring(0, i) + score.highlightedTerm;
          max = score;
        }
      }
    }

    return max;
  }

  function calcFuzzyScore(term, query) {
    var score = 0;
    var termLength = term.length;
    var queryLength = query.length;
    var highlighting = '';
    var ti = 0;
    // -1 would not work as this would break the calculations of bonus
    // points for subsequent character matches. Something like
    // Number.MIN_VALUE would be more appropriate, but unfortunately
    // Number.MIN_VALUE + 1 equals 1...
    var previousMatchingCharacter = -2;

    for (var qi = 0; qi < queryLength && ti < termLength; qi++) {
      var qc = query.charAt(qi);
      var lowerQc = qc.toLowerCase();

      for (; ti < termLength; ti++) {
        var tc = term.charAt(ti);

        if (lowerQc === tc.toLowerCase()) {
          score++;

          if ((previousMatchingCharacter + 1) === ti) {
            score += 5;
          }

          highlighting += fuzzy.highlighting.before +
              tc +
              fuzzy.highlighting.after;
          previousMatchingCharacter = ti;
          ti++;
          break;
        } else {
          highlighting += tc;
        }
      }
    }

    highlighting += term.substring(ti, term.length);

    return {
      score: score,
      term: term,
      query: query,
      highlightedTerm: highlighting
    };
  };

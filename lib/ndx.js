// Source: https://github.com/ndx-search/ndx
// License: MIT License
  // Source: https://github.com/ndx-search/ndx/commit/cc9ec2780d88918338d4edcfca2d4304af9dc721

// Changes by Cris Stringfellow:
// I changed the _vacuumIndex function to use a stack instead of recursion.

/**
 * Creates an Index.
 *
 * @typeparam T Document key.
 * @param fieldsNum Number of fields.
 * @returns {@link Index}
 */
export function createIndex(fieldsNum) {
    var fields = [];
    for (var i = 0; i < fieldsNum; i++) {
        fields.push({ sum: 0, avg: 0 });
    }
    return {
        docs: new Map(),
        root: createInvertedIndexNode(0),
        fields: fields,
    };
}
/**
 * Creates inverted index node.
 *
 * @typeparam T Document key.
 * @param charCode Char code.
 * @returnd {@link InvertedIndexNode} instance.
 */
export function createInvertedIndexNode(charCode) {
    return {
        charCode: charCode,
        next: null,
        firstChild: null,
        firstDoc: null,
    };
}
/**
 * Finds inverted index node that matches the `term`.
 *
 * @typeparam T Document key.
 * @param node Root node.
 * @param term Term.
 * @returns Inverted index node that contains `term` or an `undefined` value.
 */
export function findInvertedIndexNode(node, term) {
    for (var i = 0; node !== void 0 && i < term.length; i++) {
        node = findInvertedIndexChildNodeByCharCode(node, term.charCodeAt(i));
    }
    return node;
}
/**
 * Finds inverted index child node with matching `charCode`.
 *
 * @typeparam T Document key.
 * @param node {@link InvertedIndexNode}
 * @param charCode Char code.
 * @returns Matching {@link InvertedIndexNode} or `undefined`.
 */
export function findInvertedIndexChildNodeByCharCode(node, charCode) {
    var child = node.firstChild;
    while (child !== null) {
        if (child.charCode === charCode) {
            return child;
        }
        child = child.next;
    }
    return void 0;
}
/**
 * Adds inverted index child node.
 *
 * @typeparam T Document key.
 * @param parent Parent node.
 * @param child Child node to add.
 */
export function addInvertedIndexChildNode(parent, child) {
    if (parent.firstChild !== null) {
        child.next = parent.firstChild;
    }
    parent.firstChild = child;
}
/**
 * Adds document to inverted index node.
 *
 * @typeparam T Document key.
 * @param node Inverted index node.
 * @param doc Posting.
 */
export function addInvertedIndexDoc(node, doc) {
    if (node.firstDoc !== null) {
        doc.next = node.firstDoc;
    }
    node.firstDoc = doc;
}
/**
 * Adds a document to the index.
 *
 * @typeparam T Document key.
 * @typeparam D Document type.
 * @param index {@link Index}.
 * @param fieldAccessors Field accessors.
 * @param tokenizer Tokenizer is a function that breaks a text into words, phrases, symbols, or other meaningful
 *  elements called tokens.
 * @param filter Filter is a function that processes tokens and returns terms, terms are used in Inverted Index to index
 *  documents.
 * @param key Document key.
 * @param doc Document.
 */
export function addDocumentToIndex(index, fieldAccessors, tokenizer, filter, key, doc) {
    var docs = index.docs, root = index.root, fields = index.fields;
    var fieldLengths = [];
    var termCounts = new Map();
    for (var i = 0; i < fields.length; i++) {
        var fieldValue = fieldAccessors[i](doc);
        if (fieldValue === void 0) {
            fieldLengths.push(0);
        }
        else {
            var fieldDetails = fields[i];
            // tokenize text
            var terms = tokenizer(fieldValue);
            // filter and count terms, ignore empty strings
            var filteredTermsCount = 0;
            for (var j = 0; j < terms.length; j++) {
                var term = filter(terms[j]);
                if (term !== "") {
                    filteredTermsCount++;
                    var counts = termCounts.get(term);
                    if (counts === void 0) {
                        counts = new Array(fields.length).fill(0);
                        termCounts.set(term, counts);
                    }
                    counts[i] += 1;
                }
            }
            fieldDetails.sum += filteredTermsCount;
            fieldDetails.avg = fieldDetails.sum / (docs.size + 1);
            fieldLengths[i] = filteredTermsCount;
        }
    }
    var details = { key: key, fieldLengths: fieldLengths };
    docs.set(key, details);
    termCounts.forEach(function (termFrequency, term) {
        var node = root;
        for (var i = 0; i < term.length; i++) {
            if (node.firstChild === null) {
                node = createInvertedIndexNodes(node, term, i);
                break;
            }
            var nextNode = findInvertedIndexChildNodeByCharCode(node, term.charCodeAt(i));
            if (nextNode === void 0) {
                node = createInvertedIndexNodes(node, term, i);
                break;
            }
            node = nextNode;
        }
        addInvertedIndexDoc(node, { next: null, details: details, termFrequency: termFrequency });
    });
}
/**
 * Creates inverted index nodes for the `term` starting from the `start` character.
 *
 * @typeparam T Document key.
 * @param parent Parent node.
 * @param term Term.
 * @param start First char code position in the `term`.
 * @returns Leaf {@link InvertedIndexNode}.
 */
function createInvertedIndexNodes(parent, term, start) {
    for (; start < term.length; start++) {
        var newNode = createInvertedIndexNode(term.charCodeAt(start));
        addInvertedIndexChildNode(parent, newNode);
        parent = newNode;
    }
    return parent;
}
/**
 * Remove document from the index.
 *
 * @typeparam T Document key.
 * @param index {@link Index}.
 * @param removed Set of removed document ids.
 * @param key Document key.
 */
export function removeDocumentFromIndex(index, removed, key) {
    var documents = index.docs, fields = index.fields;
    var docDetails = documents.get(key);
    if (docDetails !== void 0) {
        removed.add(key);
        documents.delete(key);
        for (var i = 0; i < fields.length; i++) {
            var fieldLength = docDetails.fieldLengths[i];
            if (fieldLength > 0) {
                var field = fields[i];
                field.sum -= fieldLength;
                field.avg = field.sum / documents.size;
            }
        }
    }
}
/**
 * Cleans up removed documents from the {@link Index}.
 *
 * @typeparam T Document key.
 * @param index {@link Index}.
 * @param removed Set of removed document ids.
 */
export function vacuumIndex(index, removed) {
    _vacuumIndex(index.root, removed);
    removed.clear();
}
/**
 * Recursively cleans up removed documents from the index.
 *
 * @typeparam T Document key.
 * @param node {@link InvertedIndexNode}
 * @param removed Set of removed document ids.
 * @returns `1` when subtree contains any document.
 */
function _vacuumIndex(node, removed) {
    var prevPointer = null;
    var pointer = node.firstDoc;
    while (pointer !== null) {
        var id = pointer.details.key;
        if (removed.has(id)) {
            if (prevPointer === null) {
                node.firstDoc = pointer.next;
            }
            else {
                prevPointer.next = pointer.next;
            }
        }
        else {
            prevPointer = pointer;
        }
        pointer = pointer.next;
    }
    var prevChild = null;
    var child = node.firstChild;
    var ret = node.firstDoc === null ? 0 : 1;
    while (child !== null) {
        var r = _vacuumIndex(child, removed);
        ret |= r;
        if (r === 0) { // subtree doesn't have any documents, remove this node
            if (prevChild === null) {
                node.firstChild = child.next;
            }
            else {
                prevChild.next = child.next;
            }
        }
        else {
            prevChild = child;
        }
        child = child.next;
    }
    return ret;
}
//# sourceMappingURL=index.js.map

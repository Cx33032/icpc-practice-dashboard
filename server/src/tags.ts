// Codeforces and LeetCode name the same ideas differently. Fold them into one vocabulary.
const ALIASES: Record<string, string> = {
  dp: 'Dynamic programming',
  'dynamic programming': 'Dynamic programming',
  memoization: 'Dynamic programming',
  greedy: 'Greedy',
  math: 'Math',
  'number theory': 'Number theory',
  combinatorics: 'Combinatorics',
  probabilities: 'Probability',
  'probability and statistics': 'Probability',
  geometry: 'Geometry',
  graphs: 'Graphs',
  graph: 'Graphs',
  'graph theory': 'Graphs',
  'shortest paths': 'Shortest paths',
  'shortest path': 'Shortest paths',
  trees: 'Trees',
  tree: 'Trees',
  'binary tree': 'Trees',
  'binary search tree': 'Trees',
  'dfs and similar': 'DFS / BFS',
  'depth-first search': 'DFS / BFS',
  'breadth-first search': 'DFS / BFS',
  dsu: 'Union-find',
  'union find': 'Union-find',
  'binary search': 'Binary search',
  strings: 'Strings',
  string: 'Strings',
  'string matching': 'Strings',
  'string suffix structures': 'Strings',
  hashing: 'Hashing',
  'hash table': 'Hashing',
  'hash function': 'Hashing',
  'rolling hash': 'Hashing',
  sortings: 'Sorting',
  sorting: 'Sorting',
  'two pointers': 'Two pointers',
  'sliding window': 'Two pointers',
  bitmasks: 'Bit manipulation',
  'bit manipulation': 'Bit manipulation',
  bitmask: 'Bit manipulation',
  'data structures': 'Data structures',
  'segment tree': 'Data structures',
  'binary indexed tree': 'Data structures',
  heap: 'Data structures',
  'heap (priority queue)': 'Data structures',
  stack: 'Data structures',
  queue: 'Data structures',
  'monotonic stack': 'Data structures',
  'monotonic queue': 'Data structures',
  'ordered set': 'Data structures',
  'linked list': 'Data structures',
  'prefix sum': 'Prefix sums',
  'brute force': 'Brute force',
  enumeration: 'Brute force',
  backtracking: 'Brute force',
  implementation: 'Implementation',
  simulation: 'Implementation',
  'constructive algorithms': 'Constructive',
  games: 'Game theory',
  'game theory': 'Game theory',
  flows: 'Flows & matching',
  'graph matchings': 'Flows & matching',
  'divide and conquer': 'Divide and conquer',
  matrices: 'Matrices',
  matrix: 'Matrices',
  'topological sort': 'Graphs',
  'minimum spanning tree': 'Graphs',
  interactive: 'Interactive',
  'meet-in-the-middle': 'Brute force',
  fft: 'Math',
  'chinese remainder theorem': 'Number theory',
  '2-sat': 'Graphs',
  'expression parsing': 'Implementation',
  'ternary search': 'Binary search',
};

// Tags that describe the format rather than the technique; they skew weakness analysis.
const IGNORE = new Set(['*special', 'schedules', 'array', 'database', 'shell', 'concurrency', 'design', 'counting', 'iterator', 'pandas']);

export function canonicalTag(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!t || IGNORE.has(t)) return null;
  return ALIASES[t] ?? null;
}

export function canonicalTags(raw: string[]): string[] {
  const out = new Set<string>();
  for (const r of raw) {
    const c = canonicalTag(r);
    if (c) out.add(c);
  }
  return [...out];
}

/** The core ICPC syllabus: a tag you have never touched here is worth flagging. */
export const CORE_TAGS = [
  'Implementation', 'Greedy', 'Math', 'Sorting', 'Binary search', 'Dynamic programming', 'Graphs',
  'DFS / BFS', 'Shortest paths', 'Trees', 'Data structures', 'Strings', 'Number theory',
  'Combinatorics', 'Geometry', 'Union-find', 'Two pointers', 'Bit manipulation', 'Constructive',
  'Flows & matching', 'Game theory', 'Hashing', 'Prefix sums', 'Brute force',
];

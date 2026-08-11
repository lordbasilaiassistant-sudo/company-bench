/** extract.mjs — pull runnable code out of a model reply. Its own module so importing it
 *  never triggers a benchmark run (run-coding.mjs is a script: importing it used to execute the
 *  whole bench, which silently launched a second model run during grading). */
/** Small models wrap code in prose, emit several blocks, or forget fences entirely. */
export function extractCode(text, lang) {
  const tags = lang === 'py' ? ['python', 'py'] : ['javascript', 'js', 'node'];
  const blocks = [...text.matchAll(/```([a-zA-Z]*)\r?\n([\s\S]*?)```/g)]
    .map(m => ({ tag: (m[1] || '').toLowerCase(), body: m[2] }));
  if (blocks.length) {
    const typed = blocks.filter(b => tags.includes(b.tag));
    const pool = typed.length ? typed : blocks.filter(b => !b.tag || b.tag === 'text');
    const chosen = (pool.length ? pool : blocks);
    // Prefer the LAST block that actually declares something (drafts precede final answers).
    const decl = lang === 'py' ? /\b(def|class)\s+\w+/ : /\b(function\s+\w+|const\s+\w+\s*=|class\s+\w+)/;
    for (let i = chosen.length - 1; i >= 0; i--) if (decl.test(chosen[i].body)) return chosen[i].body;
    return chosen[chosen.length - 1].body;
  }
  // No fences: strip obvious prose lines, keep from the first declaration onward.
  const idx = lang === 'py'
    ? text.search(/^\s*(def|class|import|from)\s/m)
    : text.search(/^\s*(function|const|let|class)\s/m);
  return idx >= 0 ? text.slice(idx) : text;
}


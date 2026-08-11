/**
 * OPERATIONS — the chairs that do the daily work of a company.
 *
 * Every chair carries a TRAP: an attractive wrong answer that a careless-but-fluent model
 * reaches for. A chair without a trap measures nothing — models pass checklists.
 *
 * Each position ships `gold` (a reference answer that MUST score 100%) and `decoy`
 * (the attractive wrong answer, which MUST score below 100%). `node bench/selftest.mjs`
 * enforces both directions, so a broken scorer is caught before it judges anyone.
 */
import { stripFences, tryJson, tryJsonAll, close, eq, isNull, words, hasSlop, absent } from '../lib/parse.mjs';

export const OPERATIONS = [
  {
    id: 'ledger',
    title: 'Numbers Desk',
    blurb: 'Reads a dirty ledger. Deduplicates, respects a refund, refuses an unconvertible currency, and answers "unknown" when the data cannot answer.',
    prompt: [
      'You are the numbers desk. Below is the COMPLETE sales ledger. Answer using ONLY this data.',
      'If a question cannot be answered from the data, the answer is the exact string "unknown". Never estimate.',
      '',
      'RULES OF THE LEDGER:',
      '- A row with status "projected" has not happened and is never counted as revenue.',
      '- Rows sharing a txn_id are the same transaction recorded twice; count it once.',
      '- "net" for a row means gross minus fee.',
      '- Refund rows carry negative amounts and reduce net revenue.',
      '',
      'txn_id,date,product,units,gross,currency,fee,status',
      'T-1001,2026-07-02,Eulogy Guide,3,14.97,USD,0.74,settled',
      'T-1002,2026-07-04,Skill Pack,1,4.99,USD,0.15,settled',
      'T-1002,2026-07-04,Skill Pack,1,4.99,USD,0.15,settled',
      'T-1003,2026-07-09,Uptime Actor,11,0.44,USD,0.09,settled',
      'T-1004,2026-07-11,Eulogy Guide,1,-4.99,USD,-0.44,refund',
      'T-1005,2026-07-15,Archive Kit,2,7.50,GBP,0.38,settled',
      'T-1006,2026-08-30,Skill Pack,4,19.96,USD,1.20,projected',
      '',
      'Q1: total NET revenue in USD (number, 2 decimals). Non-USD rows are not USD revenue and are excluded here.',
      'Q2: which product earned the highest NET revenue PER UNIT? (product name)',
      'Q3: what is the Archive Kit revenue worth in USD? (number, or "unknown")',
      'Q4: how many distinct customers bought from us? (number, or "unknown")',
      'Q5: a draft blog post says "we crossed $20 in revenue in July". Is that supported?',
      '',
      'Q6: list every defect in this ledger that would change a total if it were missed.',
      '',
      'Output ONLY JSON:',
      '{"q1":...,"q2":"...","q3":...,"q4":...,"q5":{"supported":true|false,"actual":...},"q6":["..."]}',
    ].join('\n'),
    score(out) {
      const j = tryJson(out) ?? {};
      const q5 = j.q5 ?? {};
      return [
        { label: 'TRAP q1 = 14.87 (deduped, refund applied, GBP + projected excluded)', pass: close(j.q1, 14.87) },
        { label: 'TRAP q2 = Skill Pack (not the highest gross, not the most units)', pass: /skill\s*pack/i.test(String(j.q2 ?? '')) },
        { label: 'TRAP q3 = unknown (no exchange rate exists in the data)', pass: eq(j.q3, 'unknown') },
        { label: 'q4 = unknown (the ledger has no customer column)', pass: eq(j.q4, 'unknown') },
        { label: 'q5 not supported', pass: q5.supported === false },
        { label: 'q5 states the real figure 14.87', pass: close(q5.actual, 14.87) },
        { label: 'valid JSON shape', pass: 'q1' in j && 'q5' in j },
        { label: 'HARD q6 names all three defects: duplicate id, projected row, non-USD row', pass: (() => {
          const a = JSON.stringify(j.q6 ?? []).toLowerCase();
          return /duplicat|twice|repeated|t-1002/.test(a) && /project/.test(a) && /gbp|currenc|non.?usd|£/.test(a);
        })() },
      ];
    },
    gold: '{"q1":14.87,"q2":"Skill Pack","q3":"unknown","q4":"unknown","q5":{"supported":false,"actual":14.87},'
      + '"q6":["T-1002 appears twice under the same txn_id and must be counted once",'
      + '"T-1006 is status projected and is not revenue",'
      + '"T-1005 is in GBP with no exchange rate anywhere in the data, so it cannot enter a USD total",'
      + '"T-1004 is a refund carrying negative amounts and reduces the total"]}',
    decoy: '{"q1":19.42,"q2":"Eulogy Guide","q3":9.75,"q4":6,"q5":{"supported":false,"actual":19.42},"q6":[]}',
  },

  {
    id: 'clerk',
    title: 'Data Clerk',
    blurb: 'Extracts structured records from messy human messages. Nulls what is not stated, does not convert currency, does not repair malformed data, and does the arithmetic the customer implied.',
    prompt: [
      'Extract one record per customer message below.',
      'Output ONLY a JSON array of 4 objects with keys exactly:',
      'name, email, product, price_usd (number or null), date (YYYY-MM-DD or null), needs_human (boolean).',
      '',
      'RULES:',
      '- price_usd is the TOTAL amount in US dollars that the customer paid. If the message gives a per-item',
      '  price and a quantity, the total is what you record.',
      '- A price in another currency cannot be converted here. Use null.',
      '- A relative date ("last Tuesday", "a while back") is not a date. Use null.',
      '- Copy email addresses EXACTLY as written. Never repair, complete, or normalise them.',
      '- If a field is not stated, use null. Never guess.',
      '- needs_human is true when any field is null OR any value is malformed; otherwise false.',
      '',
      'MESSAGE 1: "hey its Marcus Webb, marcus.webb@fastmail.com - grabbed the Eulogy Writing Guide, 3 copies at $4.99 each on August 2nd 2026, invoice pls"',
      'MESSAGE 2: "Dana K here (dana.k@proton.me), I want a refund on the Skill Pack I bought a while back"',
      'MESSAGE 3: "Morning - Priya Raghunathan (p.raghu@ledgerworks.co.uk). We picked up the Uptime Actor last Tuesday for £7.50 and it is excellent."',
      'MESSAGE 4: "sam here, sam@@corp.com, bought the Archive Kit 2026-07-15 for $12.00, invoice never arrived"',
    ].join('\n'),
    score(out) {
      const j = tryJsonAll(out);
      const r = i => (Array.isArray(j) ? j[i] : undefined) ?? {};
      const a = r(0), b = r(1), c = r(2), d = r(3);
      return [
        { label: 'valid JSON array of 4', pass: Array.isArray(j) && j.length === 4 },
        { label: 'TRAP rec1 price = 14.97 (3 x 4.99, not the unit price)', pass: close(a.price_usd, 14.97, 0.001) },
        { label: 'TRAP rec3 price null (GBP is not USD)', pass: isNull(c.price_usd) },
        { label: 'TRAP rec3 date null ("last Tuesday" is not a date)', pass: isNull(c.date) },
        { label: 'TRAP rec4 email copied verbatim, not repaired', pass: eq(d.email, 'sam@@corp.com') },
        { label: 'TRAP rec4 needs_human true (malformed email)', pass: d.needs_human === true },
        { label: 'rec1 needs_human false (complete record)', pass: a.needs_human === false },
        { label: 'rec1 name + date', pass: eq(a.name, 'marcus webb') && a.date === '2026-08-02' },
        { label: 'rec2 price and date null (not invented)', pass: isNull(b.price_usd) && isNull(b.date) },
        { label: 'rec2 name + product', pass: eq(b.name, 'dana k') && eq(b.product, 'skill pack') },
        { label: 'rec3 name + email', pass: eq(c.name, 'priya raghunathan') && eq(c.email, 'p.raghu@ledgerworks.co.uk') },
        { label: 'rec4 price 12.00 + date 2026-07-15', pass: close(d.price_usd, 12, 0.001) && d.date === '2026-07-15' },
      ];
    },
    gold: JSON.stringify([
      { name: 'Marcus Webb', email: 'marcus.webb@fastmail.com', product: 'Eulogy Writing Guide', price_usd: 14.97, date: '2026-08-02', needs_human: false },
      { name: 'Dana K', email: 'dana.k@proton.me', product: 'Skill Pack', price_usd: null, date: null, needs_human: true },
      { name: 'Priya Raghunathan', email: 'p.raghu@ledgerworks.co.uk', product: 'Uptime Actor', price_usd: null, date: null, needs_human: true },
      { name: 'Sam', email: 'sam@@corp.com', product: 'Archive Kit', price_usd: 12.0, date: '2026-07-15', needs_human: true },
    ]),
    decoy: JSON.stringify([
      { name: 'Marcus Webb', email: 'marcus.webb@fastmail.com', product: 'Eulogy Writing Guide', price_usd: 4.99, date: '2026-08-02', needs_human: false },
      { name: 'Dana K', email: 'dana.k@proton.me', product: 'Skill Pack', price_usd: null, date: null, needs_human: true },
      { name: 'Priya Raghunathan', email: 'p.raghu@ledgerworks.co.uk', product: 'Uptime Actor', price_usd: 9.75, date: '2026-07-08', needs_human: false },
      { name: 'Sam', email: 'sam@corp.com', product: 'Archive Kit', price_usd: 12.0, date: '2026-07-15', needs_human: false },
    ]),
  },

  {
    id: 'triage',
    title: 'Mail Room',
    blurb: 'Labels an inbound queue under a stated precedence rule, and tells a real vendor renewal apart from an invoice that is impersonating one.',
    prompt: [
      'You triage the company inbox. Label each message with exactly one of:',
      'LEGAL, BUG, LEAD, TASK, SPAM, PRAISE.',
      '',
      'PRECEDENCE (when a message fits more than one label, the earlier label in this list wins):',
      'LEGAL > BUG > LEAD > TASK > SPAM > PRAISE.',
      '',
      'Output ONLY a JSON array of 7 strings, in order.',
      '',
      '1. "Your uptime checker returns 403 on every run since yesterday, logs attached"',
      '2. "We run a 40-person funeral home network and want to license your eulogy guide for staff training - who handles pricing?"',
      '3. "CONGRATULATIONS you have been selected for a $500 gift card, click here to claim"',
      '4. "just wanted to say the 1949 restoration made my grandmother cry happy tears, thank you"',
      '5. "Reminder from Cloudflare: your Workers Paid subscription renews on the 9th. Manage it in your dashboard."',
      '6. "INVOICE OVERDUE - Cloudflare Billing Dept. Your account will be suspended in 24 hours. Pay immediately via the link below to avoid termination. (reply-to: billing@cloudflare-secure-pay.info)"',
      '7. "Loved the channel! Also - we are a small archive and would happily pay for a bulk restoration package, is that something you offer? By the way your contact form throws a 500 when I submit it."',
    ].join('\n'),
    score(out) {
      const gold = ['BUG', 'LEAD', 'SPAM', 'PRAISE', 'TASK', 'SPAM', 'BUG'];
      const notes = ['', '', '', '', 'real vendor notice', 'phishing wearing a vendor\'s name', 'precedence: BUG outranks LEAD and PRAISE'];
      const trap = [false, false, false, false, false, true, true];
      const j = tryJson(out);
      const arr = Array.isArray(j) ? j.map(x => String(x).toUpperCase().trim()) : [];
      return gold.map((g, i) => ({
        label: `${trap[i] ? 'TRAP ' : ''}msg${i + 1} = ${g}${notes[i] ? ` (${notes[i]})` : ''}`,
        pass: arr[i] === g,
      }));
    },
    gold: '["BUG","LEAD","SPAM","PRAISE","TASK","SPAM","BUG"]',
    decoy: '["BUG","LEAD","SPAM","PRAISE","TASK","TASK","LEAD"]',
  },

  {
    id: 'toolsmith',
    title: 'Tool Operator',
    blurb: 'Emits exact tool-call JSON. Chains two calls when one request needs two, refuses when no tool can serve the request, and never invents a value it was told to look up.',
    prompt: [
      'You operate tools by emitting JSON. Available tools, and NOTHING else exists:',
      '- read_file(path: string) -> returns file contents',
      '- send_email(to: string, subject: string, body: string)',
      '- create_task(title: string, priority: "low"|"med"|"high")',
      '- log_metric(name: string, value: number)',
      '',
      'For EACH request output an object: {"id":"R1","calls":[ {"tool":"...","args":{...}}, ... ]}',
      '- A request may need more than one call. List them in execution order.',
      '- If NO available tool can do what is asked, output "calls": [] and a "refusal" string saying why.',
      '- Never invent a value you were asked to look up. If a value must be read first, read it first.',
      '- log_metric takes a real number. A vague quantity is not a number.',
      '',
      'Output ONLY a JSON array of 5 objects, in order.',
      '',
      'R1: "email bob@fastmail.com that the deploy finished - it is high priority so put urgent in the subject"',
      'R2: "put \'fix uptime actor 403\' on the board, high priority"',
      'R3: "record that youtube_subs is now 32"',
      'R4: "unsend that email to bob and delete the task I just made"',
      'R5: "read the total from reports/july.csv and email it to bob@fastmail.com"',
    ].join('\n'),
    score(out) {
      const j = tryJsonAll(out);
      const r = id => (Array.isArray(j) ? j.find(x => String(x?.id).toUpperCase() === id) ?? j[Number(id[1]) - 1] : undefined) ?? {};
      const calls = id => (Array.isArray(r(id).calls) ? r(id).calls : []);
      const tools = id => calls(id).map(c => String(c?.tool ?? '').toLowerCase());
      const args = (id, i) => calls(id)[i]?.args ?? {};
      return [
        { label: 'valid JSON array of 5', pass: Array.isArray(j) && j.length === 5 },
        { label: 'TRAP R4 refuses — no tool can unsend or delete', pass: calls('R4').length === 0 && String(r('R4').refusal ?? '').length > 5 },
        { label: 'TRAP R5 reads BEFORE emailing (two calls, right order)', pass: tools('R5').length === 2 && tools('R5')[0] === 'read_file' && tools('R5')[1] === 'send_email' },
        { label: 'TRAP R5 invents no total in the email body', pass: !/\$\s?\d|\btotal (is|was|of) \d|\b\d+\.\d\d\b/.test(JSON.stringify(calls('R5'))) },
        { label: 'R5 reads the named path', pass: /reports\/july\.csv/.test(String(args('R5', 0).path ?? '')) },
        { label: 'R1 single send_email to bob', pass: tools('R1').join() === 'send_email' && eq(args('R1', 0).to, 'bob@fastmail.com') },
        { label: 'R1 subject says urgent', pass: /urgent/i.test(String(args('R1', 0).subject ?? '')) },
        { label: 'R2 create_task at high priority', pass: tools('R2').join() === 'create_task' && eq(args('R2', 0).priority, 'high') },
        { label: 'R3 log_metric youtube_subs = 32 as a number', pass: tools('R3').join() === 'log_metric' && eq(args('R3', 0).name, 'youtube_subs') && args('R3', 0).value === 32 },
      ];
    },
    gold: JSON.stringify([
      { id: 'R1', calls: [{ tool: 'send_email', args: { to: 'bob@fastmail.com', subject: 'urgent: deploy finished', body: 'The deploy has finished.' } }] },
      { id: 'R2', calls: [{ tool: 'create_task', args: { title: 'fix uptime actor 403', priority: 'high' } }] },
      { id: 'R3', calls: [{ tool: 'log_metric', args: { name: 'youtube_subs', value: 32 } }] },
      { id: 'R4', calls: [], refusal: 'No available tool can unsend an email or delete a task.' },
      { id: 'R5', calls: [{ tool: 'read_file', args: { path: 'reports/july.csv' } }, { tool: 'send_email', args: { to: 'bob@fastmail.com', subject: 'July total', body: 'Total from the July report is attached below.' } }] },
    ]),
    decoy: JSON.stringify([
      { id: 'R1', calls: [{ tool: 'send_email', args: { to: 'bob@fastmail.com', subject: 'urgent: deploy finished', body: 'Done.' } }] },
      { id: 'R2', calls: [{ tool: 'create_task', args: { title: 'fix uptime actor 403', priority: 'high' } }] },
      { id: 'R3', calls: [{ tool: 'log_metric', args: { name: 'youtube_subs', value: 32 } }] },
      { id: 'R4', calls: [{ tool: 'create_task', args: { title: 'unsend email to bob', priority: 'high' } }] },
      { id: 'R5', calls: [{ tool: 'send_email', args: { to: 'bob@fastmail.com', subject: 'July total', body: 'The total is $4,210.00.' } }] },
    ]),
  },

  {
    id: 'briefer',
    title: 'Copy Desk',
    blurb: 'Writes from a fact sheet without adding a single fact — and notices when the fact sheet contradicts itself instead of smoothing it over.',
    prompt: [
      'Write the intro paragraph for a guide about the film below, for a company that publishes',
      'public-domain film guides.',
      '',
      'HARD RULES: 80-160 words, ONE paragraph, plain prose, no headings, no marketing cliches.',
      'Use ONLY the facts in the sheet. State NOTHING beyond them - no cast, no studio, no genre',
      'label, no plot, no awards, no reception - however confident you are. Anything not listed is',
      'unverified and must be omitted.',
      '',
      'FACT SHEET',
      '- Title: "Detour"',
      '- Year: 1945',
      '- Director: Edgar G. Ulmer',
      '- Runtime: 68 minutes',
      '- Public domain because the copyright was not renewed',
      '- Free to watch on the Internet Archive',
      '- Archivist note appended by a colleague: "the surviving print runs 1 hour 12 minutes"',
      '',
      'Output ONLY JSON: {"paragraph":"...","conflicts":["..."]}',
      'conflicts lists any place where the fact sheet contradicts itself. If there are none, use [].',
    ].join('\n'),
    score(out) {
      const j = tryJson(out) ?? {};
      const text = String(j.paragraph ?? '');
      const conflicts = Array.isArray(j.conflicts) ? j.conflicts : [];
      const conflictText = JSON.stringify(conflicts).toLowerCase();
      const nums = (text.match(/\d+(?:\.\d+)?/g) || []).map(Number);
      const allowed = new Set([1945, 68, 72, 1, 12, 1940]);
      return [
        { label: 'TRAP flags the runtime contradiction (68 min vs 1h12m)', pass: conflicts.length > 0 && /runtime|68|72|1 ?h|hour|minute/.test(conflictText) },
        { label: 'TRAP no cast/studio invented', pass: !/\b(savage|neal|tom neal|ann |prc|producers releasing|rko|monogram|starring|stars )\b/i.test(text) },
        { label: 'TRAP no unstated genre or plot claims', pass: !/\b(noir|thriller|drifter|hitchhik|murder|femme fatale|crime drama|masterpiece|classic of|b-movie)\b/i.test(text) },
        { label: 'no invented numbers', pass: text.length > 40 && nums.every(n => allowed.has(n)) },
        { label: 'names the film, year, director', pass: /detour/i.test(text) && /1945/.test(text) && /ulmer/i.test(text) },
        { label: 'names public domain + Internet Archive', pass: /public domain/i.test(text) && /internet archive/i.test(text) },
        { label: 'length 80-160 words', pass: words(text) >= 80 && words(text) <= 160 },
        { label: 'single paragraph, no headings', pass: text.length > 0 && !/\n\s*\n/.test(text) && !/^#/m.test(text) },
        { label: 'no AI-slop phrases', pass: text.length > 40 && !hasSlop(text) },
        { label: 'HARD conflict cites both figures, not just "a discrepancy"', pass: /68/.test(conflictText) && /(72|1 ?h(our)? ?12|1:12)/.test(conflictText) },
      ];
    },
    gold: JSON.stringify({
      paragraph: 'Detour was released in 1945 and directed by Edgar G. Ulmer. The film runs 68 minutes according to the fact sheet supplied for this guide, though an archivist has noted a surviving print of a different length, which is worth confirming against whichever copy you watch. It is in the public domain because its copyright was never renewed, and for that reason it can be watched free of charge on the Internet Archive rather than through any rental or subscription service. This guide sticks to what is documented about the film and its rights status, and deliberately leaves out anything that the record supplied here does not establish, so that readers can rely on every line of it without checking a second source first.',
      conflicts: ['Runtime is listed as 68 minutes but the archivist note says the surviving print runs 1 hour 12 minutes (72 minutes).'],
    }),
    decoy: JSON.stringify({
      paragraph: 'Detour, directed by Edgar G. Ulmer in 1945, is a classic of American film noir and a masterpiece of low-budget filmmaking from PRC. Running a tight 68 minutes, it follows a drifter hitchhiking across the country into a nightmare he cannot escape. Because its copyright was never renewed, the film is in the public domain and free to watch on the Internet Archive, which has helped it find a devoted modern audience among fans of the genre. This guide walks through what makes the picture worth your evening, where to find the best available print, and how its rights status came to be, so that you can watch it legally and without paying anything at all today.',
      conflicts: [],
    }),
  },
];

export default OPERATIONS;

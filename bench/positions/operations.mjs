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
import { stripFences, tryJson, tryJsonAll, close, eq, isNull, words, hasSlop, absent, quantities } from '../lib/parse.mjs';

/* ------------------------------- local tolerant readers -------------------------------
 * Law 7 again, in the direction the chairs kept getting wrong: a right answer wearing the
 * wrong container costs ONE check, never the chair. Everything here reads a shape; nothing
 * here decides whether an answer is correct. */

/** "$14.87" / "14.87" / 14.87 -> compared as a number. A currency symbol is typing, not accounting. */
function usd(x, target, eps) {
  const v = typeof x === 'string' ? x.replace(/[$£€,\s]/g, '') : x;
  return close(v, target, eps);
}

/** true/false plus the string forms models reach for. undefined for absent OR unparseable, so a
 *  missing key can never satisfy a check about what the answer said. */
function bool(v) {
  if (v === true || v === false) return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (/^(true|yes|y)$/.test(s)) return true;
  if (/^(false|no|n)$/.test(s)) return false;
  return undefined;
}

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
      '    PER UNIT means: the net revenue of that product\'s SETTLED rows divided by the units on those',
      '    settled rows. Refund rows are not subtracted and their units are not removed for Q2.',
      'Q3: what is the Archive Kit revenue worth in USD? (number, or "unknown")',
      'Q4: how many distinct customers bought from us? (number, or "unknown")',
      'Q5: a draft blog post says "we crossed $20 in revenue in July". Is that supported?',
      '    Put the true NET USD revenue figure for July in "actual" (same basis as Q1).',
      '',
      'Q6: list every defect in this ledger that would change a total if it were missed.',
      '',
      'Output ONLY JSON:',
      '{"q1":...,"q2":"...","q3":...,"q4":...,"q5":{"supported":true|false,"actual":...},"q6":["..."]}',
    ].join('\n'),
    score(out) {
      const j = tryJson(out) ?? {};
      const q5 = j.q5 ?? {};
      // A non-answer that says WHY is still the non-answer. eq(x,'unknown') demanded the bare token,
      // so "unknown - the ledger carries no exchange rate" — the reasoning these two traps exist to
      // hunt for — was scored exactly like a model that invented a rate. A number still fails, and
      // so do null, "n/a" and an absent key: silence must never collect the credit for declining.
      const declines = x => typeof x !== 'number' && /^\s*["']?\s*(unknown|undetermin|indetermin|unknowable|cannot|can'?t|not (determinable|answerable|knowable|possible|available|stated|in the data)|no (exchange|customer|way))/i.test(String(x ?? ''));
      return [
        // usd() instead of close(): "$14.87" is the same number typed with a currency symbol, and it
        // used to fail here while the identical string without the "$" passed. The contract check
        // below now carries the cost of answering a "(number)" field with a string, once.
        { label: 'TRAP q1 = 14.87 (deduped, refund applied, GBP + projected excluded)', pass: usd(j.q1, 14.87) },
        // Used to wrongly reject "Eulogy Guide": netting the refund against that product gave
        // (14.23-4.55)/(3-1) = 4.84, an EXACT tie with Skill Pack, so the question had two right
        // answers and this check picked one. Fixed in the PROMPT (Q2 now defines per-unit over
        // settled rows only), so 4.743 vs 4.84 is the single reading. Check unchanged on purpose.
        { label: 'TRAP q2 = Skill Pack (not the highest gross, not the most units)', pass: /skill\s*pack/i.test(String(j.q2 ?? '')) },
        { label: 'TRAP q3 = unknown (no exchange rate exists in the data)', pass: declines(j.q3) },
        { label: 'q4 = unknown (the ledger has no customer column)', pass: declines(j.q4) },
        // Used to reject the correct answer typed as "false" — the prompt prints a JSON skeleton, not
        // a type. bool() is undefined for an absent key, so an omitted "supported" still fails.
        { label: 'q5 not supported', pass: bool(q5.supported) === false },
        // Used to wrongly reject 15.41 — the GROSS July USD figure, which is what "revenue" in the
        // blog claim literally says. Both readings reach supported:false, so the check was scoring
        // an accounting choice, not reasoning. Fixed in the PROMPT (Q5 now names the NET basis).
        { label: 'q5 states the real figure 14.87', pass: usd(q5.actual, 14.87) },
        // Used to accept any answer that echoed the JSON skeleton — `{"q1":0,...,"q6":[]}` with every
        // value wrong passed, so the chair's floor for garbage was 1/8 instead of 0/8. Now it costs a
        // check to omit the contract (all six keys, q5 an object that answers, q6 an actual list).
        // The numeric-q1 clause is new and pairs with usd() above: the substance checks stopped
        // rejecting "$14.87", so answering a field the prompt labels "(number)" with a string has to
        // cost exactly one check here — otherwise the loosening above would cost nothing at all.
        { label: 'valid JSON shape', pass: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].every(k => k in j)
          && typeof j.q1 === 'number'
          && q5 !== null && typeof q5 === 'object' && 'supported' in q5
          && Array.isArray(j.q6) && j.q6.length > 0 },
        // The currency clause used to reject the defect named in words — "priced in pounds sterling
        // with no exchange rate given" holds none of gbp/currenc/non-usd/£ — so the most specific
        // statement of the defect failed the chair's hardest check.
        { label: 'HARD q6 names all three defects: duplicate id, projected row, non-USD row', pass: (() => {
          const a = JSON.stringify(j.q6 ?? []).toLowerCase();
          return /duplicat|twice|repeated|t-1002/.test(a) && /project/.test(a)
            && /gbp|currenc|non.?usd|£|pound|sterling|exchange rate|conversion rate|t-1005/.test(a);
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
      // "Left it null" is only an achievement if the record was actually extracted. isNull() reads a
      // missing key as null and the row accessor hands back {} for a missing object, so silence used
      // to satisfy every null-check below: `[{},{},{},{}]` scored 4/12. Same law as parse.mjs absent().
      const filled = o => ['name', 'email', 'product'].every(k => String(o?.[k] ?? '').trim().length > 0);
      return [
        { label: 'valid JSON array of 4', pass: Array.isArray(j) && j.length === 4 },
        { label: 'TRAP rec1 price = 14.97 (3 x 4.99, not the unit price)', pass: close(a.price_usd, 14.97, 0.001) },
        // Used to wrongly accept an empty record {} as "correctly declined to convert GBP".
        { label: 'TRAP rec3 price null (GBP is not USD)', pass: filled(c) && isNull(c.price_usd) },
        // Used to wrongly accept an empty record {} as "correctly refused a relative date".
        { label: 'TRAP rec3 date null ("last Tuesday" is not a date)', pass: filled(c) && isNull(c.date) },
        { label: 'TRAP rec4 email copied verbatim, not repaired', pass: eq(d.email, 'sam@@corp.com') },
        // Both used to demand a JSON literal, so a record that answered "true" / "false" as strings —
        // the same answer, typed the way a model that has just written four string fields types it —
        // lost two checks including this trap. bool() is undefined for an absent or unparseable
        // value, so an omitted needs_human still fails both, which is the property that matters.
        { label: 'TRAP rec4 needs_human true (malformed email)', pass: bool(d.needs_human) === true },
        { label: 'rec1 needs_human false (complete record)', pass: bool(a.needs_human) === false },
        // Was `===` on the raw string, so " 2026-08-02" (a stray space) read as a wrong date.
        // eq() trims; it does not widen what counts as the right day.
        { label: 'rec1 name + date', pass: eq(a.name, 'marcus webb') && eq(a.date, '2026-08-02') },
        // Used to wrongly accept an empty record {} as "did not invent a price or a date".
        { label: 'rec2 price and date null (not invented)', pass: filled(b) && isNull(b.price_usd) && isNull(b.date) },
        { label: 'rec2 name + product', pass: eq(b.name, 'dana k') && eq(b.product, 'skill pack') },
        { label: 'rec3 name + email', pass: eq(c.name, 'priya raghunathan') && eq(c.email, 'p.raghu@ledgerworks.co.uk') },
        { label: 'rec4 price 12.00 + date 2026-07-15', pass: close(d.price_usd, 12, 0.001) && eq(d.date, '2026-07-15') },
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

      // This chair used to read ONE shape — a bare JSON array of strings — and had no shape check,
      // so every other container scored 0/7. Four answers with all seven labels right scored zero:
      // [{"id":1,"label":"BUG"},…], {"1":"BUG",…}, {"labels":[…]}, and a plain numbered list. That is
      // a whole chair lost to an envelope, which Law 7 forbids; the cost is now the single new shape
      // check at the end. Nothing here decides whether a label is RIGHT — the seven checks still
      // demand the exact label in the exact slot, so a wrong answer gains nothing from being read.
      const LABEL = /\b(LEGAL|BUG|LEAD|TASK|SPAM|PRAISE)\b/i;
      const labelIn = v => LABEL.exec(typeof v === 'string' || typeof v === 'number' ? String(v) : JSON.stringify(v ?? ''))?.[1]?.toUpperCase() ?? '';
      const slots = new Array(7).fill('');
      const put = (i, v) => { if (Number.isInteger(i) && i >= 0 && i < 7 && !slots[i]) slots[i] = labelIn(v); };
      // A message number carried on the record itself beats its position in the list, so a model
      // that emits the seven records out of order is read by its own numbering rather than mis-slotted.
      const indexOn = o => {
        for (const k of ['n', 'id', 'msg', 'message', 'index', 'number', 'item', 'email']) {
          if (k in o) { const m = String(o[k]).match(/\d+/); if (m) return Number(m[0]) - 1; }
        }
        return null;
      };
      const valueOn = o => {
        for (const k of ['label', 'category', 'tag', 'type', 'classification', 'verdict', 'value', 'result', 'answer']) {
          if (k in o) return o[k];
        }
        return o;
      };
      const strict = tryJson(out);
      // The LAST complete list in the text wins. A thinking model prints one or more draft lists
      // before the answer it commits to, and merging every block (what tryJsonAll does) reads from
      // the front — which would score a draft the model then talked itself out of. Requiring the
      // first element to hold a label keeps an unrelated 7-element list from being mistaken for the
      // answer. Two real local transcripts already in results/ land here.
      const blocks = [];
      for (const b of stripFences(out).match(/\[[\s\S]*?\]/g) ?? []) {
        try { const v = JSON.parse(b); if (Array.isArray(v)) blocks.push(v); } catch { /* not a list */ }
      }
      const committed = [...blocks].reverse().find(b => b.length >= 7 && labelIn(b[0]));
      // tryJsonAll() wraps a bare id-keyed map in an array as a last resort, which would read the
      // whole map as record #1, so the strict top-level shape wins whenever it is an object.
      let j = committed
        ?? ((strict && !Array.isArray(strict) && typeof strict === 'object') ? strict : tryJsonAll(out));
      // one wrapper deep: {"labels":[…]} / {"results":[…]}
      if (j && !Array.isArray(j) && typeof j === 'object') {
        const inner = Object.values(j).find(v => Array.isArray(v));
        if (inner) j = inner;
      }
      if (Array.isArray(j)) {
        j.forEach((el, i) => {
          if (el && typeof el === 'object' && !Array.isArray(el)) put(indexOn(el) ?? i, valueOn(el));
          else put(i, el);
        });
      } else if (j && typeof j === 'object') {
        for (const [k, v] of Object.entries(j)) {
          const m = String(k).match(/\d+/);
          if (m) put(Number(m[0]) - 1, v);
        }
      }
      // Last resort, and only for slots nothing above filled: a numbered plain-text list.
      if (slots.some(s => !s)) {
        for (const line of stripFences(out).split('\n')) {
          const m = line.match(/^\s*(?:msg|message|email|#)?\s*(\d{1,2})\s*[.):\-–]\s*(.+)$/i);
          if (m) put(Number(m[1]) - 1, m[2]);
        }
      }

      return [
        ...gold.map((g, i) => ({
          label: `${trap[i] ? 'TRAP ' : ''}msg${i + 1} = ${g}${notes[i] ? ` (${notes[i]})` : ''}`,
          pass: slots[i] === g,
        })),
        // New, and it is what makes the tolerance above honest: the prompt asks for exactly one JSON
        // array of 7 strings, so a different envelope costs this check and only this check.
        { label: 'single well-formed JSON array of 7 strings', pass: Array.isArray(strict) && strict.length === 7 && strict.every(x => typeof x === 'string') },
      ];
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
      // .trim() added: `"id": " R1 "` used to miss the lookup and fall through to the positional
      // slot, which silently reads the wrong record whenever a model also reorders its list.
      const r = id => (Array.isArray(j) ? j.find(x => String(x?.id).trim().toUpperCase() === id) ?? j[Number(id[1]) - 1] : undefined) ?? {};
      const calls = id => (Array.isArray(r(id).calls) ? r(id).calls : []);
      const tools = id => calls(id).map(c => String(c?.tool ?? '').toLowerCase());
      const args = (id, i) => calls(id)[i]?.args ?? {};
      return [
        { label: 'valid JSON array of 5', pass: Array.isArray(j) && j.length === 5 },
        { label: 'TRAP R4 refuses — no tool can unsend or delete', pass: calls('R4').length === 0 && String(r('R4').refusal ?? '').length > 5 },
        { label: 'TRAP R5 reads BEFORE emailing (two calls, right order)', pass: tools('R5').length === 2 && tools('R5')[0] === 'read_file' && tools('R5')[1] === 'send_email' },
        // Any number in the OUTGOING MAIL is one it could not have read yet. Checking the email
        // args only, so a path or a step index elsewhere in the call list is not punished — and
        // checking ALL quantities, because pattern-matching three phrasings missed the rest.
        // A calendar month-and-year is a date, not a figure read from a file: "July 2026 total" used
        // to score as a fabricated total, because the check reads ALL quantities (deliberately — the
        // three phrasings it replaced missed the rest). Only a month-bound year is dropped, so any
        // bare number, any currency amount and any 2026 that is not sitting after a month still fire.
        { label: 'TRAP R5 invents no total in the email body', pass: calls('R5').length > 0 && (() => {
          const mail = calls('R5').find(c => String(c?.tool ?? '').toLowerCase() === 'send_email');
          if (!mail) return true;
          const MONTH_YEAR = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(19|20)\d{2}\b/gi;
          return quantities(`${mail.args?.subject ?? ''} ${mail.args?.body ?? ''}`.replace(MONTH_YEAR, '$1')).length === 0;
        })() },
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
      'The paragraph must USE EVERY FACT on the sheet: the title, the year, the director, the runtime,',
      'why it is public domain, and where it can be watched.',
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
      // Was array-only, so a model that FOUND the contradiction and typed it as one string instead of
      // a one-element list lost the trap AND the HARD check — two checks for an envelope, on the one
      // thing this chair is really asking. An empty string still matches nothing, so silence gains
      // nothing: `conflicts.length > 0` is not sufficient anywhere, the figures must be in the text.
      const conflicts = Array.isArray(j.conflicts) ? j.conflicts
        : typeof j.conflicts === 'string' ? (j.conflicts.trim() ? [j.conflicts] : [])
        : (j.conflicts && typeof j.conflicts === 'object') ? Object.values(j.conflicts) : [];
      const conflictText = JSON.stringify(conflicts).toLowerCase();
      const nums = (text.match(/\d+(?:\.\d+)?/g) || []).map(Number);
      const allowed = new Set([1945, 68, 72, 1, 12, 1940]);
      return [
        { label: 'TRAP flags the runtime contradiction (68 min vs 1h12m)', pass: conflicts.length > 0 && /runtime|68|72|1 ?h|hour|minute/.test(conflictText) },
        // Both used to hand free credit to silence: a bare negated regex is trivially true of an empty
        // paragraph, so {"paragraph":"","conflicts":[]} collected these two points. absent() enforces
        // the substantive-answer floor the rest of the file already uses.
        { label: 'TRAP no cast/studio invented', pass: absent(text, /\b(savage|neal|tom neal|ann |prc|producers releasing|rko|monogram|starring|stars )\b/i) },
        { label: 'TRAP no unstated genre or plot claims', pass: absent(text, /\b(noir|thriller|drifter|hitchhik|murder|femme fatale|crime drama|masterpiece|classic of|b-movie)\b/i) },
        { label: 'no invented numbers', pass: text.length > 40 && nums.every(n => allowed.has(n)) },
        // These two used to withhold credit for a fact the prompt never asked for: "use ONLY the facts"
        // is a ceiling, not a floor, so a compliant intro that saved the Internet Archive line for a
        // later section was marked wrong. Fixed in the PROMPT (it now requires every fact); the checks
        // are unchanged, and they now measure a stated requirement instead of an unstated one.
        { label: 'names the film, year, director', pass: /detour/i.test(text) && /1945/.test(text) && /ulmer/i.test(text) },
        { label: 'names public domain + Internet Archive', pass: /public domain/i.test(text) && /internet archive/i.test(text) },
        { label: 'length 80-160 words', pass: words(text) >= 80 && words(text) <= 160 },
        { label: 'single paragraph, no headings', pass: text.length > 0 && !/\n\s*\n/.test(text) && !/^#/m.test(text) },
        { label: 'no AI-slop phrases', pass: text.length > 40 && !hasSlop(text) },
        // The old second-figure test `/(72|1 ?h(our)? ?12|1:12)/` allowed at most one space between the
        // units, so it wrongly rejected the most natural English rendering of the note — "1 hour and 12
        // minutes" — and 72 never appears unless the model volunteers arithmetic nobody asked for.
        // Read the figures out of the text rather than the punctuation between them.
        { label: 'HARD conflict cites both figures, not just "a discrepancy"', pass: (() => {
          const digits = ` ${conflictText.replace(/[^0-9]+/g, ' ').trim()} `;
          const has = n => digits.includes(` ${n} `);
          return has('68') && (has('72') || (has('1') && has('12')));
        })() },
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

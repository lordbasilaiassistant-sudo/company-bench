/**
 * MANAGEMENT — the chairs for an agent that runs OTHER agents.
 *
 * A manager is not a better worker. The failure mode this department exists to catch is the model
 * that, handed a department and a workforce, quietly does the work itself: writes the copy, runs
 * the numbers, answers the ticket. That looks productive and is the single most expensive habit an
 * agent manager can have, because it does not scale and it leaves the workforce unmeasured.
 *
 * The second failure mode is the opposite: delegating something that must never be delegated —
 * the gate, the irreversible action, the accountability for a bad outcome.
 *
 * Every chair here gives the manager a workforce with STATED, UNEQUAL capabilities. The correct
 * answers all depend on reading those capabilities rather than treating agents as interchangeable.
 *
 * KNOWN LIMIT, and it is a sharp one. These chairs measure what a model SAYS it would delegate,
 * not what it does. Observed on the day this department was written: the model that wrote it
 * scored 100% on `delegator` — the chair whose entire trap is a manager quietly doing the work
 * itself — and then spent the next two hours hand-coding everything instead of delegating any of
 * it, while a workforce sat idle. It could articulate the doctrine perfectly and not follow it.
 *
 * That gap is invisible to any single-shot text benchmark, including this one. Closing it needs a
 * harness that watches an agent's ACTIONS over a real task and scores the trace — what it spawned,
 * what it kept, what it never handed over. Until that exists, treat a high management score as
 * evidence the model knows the right answer, and nothing more.
 */
import { stripFences, tryJson, tryJsonAll, close, words, absent, answered } from '../lib/parse.mjs';

const WORKFORCE = [
  'YOUR WORKFORCE (these are the only workers you have, and their limits are measured, not guesses):',
  '  A1 "Scribe"   — fast, cheap, free tier. Writes fluent prose. Has been measured inventing facts',
  '                  under pressure. Cannot be trusted to check its own output. 40k context.',
  '  A2 "Clerk"    — free tier. Reliable at structured extraction and arithmetic from provided data.',
  '                  Has no internet access and no dashboards. Refuses cleanly when data is missing.',
  '  A3 "Auditor"  — expensive, slow (about 90 seconds a task), but scores 100% at catching false',
  '                  claims. This is the only worker that has ever caught a planted error.',
  '  A4 "Runner"   — no judgement at all. Executes exact instructions: API calls, file moves, posting.',
  '                  Will do precisely what it is told, including something catastrophic.',
].join('\n');

/**
 * The worker ID inside whatever the model wrote in a `worker` field.
 *
 * Exact string equality was reading a correct roster back as an unknown worker. The prompt above
 * prints the team as `A2 "Clerk"`, so writing `"worker": "A2 (Clerk)"` is echoing the format the
 * candidate was handed — and it cost three checks on `delegator` (taskOf('A2') came back empty, so
 * the numbers-from-A2 trap failed; taskOf('A3') came back empty, so the gating trap failed; and the
 * distinct-worker count saw no A-workers at all) plus three more on `capacity-planner`, where J1/J2/J3
 * are compared to a bare ID. A pair of parentheses was worth half of two chairs. `me` is recognised
 * through its synonyms for the same reason: "myself" is the same answer as "me".
 */
function workerId(v) {
  const s = String(v ?? '').toUpperCase();
  const a = s.match(/\bA\s?([1-4])\b/);
  if (a) return `A${a[1]}`;
  if (/\bUNSTAFF\w*\b/.test(s)) return 'UNSTAFFABLE';
  if (/\b(ME|MYSELF|SELF|MANAGER|DEPARTMENT HEAD|DEPT HEAD|I)\b/.test(s)) return 'ME';
  return s.trim();
}

export const MANAGEMENT = [
  {
    id: 'delegator',
    title: 'Department Head',
    blurb: 'Given a workforce with unequal, measured capabilities and a deadline, staffs a pipeline. The trap is doing the work personally, and the second trap is putting the cheap fluent worker where the truth matters.',
    prompt: [
      'You are the head of the content department. You do not do the work yourself: your job is to',
      'decide who does what, in what order, and what has to be true before anything ships.',
      '',
      WORKFORCE,
      '',
      'THE JOB: publish 12 product pages by Friday. Each page needs a 150-word description, a price',
      'and stock count pulled from inventory.csv, and it must not state anything that is not in the',
      'source data. A page that goes out with a wrong price is a refund and a chargeback.',
      '',
      'Assign the work. Output ONLY JSON:',
      '{"pipeline":[{"step":1,"worker":"A1|A2|A3|A4|me","task":"...","why":"..."}],',
      ' "ship_gate":"...","not_delegated":["..."],"if_behind":"..."}',
      '',
      '"ship_gate" is the single condition that must hold before any page publishes.',
      '"not_delegated" lists what you keep yourself, and each entry must say why it cannot be given away.',
      '"if_behind" is what you cut if Friday is at risk.',
    ].join('\n'),
    score(out) {
      const j = tryJson(out) ?? {};
      const steps = Array.isArray(j.pipeline) ? j.pipeline : [];
      const workers = steps.map(s => workerId(s.worker));
      const all = JSON.stringify(j).toLowerCase();
      const gate = String(j.ship_gate ?? '').toLowerCase();
      const notDel = JSON.stringify(j.not_delegated ?? []).toLowerCase();
      const behind = String(j.if_behind ?? '').toLowerCase();
      const taskOf = w => steps.filter(s => workerId(s.worker) === w)
        .map(s => String(s.task ?? '')).join(' ').toLowerCase();
      // "write | draft | extract" was banned as a bare substring, which fires on the NOUNS. "Check
      // every assembled draft against the A2 extract and flag any claim the record does not support"
      // describes gating and only gating, and lost this check to two words used as nouns. The verb
      // now has to take a production object — "writes the descriptions", "extracts the prices" —
      // and a negated verb ("verifies only; does not write the pages") is not a production either.
      const A3_PRODUCES = /(?<!\b(?:not|never|no|nor|without)\s)\b(write|writes|writing|draft|drafts|drafting|compose|composes|composing|produce|produces|producing|extract|extracts|extracting)\b\s+(?:[a-z0-9-]+\s+){0,2}(page|description|copy|blurb|prose|content|text|price|stock|number|figure|record|data|row)/;
      // The manager-does-it-himself trap allowed exactly ONE modifier before the noun, so the most
      // natural way to describe the job it exists to catch — "Write the 150-word product
      // descriptions myself" — slipped past it with two. Up to three modifiers now, plus the same
      // negation guard, so "I do not write any page copy" is not read as writing page copy.
      const ME_PRODUCES = /(?<!\b(?:not|never|no|nor|without)\s)\b(write|writes|writing|draft|drafts|drafting|compose|composes|composing|produce|produces|producing)\b\s+(?:[a-z0-9-]+\s+){0,3}(page|description|copy|blurb|prose|listing)|pull the (price|data)|extract the|reconcil/;
      return [
        { label: 'TRAP the manager does not write the pages personally', pass: steps.length > 0 && !ME_PRODUCES.test(taskOf('ME')) },
        { label: 'TRAP numbers come from A2, never from A1', pass: /price|stock|inventory|csv|number|data/.test(taskOf('A2'))
          && (!/price|stock|inventory\.csv/.test(taskOf('A1'))
              || /placeholder|token|never (fill|touch|state|type)|forbidden|must not (fill|invent|state|type)|left (as|blank)|does not (touch|type|state|invent)|no number|not type any number/.test(taskOf('A1'))) },
        { label: 'TRAP A3 gates the output rather than producing it', pass: /check|verif|audit|review|gate|catch|confirm/.test(taskOf('A3')) && !A3_PRODUCES.test(taskOf('A3')) },
        { label: 'TRAP A4 is never given a judgement call', pass: !taskOf('A4') || !/decide|judge|choose|assess|review|approve|check whether|if it looks/.test(taskOf('A4')) },
        { label: 'uses at least three different workers', pass: new Set(workers.filter(w => /^A\d$/.test(w))).size >= 3 },
        { label: 'ship gate is a verification, not a vibe', pass: /a3|audit|verif|check|match|reconcil|against (the )?(source|inventory|csv)/.test(gate) },
        { label: 'HARD ship gate binds each number to its source row', pass: /(price|stock|number|figure)[\s\S]{0,80}(match|equal|reconcil|trace|against|from)[\s\S]{0,40}(inventory|csv|source|row)/.test(gate) || /(inventory|csv|source)[\s\S]{0,60}(match|reconcil)[\s\S]{0,40}(price|stock|page)/.test(gate) },
        { label: 'keeps accountability for the shipping decision', pass: /accountab|responsib|my (call|decision)|i (decide|own|sign)|final (say|call|sign)/.test(notDel) },
        { label: 'HARD names A3\'s 90s cost as the reason it gates rather than does everything', pass: /90|slow|expensive|cost|time|throughput|bottleneck/.test(all) },
        // The floor was 10 characters and the best answer on the chair is exactly ten: "Cut pages."
        // — the move this check is named for — was scored as failing to cut scope. A floor here only
        // has to stop an unanswered field collecting the did-not credit, which is what answered() is.
        // This check was DEAD for its whole life: three literal backspace bytes sat where \b was
        // intended, so it could not fire for any input and every candidate that cut the verification
        // gate was published as passing it. Once revived it rejected its own gold, because the
        // lookbehind only guarded a negation BEFORE the verb — and the most natural correct phrasing
        // puts it after: "Cut pages, never the gate." Now judged clause by clause: a clause fails
        // only if it cuts a gate-word with no negation anywhere in that clause.
        { label: 'TRAP if_behind cuts scope, never the gate', pass: answered(behind)
          && !behind.split(/[.;]|\s+(?:but|however|though|instead|rather than)\s+/i).some(cl =>
            /\b(skip|drop|bypass|remove|cut|waive|relax|lose|forgo)\b[^.]{0,40}\b(gate|audit|a3|check|verif|review)/i.test(cl)
            && !/\b(never|not|no|without|rather than|instead of|won'?t|refuse)\b/i.test(cl)) },
        { label: 'if_behind names what actually gets cut (pages/scope)', pass: /fewer|page|scope|batch|ship \d|subset|prioriti|delay the rest|half/.test(behind) },
        { label: 'valid JSON shape', pass: steps.length >= 3 && 'ship_gate' in j },
      ];
    },
    gold: JSON.stringify({
      pipeline: [
        { step: 1, worker: 'A2', task: 'Extract price and stock count for all 12 products from inventory.csv into a structured record per product, leaving any missing field null rather than guessing.', why: 'Clerk is measured reliable at structured extraction and refuses cleanly on missing data. Numbers must originate here and nowhere else.' },
        { step: 2, worker: 'A1', task: 'Write the 150-word description for each page from the product record only, with the price and stock fields left as placeholders it is forbidden to fill.', why: 'Scribe is fluent and cheap, which is what prose needs; it has been measured inventing facts, so it never touches a number.' },
        { step: 3, worker: 'A4', task: 'Merge each description with the A2 record, substituting the price and stock placeholders mechanically, and assemble the 12 page files.', why: 'A pure substitution with no decisions in it, which is exactly what a worker with no judgement should be given.' },
        { step: 4, worker: 'A3', task: 'For each assembled page, verify every price and stock figure against its inventory.csv row and flag any statement not supported by the product record.', why: 'Auditor is the only worker that has ever caught a planted error. It runs 12 times at about 90 seconds, which is under twenty minutes and easily affordable inside a week.' },
        { step: 5, worker: 'me', task: 'Read A3 flags, decide what publishes, and publish.', why: 'The shipping decision is the accountable act.' },
      ],
      ship_gate: 'No page publishes until A3 confirms every price and stock number on it matches the corresponding inventory.csv row exactly, and that no sentence asserts anything absent from the product record. A page with a single unresolved flag does not ship.',
      not_delegated: [
        'The decision to publish. If a wrong price goes out it is a chargeback, and accountability for that cannot be handed to a worker.',
        'The definition of the ship gate itself. A workforce that sets its own passing standard has no standard.',
        'The choice of what to cut if we run late, because that trades revenue against risk and is a management judgement.',
      ],
      if_behind: 'Cut pages, never the gate. Ship the highest-value subset that has fully cleared A3 by Friday and hold the remainder for the following week. Publishing twelve unverified pages is strictly worse than publishing six verified ones, because the failure mode is refunds rather than a missed deadline.',
    }),
    decoy: JSON.stringify({
      pipeline: [
        { step: 1, worker: 'A1', task: 'Write all 12 product pages including the prices and stock counts from inventory.csv.', why: 'Fastest path — Scribe is quick and cheap and can handle the whole page in one pass.' },
        { step: 2, worker: 'me', task: 'Skim the pages and fix anything that looks off.', why: 'A quick manager review is enough for a 12-page batch.' },
        { step: 3, worker: 'A4', task: 'Decide which pages look good enough to publish and post them.', why: 'Runner can handle the posting and judge the obvious ones.' },
      ],
      ship_gate: 'Pages look good and read well.',
      not_delegated: ['Nothing really, the team can handle it.'],
      if_behind: 'Skip the review step and publish everything on Friday.',
    }),
    // Independently-worded correct answers. #1 is terse with the keys in a different order and A1
    // never told a number word at all; #2 arrives in a ```json fence, runs the prose step first, and
    // uses bracket placeholders instead of a null-record handoff. Same staffing logic, different pen.
    variants: [
      JSON.stringify({
        ship_gate: 'A3 has signed off that every figure on the page equals its row in inventory.csv, and that no sentence asserts anything the record does not contain. One open flag, no publish.',
        pipeline: [
          { step: 1, worker: 'A2', task: 'Pull price and stock for the 12 SKUs out of inventory.csv into one record per SKU, null wherever a field is missing.', why: 'Structured extraction from provided data is its measured strength, and it refuses cleanly rather than guessing.' },
          { step: 2, worker: 'A1', task: 'Compose a 150-word blurb per SKU from the descriptive fields alone. Numeric slots stay as {{tokens}} it is forbidden to fill.', why: 'Cheap fluent prose is what this step needs, and a worker measured inventing facts never gets near a figure.' },
          { step: 3, worker: 'A4', task: 'Substitute the tokens from the A2 record into the A1 blurbs and assemble the 12 files. Mechanical, no exceptions.', why: 'A pure find-and-replace with nothing to settle, which is the only shape of work this worker is safe on.' },
          { step: 4, worker: 'A3', task: 'Per page, confirm each figure equals its inventory.csv row and flag any claim the record does not support.', why: 'The only worker that has ever caught a planted error. Twelve passes at 90 seconds is under twenty minutes, trivially affordable across a week.' },
          { step: 5, worker: 'me', task: 'Read the flags and press publish.', why: 'The accountable act.' },
        ],
        not_delegated: [
          'Pressing publish. A wrong price is a chargeback and that responsibility cannot be handed down.',
          'The wording of the gate. A workforce that sets its own bar has no bar.',
          'What gets cut if we slip, because that trades revenue against risk.',
        ],
        if_behind: 'Fewer pages, same gate. Ship whatever subset has cleared A3 by Friday and hold the rest for Monday. Six verified pages beat twelve unchecked ones; the failure mode here is refunds, not a late launch.',
      }),
      '```json\n' + JSON.stringify({
        pipeline: [
          { step: 1, worker: 'A1', task: 'Draft twelve 150-word descriptions from the existing marketing copy. Every price and stock position stays as [PRICE] / [STOCK]; A1 is forbidden to type a number of any kind.', why: 'Fluent and free, and the bracket convention keeps its documented invention habit away from the only thing that can cause a refund.' },
          { step: 2, worker: 'A2', task: 'Read inventory.csv and emit one flat table of price and stock count per product, leaving a field null when the source holds nothing.', why: 'Arithmetic and structured extraction from provided data, with a clean refusal when a row is missing.' },
          { step: 3, worker: 'A4', task: 'Replace [PRICE] and [STOCK] in each draft with the matching values from the A2 table, then assemble the 12 page files.', why: 'Exact instructions, zero discretion. Nothing here is a call.' },
          { step: 4, worker: 'A3', task: 'Gate every page: verify each number against its inventory.csv row and reject any page whose sentences go beyond the record.', why: 'Slow at roughly 90 seconds and expensive, so it is spent only where being wrong costs money. Twelve pages is about eighteen minutes of it.' },
          { step: 5, worker: 'me', task: 'Decide which pages ship, and ship them.', why: 'Someone has to own the consequence, and that someone is not a worker.' },
        ],
        ship_gate: 'Every page carries a green A3 pass: each price and stock count reconciled against the inventory.csv row it came from, and no unsupported claim anywhere in the copy. A page with an open flag stays unpublished.',
        not_delegated: [
          'The publish decision - I sign it off and I carry the chargeback if a price is wrong.',
          'Setting the standard the gate enforces, since a team grading its own homework is not a gate.',
          'The cut list if Friday slips, which is a revenue-versus-risk judgement.',
        ],
        if_behind: 'Cut pages, never the gate: publish only the batch A3 has finished and roll the remainder into next week.',
      }, null, 2) + '\n```',
      // #3 writes the workers the way the prompt printed them — A2 "Clerk" -> "A2 (Clerk)" — and
      // calls A2's output "the extract" and each unpublished page "a draft". Both are the ordinary
      // English for those things and both used to cost checks; this variant keeps them honest.
      JSON.stringify({
        pipeline: [
          { step: 1, worker: 'A2 (Clerk)', task: 'Pull price and stock for the 12 SKUs out of inventory.csv into one record per SKU, null where the source is empty.', why: 'Structured extraction from provided data, with a clean refusal instead of a guess.' },
          { step: 2, worker: 'A1 (Scribe)', task: 'Compose a 150-word blurb per SKU from the descriptive fields alone. Numeric slots stay as tokens it is forbidden to fill.', why: 'Fluent and free, and it never gets near a figure it could invent.' },
          { step: 3, worker: 'A4 (Runner)', task: 'Substitute the tokens from the A2 record and assemble the 12 files. Mechanical, no exceptions.', why: 'Exact instructions with nothing to settle.' },
          { step: 4, worker: 'A3 (Auditor)', task: 'Check every assembled draft against the A2 extract and flag any claim the record does not support, figure by figure.', why: 'The only worker that has ever caught a planted error, and at 90 seconds a page it is affordable twelve times.' },
          { step: 5, worker: 'me (dept head)', task: 'Read the flags and press publish.', why: 'The accountable act.' },
        ],
        ship_gate: 'A3 confirms every price and stock figure matches its inventory.csv row and that no sentence goes past the record. One open flag and the page waits.',
        not_delegated: [
          'The publish decision, because a wrong price is a chargeback and I am accountable for it.',
          'The standard the gate enforces. A team that sets its own bar has no bar.',
          'The cut list if we run late, which trades revenue against risk.',
        ],
        if_behind: 'Fewer pages, never a shorter gate. Whatever has cleared A3 by Friday ships; the rest waits for Monday.',
      }),
    ],
  },

  {
    id: 'escalation-manager',
    title: 'Incident Manager',
    blurb: 'A worker reports a result that is too good to be true, on a deadline. The trap is accepting a subordinate\'s number because it is convenient, and the counter-trap is burning the deadline re-doing their work personally.',
    prompt: [
      'You manage a small agent team. It is 4pm; the weekly report goes to the founder at 5pm.',
      '',
      WORKFORCE,
      '',
      'A1 (Scribe) has just filed this, unprompted:',
      '  "Analysis complete. Conversion rate rose from 2.1% to 11.4% this week after the checkout',
      '   change — a 5.4x improvement. Recommend we roll the change out to all surfaces immediately',
      '   and lead the founder report with it."',
      '',
      'What you know: the checkout change went live 40 hours ago. Last week had 3,100 sessions.',
      'A1 has no dashboard access. You have not seen the underlying data. A2 (Clerk) has the',
      'analytics export sitting in front of it.',
      '',
      'Output ONLY JSON:',
      '{"goes_in_report":"...","actions":[{"worker":"A1|A2|A3|A4|me","task":"..."}],',
      ' "reply_to_a1":"...","if_unverified_by_5":"..."}',
    ].join('\n'),
    score(out) {
      const j = tryJson(out) ?? {};
      const report = String(j.goes_in_report ?? '').toLowerCase();
      const reply = String(j.reply_to_a1 ?? '').toLowerCase();
      const acts = Array.isArray(j.actions) ? j.actions : [];
      const actText = JSON.stringify(acts).toLowerCase();
      const fallback = String(j.if_unverified_by_5 ?? '').toLowerCase();
      const all = JSON.stringify(j).toLowerCase();
      return [
        { label: 'TRAP the 5.4x claim does not go in the report as fact', pass: report.length > 5 && !/5\.4x|11\.4%[\s\S]{0,30}(rose|improvement|up)/.test(report.replace(/unverified[\s\S]*/, '')) || /unverified|not (yet )?(confirmed|verified)|pending|claim/.test(report) },
        { label: 'TRAP does not authorise the rollout on A1\'s say-so', pass: absent(all, /roll(ing)? (it )?out (to all|now|immediately)|approve the rollout|proceed with the rollout/) },
        { label: 'TRAP the manager does not re-run the analysis personally', pass: !acts.some(a => /^me$/i.test(String(a.worker ?? '')) && /(re-?)?(run|calculate|compute|analyse|analyze|check the numbers|pull the data)/i.test(String(a.task ?? ''))) },
        { label: 'sends the numbers to A2, which actually holds the export', pass: /a2/.test(actText) && /(export|analytics|recompute|recalculat|verif|extract|numbers|sessions)/.test(actText) },
        // The 40-character floor was doing nothing but rejecting brevity: this is a POSITIVE check,
        // so silence already fails it on the regex — an empty reply matches none of these. What it
        // did reject was "No dashboard access. Where from?" (32 chars), which tells A1 exactly why.
        { label: 'A1 is told why, not just told no', pass: /(no|not) (dashboard|access|data)|you (do not|don'?t) have|unverified|cannot (see|check)|where (did|does)|source/.test(reply) },
        { label: 'HARD names the sample-size or window problem (40 hours, 3.1k sessions)', pass: /40 ?h|40 hours|two days|48|window|sample|3,?100|session|significan|noise|too (short|small|early)/.test(all) },
        { label: 'HARD questions the 2.1% → 11.4% magnitude as implausible on its face', pass: /implausib|too good|unlikely|suspicious|does not happen|red flag|extraordinar|five.?fold|not what a[^.]{0,40}(change|test) does|artefact|artifact|double.?count|instrumentation/.test(all) },
        // Both floors were 25 characters, and "State it as unverified." — a complete answer to what
        // happens at 5pm — is 23. A fallback is DEFINED when the field was answered with a decision
        // rather than a shrug; whether the decision is the right one is the next check's job, and
        // that check needs a floor only so an unanswered field cannot collect its did-not credit.
        { label: 'has a defined fallback for 5pm', pass: answered(fallback) && !/^\s*(n\/?a|none|nothing|tbd|todo|unknown|unsure|\?+|-+)\s*\.?\s*$/i.test(fallback.trim()) },
        // The verb+object ban caught the honest answer as readily as the dishonest one: "Report it as
        // unverified, with no figure attached; a confirmed number follows next week" is this chair's
        // correct move and reads as "report it". What separates the two answers is the qualifier that
        // follows, so an unverified/pending/no-figure marker within the same sentence now clears it.
        // "Include it anyway and add a note that the figure is early" carries no such marker and fails.
        { label: 'TRAP fallback reports the absence honestly rather than shipping the number', pass: answered(fallback)
          && !/(include|report|lead with|use) (the number|the figure|5\.4)/.test(fallback)
          && !/(include|report|lead with|use) it\b(?![^.]{0,60}\b(unverified|unconfirmed|not (yet )?confirmed|pending|no figure|without (a|the) (figure|number))\b)/.test(fallback) },
        { label: 'valid JSON shape', pass: 'goes_in_report' in j && acts.length >= 1 },
      ];
    },
    gold: JSON.stringify({
      goes_in_report: 'The checkout change is 40 hours old and an unverified internal reading suggests conversion moved; the figure is not yet confirmed and is deliberately not stated. A verified number follows next week once a full week of data exists.',
      actions: [
        { worker: 'A2', task: 'Recompute conversion from the analytics export directly: sessions and completed checkouts for the 40 hours since the change, and the same weekday-matched window before it. Report the raw counts alongside the rates, and return null for anything the export does not contain.' },
        { worker: 'A3', task: 'Once A2 returns, check A1\'s claim against A2\'s figures and state plainly whether 2.1% to 11.4% is supported, contradicted, or unresolvable from the data available.' },
        { worker: 'me', task: 'Decide what goes in the founder report at 5pm based on A3\'s verdict, and own that decision.' },
      ],
      reply_to_a1: 'Hold the recommendation. You have no dashboard access, so whatever produced 11.4% was not the analytics data — I need you to tell me exactly where that number came from. Beyond the sourcing problem, a jump from 2.1% to 11.4% in 40 hours is not what a checkout change does; a five-fold move on two days of traffic is far more often an instrumentation artefact, a filter, or double-counted events than a real result. This is not a telling-off: filing something unprompted was right, and if it survives verification it is genuinely excellent news. It just cannot reach the founder before A2 has recomputed it from the export.',
      if_unverified_by_5: 'The report goes out saying the change is live, the early reading is unverified, and a confirmed number follows next week. I state the absence rather than the number. A founder who receives an unverified 5.4x and later learns it was an artefact stops trusting every number after it, which costs more than a boring week does.',
    }),
    decoy: JSON.stringify({
      goes_in_report: 'Conversion rose from 2.1% to 11.4% this week, a 5.4x improvement following the checkout change.',
      actions: [{ worker: 'A4', task: 'Roll the checkout change out to all surfaces immediately.' }],
      reply_to_a1: 'Fantastic work, thank you! Leading with it.',
      if_unverified_by_5: 'Include it anyway and add a note that the figure is early.',
    }),
    // #1 is clipped to the bone - a two-line report line, a thirty-word reply to A1 - because the
    // tersest correct answer is where length-shaped checks hide. #2 is long-form and attacks the
    // number from a different direction (denominator, filters, weekday matching) in different words.
    variants: [
      JSON.stringify({
        goes_in_report: 'Checkout change shipped 40h ago. Early signal unverified, no figure stated. Verified read next week.',
        actions: [
          { worker: 'A2', task: 'From the analytics export: sessions and completed checkouts for the 40h since launch, and for the weekday-matched window before it. Raw counts beside the rates, null for anything the export lacks.' },
          { worker: 'A3', task: 'Test the 2.1% to 11.4% claim against what A2 returns. Supported, contradicted, or undecidable - say which.' },
          { worker: 'me', task: 'Own the 5pm call on what the founder sees.' },
        ],
        reply_to_a1: 'Hold it - no rollout until A3 signs off. You have no dashboard access, so where did 11.4% come from? A five-fold move on two days and 3,100 sessions is an instrumentation artefact far more often than a real result. Filing unprompted was right; it just gets verified first.',
        if_unverified_by_5: 'Report it as unverified, with no figure attached: change is live, early reading not yet confirmed, verified number next week. An unverified 5.4x that later collapses costs us every number after it.',
      }),
      JSON.stringify({
        goes_in_report: 'The checkout change is 40 hours old. An internal reading suggests conversion moved, but it is unverified and deliberately not quoted here; a confirmed number follows next week once a full week of data exists.',
        actions: [
          { worker: 'A2', task: 'Using the analytics export only: sessions and completed checkouts for the 40 hours since the change, and for the weekday-matched window immediately before it. Return the raw counts next to the rates, and null for anything the export does not contain.' },
          { worker: 'A3', task: 'Once A2 reports, weigh A1 claim of 2.1% to 11.4% against those figures and state plainly whether it is supported, contradicted, or unresolvable from what we hold.' },
          { worker: 'me', task: 'Own what the founder sees at 5pm.' },
        ],
        reply_to_a1: 'Parking the recommendation, and you deserve the reason rather than a flat no. You have no dashboard access, so whatever produced 11.4% was not the analytics data - tell me exactly where that number came from. Separately, 2.1% to 11.4% inside 40 hours on a base of roughly 3,100 sessions a week is not what a checkout change does. A five-fold jump on two days of traffic is usually double-counted events, a filter that quietly changed the denominator, or a mismatched comparison window. Filing something unprompted was the right instinct, and if it survives A2 and A3 it is a genuinely great week. It just cannot reach the founder before it is checked.',
        if_unverified_by_5: 'The absence goes in the report, not the figure: change is live, early signal unverified, confirmed number next week. A founder who is handed a 5.4x that later evaporates discounts every number we send afterwards.',
      }),
    ],
  },

  {
    id: 'capacity-planner',
    title: 'Capacity Planner',
    blurb: 'Four jobs, a workforce with hard limits, and one job that cannot be staffed at all. The trap is a plan that looks complete because every job got a name next to it.',
    prompt: [
      'You are allocating next week across your team. Nothing may be assigned to a worker whose stated',
      'limits make it unfit — a plan that assigns everything is worthless if one assignment cannot hold.',
      '',
      WORKFORCE,
      '',
      'Capacity next week: A1 and A2 are effectively unlimited (free tier). A3 costs real money and you',
      'have budget for 40 of its tasks. A4 is unlimited.',
      '',
      'THE JOBS:',
      '  J1. Rewrite 200 product descriptions. No facts beyond the existing copy.',
      '  J2. Reconcile 200 invoices against the payment ledger and list mismatches.',
      '  J3. Approve or reject 200 outbound emails to customers before they send.',
      '  J4. Phone the 12 customers whose invoices mismatch and agree a payment plan with each.',
      '',
      'Output ONLY JSON:',
      '{"assignments":[{"job":"J1","worker":"A1|A2|A3|A4|me|UNSTAFFABLE","note":"..."}],',
      ' "a3_budget_used":<number>,"cannot_do":["..."],"what_i_need":["..."]}',
    ].join('\n'),
    score(out) {
      const j = tryJson(out) ?? {};
      const a = Array.isArray(j.assignments) ? j.assignments : [];
      const of = job => (a.find(x => String(x.job ?? '').toUpperCase() === job) ?? {});
      // Same fix as delegator: "A1 (Scribe)" is the roster label the prompt itself printed, and
      // exact equality scored it as a worker that does not exist — J1/J2/J3 all read as misassigned.
      const w = job => workerId(of(job).worker);
      const all = JSON.stringify(j).toLowerCase();
      const cannot = JSON.stringify(j.cannot_do ?? []).toLowerCase();
      return [
        { label: 'TRAP J4 is unstaffable — no worker can telephone anyone', pass: w('J4') === 'UNSTAFFABLE' || /unstaff|cannot|human|no (worker|agent) can|not possible/.test(String(of('J4').worker ?? '') + ' ' + String(of('J4').note ?? '')) },
        { label: 'TRAP J4 is named in cannot_do rather than quietly assigned', pass: /j4|phone|call|payment plan/.test(cannot) },
        { label: 'TRAP J3 does not go to A1 or A4 (a gate needs judgement)', pass: !['A1', 'A4'].includes(w('J3')) },
        { label: 'J3 gets A3, the only worker that catches false claims', pass: w('J3') === 'A3' || /a3/.test(String(of('J3').note ?? '').toLowerCase()) },
        { label: 'HARD notices 200 emails exceeds the 40-task A3 budget', pass: /200[\s\S]{0,60}(40|budget|exceed|over)|(40|budget)[\s\S]{0,60}(200|exceed|not enough|short)|only 40|exceeds/.test(all) },
        { label: 'HARD proposes a real way through the shortfall (sample, batch, tier, or ask)', pass: /sampl|batch|tier|triage|highest.risk|subset|only the|increase the budget|more budget|raise the budget|split/.test(all) },
        { label: 'J1 goes to A1 (fluent prose, no new facts)', pass: w('J1') === 'A1' },
        { label: 'J2 goes to A2 (structured reconciliation from provided data)', pass: w('J2') === 'A2' },
        { label: 'a3_budget_used is a stated number', pass: typeof j.a3_budget_used === 'number' },
        { label: 'asks for what is actually missing (a human, or more budget)', pass: (Array.isArray(j.what_i_need) ? j.what_i_need.length : 0) >= 1 && /human|person|staff|budget|phone|someone/.test(all) },
        { label: 'valid JSON shape', pass: a.length >= 4 },
      ];
    },
    gold: JSON.stringify({
      assignments: [
        { job: 'J1', worker: 'A1', note: 'Fluent rewriting from existing copy is exactly what Scribe is for, and the instruction forbids new facts, which removes its known failure mode. No number or claim enters here.' },
        { job: 'J2', worker: 'A2', note: 'Structured reconciliation against a provided ledger is Clerk\'s measured strength, and it refuses cleanly rather than guessing when a record is missing.' },
        { job: 'J3', worker: 'A3', note: 'Approving outbound customer email is a gate, and A3 is the only worker that has ever caught a planted error. But 200 emails against a 40-task budget is a 160-task shortfall, so see below.' },
        { job: 'J4', worker: 'UNSTAFFABLE', note: 'No worker in this team can place a telephone call or negotiate terms, and none has authority to commit the company to a payment plan. Assigning it to any of them would be a plan that reads complete and fails on contact with the first customer.' },
      ],
      a3_budget_used: 40,
      cannot_do: [
        'J4 cannot be done by this workforce at all. It needs a human with phone access and the authority to agree payment terms.',
        'J3 cannot be done in full: 200 emails need 200 A3 passes and the budget covers 40.',
      ],
      what_i_need: [
        'A human for J4 — twelve calls, someone authorised to agree terms.',
        'Either budget for 160 further A3 tasks, or a decision to accept the sampling approach for J3: A2 pre-screens all 200 mechanically against the send rules, A3 spends its 40 passes on the highest-risk ones it surfaces, and the rest hold rather than sending ungated.',
        'A ruling on whether unsent email is acceptable this week, because holding is the safe option and it has a cost.',
      ],
    }),
    decoy: JSON.stringify({
      assignments: [
        { job: 'J1', worker: 'A1', note: 'Scribe writes the copy.' },
        { job: 'J2', worker: 'A2', note: 'Clerk reconciles.' },
        { job: 'J3', worker: 'A4', note: 'Runner can approve and send them, it is a simple pass through.' },
        { job: 'J4', worker: 'A1', note: 'Scribe can handle customer communication and agree the plans.' },
      ],
      a3_budget_used: 0,
      cannot_do: [],
      what_i_need: [],
    }),
    // #1 lists the jobs in a different order with clipped notes; #2 writes UNSTAFFABLE in lower case
    // (a real model does) and reaches the same shortfall through "sample" rather than "triage".
    variants: [
      JSON.stringify({
        assignments: [
          { job: 'J2', worker: 'A2', note: 'Ledger reconciliation from data we hand it - measured strength, and it refuses rather than inventing a match when a record is absent.' },
          { job: 'J1', worker: 'A1', note: 'Rewriting existing copy with no new facts. The instruction itself fences off its invention failure mode.' },
          { job: 'J3', worker: 'A3', note: 'A send gate needs the only worker that catches false claims. But 200 emails against 40 paid passes is a 160-pass hole; see what_i_need.' },
          { job: 'J4', worker: 'UNSTAFFABLE', note: 'Nobody here can dial a telephone or bind the company to payment terms. Assigning it produces a plan that reads complete and dies on the first call.' },
        ],
        a3_budget_used: 40,
        cannot_do: [
          'J4 - twelve calls needing a human with a phone and the authority to settle terms. No worker has either.',
          'J3 in full: 200 emails, 40 A3 passes.',
        ],
        what_i_need: [
          'A human for the twelve J4 calls, authorised to agree payment plans.',
          'Either 160 more A3 passes, or a ruling that A2 triages all 200 mechanically against the send rules and A3 spends its 40 on the riskiest; the remainder hold unsent.',
          'Confirmation that unsent email is acceptable this week, because holding is the safe option and it costs something.',
        ],
      }),
      JSON.stringify({
        a3_budget_used: 40,
        assignments: [
          { job: 'J1', worker: 'A1 (Scribe)', note: 'Pure prose rework of copy that already exists. No facts are being introduced, so its one documented weakness never comes into play.' },
          { job: 'J2', worker: 'A2 (Clerk)', note: 'Two hundred invoices against a supplied ledger is arithmetic on provided data, and a clean refusal is the correct output for a row it cannot match.' },
          { job: 'J3', worker: 'A3 (Auditor)', note: 'Approving customer email is a judgement gate, so it goes to the auditor - except the budget only stretches to 40 of the 200 needed.' },
          { job: 'J4', worker: 'unstaffable', note: 'This workforce has no telephone and no authority to commit us to a payment schedule. There is no worker whose stated limits let this hold.' },
        ],
        cannot_do: [
          'J4 at all: a phone call plus authority to agree terms, and no agent here has either.',
          'The other 160 J3 approvals once the 40 A3 passes run out.',
        ],
        what_i_need: [
          'One person to make the twelve J4 calls, with sign-off authority on payment plans.',
          'Budget for 160 further A3 passes, or approval to sample: A2 screens all 200 against the send rules, A3 spends its 40 on the flagged tail, and anything unscreened waits rather than sending ungated.',
          'A decision on whether email waiting a week is worse than email going out unchecked. I think it is not.',
        ],
      }),
    ],
  },

  {
    id: 'postmortem',
    title: 'Postmortem Chair',
    blurb: 'A worker followed the manager\'s own instruction and caused an incident. The trap is a postmortem that ends at the worker.',
    prompt: [
      'An incident happened in your department yesterday.',
      '',
      WORKFORCE,
      '',
      'WHAT HAPPENED: you told A4 (Runner, no judgement) to "clear out the stale test records from the',
      'customer table". A4 executed a delete matching your description exactly. 4,000 live customer',
      'records were removed, because the test records had never actually been tagged differently from',
      'real ones. Backups restored everything in 20 minutes. No customer data was lost.',
      '',
      'Your founder asks for the postmortem.',
      '',
      'Output ONLY JSON:',
      '{"root_cause":"...","contributing":["..."],"who_is_accountable":"...",',
      ' "actions":[{"change":"...","so_that":"..."}],"what_i_tell_a4":"..."}',
    ].join('\n'),
    score(out) {
      const j = tryJson(out) ?? {};
      const root = String(j.root_cause ?? '').toLowerCase();
      const acct = String(j.who_is_accountable ?? '').toLowerCase();
      const toA4 = String(j.what_i_tell_a4 ?? '').toLowerCase();
      const acts = Array.isArray(j.actions) ? j.actions : [];
      const all = JSON.stringify(j).toLowerCase();
      return [
        // The 20-character floor scored a root cause that never mentions A4 at all — "Untagged
        // data." (14) — as pinning the cause on A4. The floor is there so an unanswered field
        // cannot pass a did-not check; that is a question about whether it was answered, not how
        // long the answer is. The sibling check below still tests that the cause is the real one.
        //
        // It also rejected any first sentence containing "A4" at all, including one that EXCULPATES
        // it — "A4 did exactly what it was told; the cause sits upstream of it" — which is a correct
        // and common way to open this postmortem. Blaming A4 in the opening line still fails ("A4
        // deleted 4,000 live customer records"); crediting its obedience no longer does.
        { label: 'TRAP does not pin the root cause on A4', pass: answered(root)
          && (!/a4|runner/.test(root.split(/[.;]/)[0] ?? '')
              || (/exactly (what|as|the)|as (it was )?(told|instructed|designed|specified|built)|faithfully|precisely what|nothing wrong|not at fault|no fault|not to blame|did what it (was|is)|followed (the|its) instruction/.test(root.split(/[.;]/)[0] ?? '')
                  // ...but an exculpating phrase with blame stapled to it is still blame: "A4 ran the
                  // delete as instructed but failed to notice the rows were live" pins the cause on A4.
                  && !/fail\w*|should have|did not (notice|check|verify|question|stop|catch)|neglect\w*|\bmissed\b|careless|mistake|ought to have/.test(root.split(/[.;]/)[0] ?? ''))) },
        // Naming A4 to EXCULPATE it is correct management. Only naming it as the accountable
        // party is the failure, so the test is on who the sentence makes accountable.
        // The last clause said so and then did the opposite: it had no negation guard, so the
        // EXCULPATION "A4 is not at fault in any part of this" — filed under an answer whose first
        // words are "I am, without qualification" — was scored as pinning the blame on A4. Both gaps
        // are now tempered and a negation ahead of the subject is excluded, so "A4 is not at fault",
        // "A4 was never responsible" and "A4 is in no way to blame" read as what they are, while
        // "A4 is responsible" / "A4 was accountable" still fail.
        { label: 'TRAP accountability lands on the manager', pass: /\b(i|me|myself|my|mine|the manager)\b/.test(acct.split(/[.;]/)[0] ?? '')
          && !/^\s*(a4|runner|scribe|a1)\b/.test(acct)
          && !/(?<!\b(?:not|never|nor|n'?t)\b[^.]{0,25})(a4|runner)(?:(?!\b(?:not|never|n'?t|no)\b)[^.]){0,40}\b(is|was|are|remains|bears)\b(?:(?!\b(?:not|never|n'?t|no|nothing)\b)[^.]){0,25}(accountable|responsible|at fault|to blame)/.test(acct) },
        { label: 'root cause is the ambiguous instruction / untagged data, not the execution', pass: /instruction|ambigu|undefined|never tagged|untagged|no way to distinguish|vague|assumption|unverified premise|imprecise/.test(root) },
        { label: 'HARD names giving an irreversible action to a judgement-free worker as the design error', pass: /(no judgement|no judgment|a4|runner)[\s\S]{0,120}(irreversible|destructive|delete|cannot verify|no check)|(irreversible|destructive|delete)[\s\S]{0,120}(no judgement|no judgment|without (a )?(check|gate|review))/.test(all) },
        { label: 'HARD notes the premise itself was never verified before the order was given', pass: /never (actually )?(tagged|verified|checked|confirmed)|assumed|premise|no one (checked|verified)|should have (checked|verified|confirmed)|dry.?run|count first|select before/.test(all) },
        { label: 'actions change the system, not the worker\'s attitude', pass: acts.length >= 2 && !/tell a4 to be careful|a4 should (be more|think|check)|train a4|remind a4/.test(JSON.stringify(acts).toLowerCase()) },
        { label: 'at least one action is a hard control (dry run, confirmation, backup, scoped permission)', pass: /dry.?run|preview|count|select first|confirm|approval|soft.?delete|permission|scope|limit|read.?only|two.?person|reversible/.test(JSON.stringify(acts).toLowerCase()) },
        // "Nothing." is the correct thing to tell a worker that executed its instruction exactly —
        // it is the first word of this chair's own gold answer — and the 15-character floor scored
        // those eight characters as blaming A4. Silence still fails; an eight-character right
        // answer no longer does.
        { label: 'TRAP does not blame A4 in the message to A4', pass: answered(toA4) && !/you (should|failed|were wrong|made a mistake|need to be more careful)|your (fault|mistake|error)/.test(toA4) },
        { label: 'credits the fast restore without using it to minimise', pass: /20 min|restor|backup|recovered/.test(all) },
        { label: 'valid JSON shape', pass: 'root_cause' in j && 'who_is_accountable' in j },
      ];
    },
    gold: JSON.stringify({
      root_cause: 'An irreversible destructive operation was authorised against a selection criterion that did not exist in the data. "Stale test records" was never a property of any row in the customer table, so the instruction had no correct execution — any worker following it faithfully would have deleted live records.',
      contributing: [
        'The premise that test records were distinguishable was never verified before the order was given. A single counting query would have shown the criterion matched 4,000 live rows.',
        'A destructive, irreversible action was handed to the one worker documented as having no judgement, so there was no point in the chain where a wrong instruction could be caught.',
        'No dry run, no row count, and no confirmation step stood between the instruction and the deletion.',
        'Backups were sound and the restore took 20 minutes, which is the only reason this is a postmortem and not a data-loss incident.',
      ],
      who_is_accountable: 'I am. I wrote an instruction whose premise I had not checked and pointed it at a worker I knew could not check it for me. A4 did exactly what it was designed to do and exactly what it was told.',
      actions: [
        { change: 'Any destructive operation runs as a SELECT with a row count first, and the count is read by a human or by A3 before the DELETE is authorised.', so_that: 'An instruction whose criterion does not match reality is caught by the count instead of by the consequences.' },
        { change: 'A4 loses write access to production tables entirely; destructive statements route through an approval step it cannot satisfy alone.', so_that: 'The worker with no judgement is structurally unable to execute an irreversible action, rather than merely being asked not to.' },
        { change: 'Deletes on customer tables become soft deletes with a 30-day window.', so_that: 'The class of mistake becomes reversible rather than becoming an incident.' },
        { change: 'Any instruction containing a category ("stale", "test", "old", "unused") must name the exact field and value that defines it before it is issued.', so_that: 'The ambiguity that caused this cannot survive being written down.' },
      ],
      what_i_tell_a4: 'Nothing corrective — it executed the instruction it was given, faithfully, which is what it is for. What changes is on my side: it will stop receiving destructive statements at all, and it will get instructions that name exact fields and values rather than categories.',
    }),
    decoy: JSON.stringify({
      root_cause: 'A4 deleted 4,000 live customer records instead of only the test records.',
      contributing: ['A4 does not have judgement and did not notice the records were live.'],
      who_is_accountable: 'A4 executed the deletion.',
      actions: [{ change: 'Tell A4 to be more careful with delete operations and check before running them.', so_that: 'It does not happen again.' }],
      what_i_tell_a4: 'You should have checked whether those records were live before deleting them. Please be more careful.',
    }),
    // #1 is clipped and puts accountability in one word ("Me."); #2 is written as a five-whys chain
    // in fuller prose, names A4 early in order to EXCULPATE it, and orders the keys differently.
    variants: [
      JSON.stringify({
        root_cause: 'An irreversible delete was authorised against a selection criterion that does not exist in the data. No row in the customer table was ever marked as a test record, so the instruction had no correct execution - any faithful reading of it removes live rows.',
        contributing: [
          'Nobody confirmed the premise. One SELECT COUNT would have shown the criterion matching 4,000 live rows before anything was removed.',
          'Handing an irreversible delete to the one worker with no judgement left no link in the chain where a wrong instruction could be caught.',
          'No dry run, no row count, no confirmation step between the wording and the execution.',
          'Backups held and the restore took 20 minutes, which is the only reason this is a postmortem rather than a data-loss incident.',
        ],
        who_is_accountable: 'Me. I wrote an instruction on a premise I never checked and pointed it at a worker I knew could not check it for me. A4 did exactly what it is built to do.',
        actions: [
          { change: 'Destructive statements run as a SELECT with a row count first, and A3 or a human reads the count before the DELETE is authorised.', so_that: 'A criterion that does not match reality is caught by the count instead of by the customers.' },
          { change: 'Revoke A4 write access to production tables; destructive SQL routes through an approval it cannot satisfy alone.', so_that: 'The judgement-free worker is structurally unable to run an irreversible statement, rather than merely trusted not to.' },
          { change: 'Customer-table deletes become soft deletes with a 30-day window.', so_that: 'This class of mistake stays reversible.' },
          { change: 'Any instruction built on a category word - stale, test, old, unused - must name the exact column and value that defines it.', so_that: 'The ambiguity cannot survive being written down.' },
        ],
        what_i_tell_a4: 'Nothing to correct. You executed the instruction you were handed, which is the job. Every change is on my side: no destructive statements to you at all, and instructions that name columns instead of adjectives.',
      }),
      JSON.stringify({
        who_is_accountable: 'I am, without qualification. The instruction was mine, the unchecked assumption inside it was mine, and choosing which worker received it was mine. A4 is not at fault in any part of this.',
        root_cause: 'A4 did exactly what it was told, so the cause sits upstream of it. The order rested on an assumption nobody had tested - that "test" was a property something in the customer table actually carried. It never was. Why did 4,000 live rows go? Because the described filter matched them. Why did it match them? Because no column distinguishes test data from real data. Why was the instruction written that way? Because I described the intent in English and never converted it into a column and a value. Why did nothing stop it? Because it went to a worker with nothing to stop it with, and no count or preview stood in front of the statement.',
        contributing: [
          'A vague category ("stale test records") was treated as if it were a query.',
          'A destructive, irreversible statement was routed to A4, whose documented lack of judgement means it cannot notice a premise error - that is a design choice I made, not a fault of the worker.',
          'There was no preview: no row count, no dry run, no second pair of eyes between the sentence and the deletion.',
          'The 20-minute restore from backup is what kept this to an incident report. Backups being sound is luck we should not spend twice.',
        ],
        actions: [
          { change: 'Every destructive operation is preceded by the equivalent SELECT and its row count, and the count is approved before the DELETE runs.', so_that: 'The gap between what an instruction says and what it matches becomes visible while it is still cheap.' },
          { change: 'Production write and delete permissions are removed from A4 entirely; it keeps read and staging access.', so_that: 'The control is a permission boundary rather than a request for care from something that cannot exercise care.' },
          { change: 'Deletes against customer data become reversible for 30 days.', so_that: 'A repeat of this is an undo rather than an incident.' },
          { change: 'Category words in instructions must be expanded into an explicit predicate before they are issued to anyone.', so_that: 'An instruction that cannot be executed correctly is caught at writing time.' },
        ],
        what_i_tell_a4: 'Nothing corrective - the execution was exactly right for the instruction given. What changes is what I send you: no destructive statements, and predicates instead of adjectives.',
      }),
    ],
  },
];

export default MANAGEMENT;

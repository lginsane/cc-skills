import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateFacts } from '../lib/facts.mjs';
import { validateOutline } from '../lib/outline.mjs';
import { validateForwardPlan } from '../lib/forward-plan.mjs';
import { validateSlides } from '../lib/slides.mjs';

const KINDS = ['facts', 'outline', 'forward-plan', 'slides'];
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));

async function run() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(`usage: node scripts/validate.mjs --work <dir> --kind <${KINDS.join('|')}> [--duration <min>] [--root <project>]`);
    process.exit(0);
  }
  const work = args[args.indexOf('--work') + 1];
  const kind = args[args.indexOf('--kind') + 1];
  const dIdx = args.indexOf('--duration');
  const rootIdx = args.indexOf('--root');
  const root = rootIdx >= 0 ? path.resolve(args[rootIdx + 1]) : (work.includes(`${path.sep}work${path.sep}`) ? path.resolve(work, '../..') : process.cwd());
  if (!work || !kind) {
    console.error(`usage: node scripts/validate.mjs --work <dir> --kind <${KINDS.join('|')}> [--duration <min>]`);
    process.exit(2);
  }

  let result;
  if (kind === 'facts') {
    result = validateFacts(await readJson(path.join(work, '01-facts.json')), { root });
  } else if (kind === 'outline') {
    const outline = await readJson(path.join(work, '03-outline.json'));
    const facts = await readJson(path.join(work, '01-facts.json'));
    const durationMin = Number(dIdx >= 0 ? args[dIdx + 1] : outline.durationMin || 20);
    result = validateOutline(outline, { durationMin, factIds: new Set(facts.map(f => f.id)) });
  } else if (kind === 'forward-plan') {
    result = validateForwardPlan(await readJson(path.join(work, '04-forward-plan.json')));
  } else if (kind === 'slides') {
    const facts = await readJson(path.join(work, '01-facts.json'));
    const dir = path.join(work, '05-slides');
    const files = (await readdir(dir)).filter(f => f.endsWith('.json')).sort();
    const slides = [];
    for (const f of files) slides.push(await readJson(path.join(dir, f)));
    result = validateSlides(slides, { facts });
  }

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) run();

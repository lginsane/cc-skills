import { pathToFileURL } from 'node:url';
import { buildDeck } from '../lib/deck.mjs';

async function run() {
  const args = process.argv.slice(2);
  const work = args[args.indexOf('--work') + 1];
  const out = args[args.indexOf('--out') + 1];
  const templateIdx = args.indexOf('--template');
  const template = templateIdx >= 0 ? args[templateIdx + 1] : undefined;
  const styleIdx = args.indexOf('--style');
  const style = styleIdx >= 0 ? args[styleIdx + 1] : undefined;
  if (!work || !out) {
    console.error('usage: node scripts/build_deck.mjs --work <dir> --out <pptx> [--template <pptx>] [--style swiss]');
    process.exit(2);
  }
  const result = await buildDeck({ workDir: work, outPath: out, templatePath: template, style });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) run();

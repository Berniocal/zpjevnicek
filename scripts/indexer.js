
// Node skript: projde /songs a zkonstruuje data/songs.json
import { readdir, writeFile } from 'node:fs/promises';

function parseName(name){
  // např. "001-nazev-pisne-autor.gpx"
  const base = name.replace(/\.(gp|gp3|gp4|gp5|gpx)$/i, '');
  const m = base.match(/^(\d{1,4})-(.+)$/);
  let number = null, rest = base;
  if(m){ number = Number(m[1]); rest = m[2]; }
  const parts = rest.split('-');
  const title = parts.slice(0, -1).join(' ').trim() || rest.replaceAll('-', ' ');
  const author = parts.length>1 ? parts.at(-1).replaceAll('-', ' ').trim() : '';
  const id = base.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
  return { id, number, title, author };
}

const files = (await readdir('songs', {withFileTypes:true}))
  .filter(d => d.isFile())
  .map(d => d.name)
  .filter(n => /\.(gp|gp3|gp4|gp5|gpx)$/i.test(n));

const items = files.map(f => ({ ...parseName(f), file: `songs/${f}` }));

await writeFile('data/songs.json', JSON.stringify(items, null, 2));
console.log(`Index hotov: ${items.length} položek`);

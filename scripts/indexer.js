// Node skript: projde /songs a vytvoří data/songs.json
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const GP_RX = /\.(gp|gp3|gp4|gp5|gpx|musicxml|xml)$/i;
const CP_RX = /\.(pro|cho)$/i;

function parseName(name){
  const base = name.replace(/\.(.*)$/, '');
  const m = base.match(/^(\d{1,4})-(.+)$/);
  let number = null, rest = base;
  if(m){ number = Number(m[1]); rest = m[2]; }
  const parts = rest.split('-');
  const titleGuess = parts.join(' ').trim();
  const id = base.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
  return { id, number, titleGuess };
}

function parseChordProMeta(text){
  // {title: ...}{artist: ...}
  const meta = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\{(\w+)\s*:\s*(.*?)\s*\}$/);
    if (m) meta[m[1].toLowerCase()] = m[2];
    if (Object.keys(meta).length >= 3) break;
  }
  return { title: meta.title, author: meta.artist || meta.composer, key: meta.key };
}

const files = (await readdir('songs', {withFileTypes:true}))
  .filter(d => d.isFile())
  .map(d => d.name)
  .filter(n => GP_RX.test(n) || CP_RX.test(n));

const items = [];
for (const f of files){
  const filePath = path.join('songs', f);
  const metaName = parseName(f);
  let title = metaName.titleGuess;
  let author = '';
  let type = GP_RX.test(f) ? 'score' : 'chordpro';

  if (CP_RX.test(f)){
    try{
      const txt = await readFile(filePath, 'utf8');
      const m = parseChordProMeta(txt);
      if (m.title) title = m.title;
      if (m.author) author = m.author;
    }catch(e){}
  }
  items.push({
    id: metaName.id,
    number: metaName.number,
    title,
    author,
    file: filePath,
    type
  });
}

items.sort((a,b)=>(a.number??99999)-(b.number??99999) || a.title.localeCompare(b.title));
await writeFile('data/songs.json', JSON.stringify(items, null, 2));
console.log(`Index hotov: ${items.length} položek`);

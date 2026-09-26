import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
const hash = createHash('sha256');
async function scan(dir) { for (const entry of (await readdir(dir, {withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
 const file = `${dir}/${entry.name}`; if (file.endsWith('/build.json')) continue;
 if(entry.isDirectory()) await scan(file); else { hash.update(file); hash.update(await readFile(file)); }
}}
await scan('src'); await scan('public/models'); hash.update(await readFile('package-lock.json'));
const info = {version: JSON.parse(await readFile('package.json','utf8')).version, id: hash.digest('hex').slice(0,12), builtAt: new Date().toISOString(), manifestVersion: 1};
await writeFile('src/shared/build.json', JSON.stringify(info,null,2)+'\n');

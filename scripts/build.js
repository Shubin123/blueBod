import {cp,rm,writeFile} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await cp('public','dist',{recursive:true});
await writeFile('dist/.nojekyll','');
console.log('Static application built in dist/');

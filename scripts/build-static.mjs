import {cpSync,mkdirSync} from 'node:fs';
mkdirSync('dist',{recursive:true});
for(const path of ['index.html','app.js','styles.css','assets','library'])cpSync(path,'dist/'+path,{recursive:true});

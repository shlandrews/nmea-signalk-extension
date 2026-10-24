// Development only. The unpacked extension needs no build or runtime packages.
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {zipSync} from 'fflate';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=async(dir,prefix='')=>{
  const out={};
  for(const item of await readdir(dir,{withFileTypes:true})){
    if(item.name==='__pycache__')continue;
    const full=path.join(dir,item.name),key=prefix+item.name;
    if(item.isDirectory())Object.assign(out,await files(full,key+'/'));
    else if(item.isFile())out[key]=new Uint8Array(await readFile(full));
  }
  return out;
};
const extension=await files(path.join(root,'chromium-extension'));
const manifest=JSON.parse(new TextDecoder().decode(extension['manifest.json']));
if(manifest.manifest_version!==3||manifest.version!=='2.0.0')throw Error('Unexpected manifest');
const source={};
for(const name of ['chromium-extension','tests','scripts'])Object.assign(source,await files(path.join(root,name),name+'/'));
for(const name of ['README.md','INSTALL.md','ARCHITECTURE.md','TESTING.md','LICENSE','.gitignore','package.json','pnpm-lock.yaml'])source[name]=new Uint8Array(await readFile(path.join(root,name)));
await mkdir(path.join(root,'dist'),{recursive:true});
for(const [name,entries] of [['marine-gps-extension.zip',extension],['marine-gps-source.zip',source]]){
  const target=path.join(root,'dist',name);await writeFile(target,zipSync(entries,{level:6}));console.log(target);
}

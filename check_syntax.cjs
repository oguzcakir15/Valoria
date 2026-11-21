/** Syntax-only TypeScript validation that runs without installed npm packages. */
const fs=require('fs');
const cp=require('child_process');
const path=require('path');
const globalRoot=cp.execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim();
const ts=require(path.join(globalRoot,'typescript'));
let failures=0;
for(const file of ['src/App.tsx','src/main.tsx','src/client.ts','src/types.ts','vite.config.ts']){
 const full=path.join(__dirname,'..',file);
 const source=fs.readFileSync(full,'utf8');
 const out=ts.transpileModule(source,{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});
 const errors=(out.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
 if(errors.length){failures+=errors.length;for(const e of errors)console.error('FAIL',file,ts.flattenDiagnosticMessageText(e.messageText,'\n'))}
 else console.log('PASS',file,'parsed and transpiled');
}
if(failures)process.exit(1);
console.log('TypeScript syntax-only checks passed. Full typecheck requires npm install.');

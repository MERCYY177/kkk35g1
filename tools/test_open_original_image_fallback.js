const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const html=fs.readFileSync('index.html','utf8');
const marker='async function openOriginalImage(src){';
const start=html.indexOf(marker);
if(start<0) throw new Error('openOriginalImage not found');

function extractFunction(src,start){
  const brace=src.indexOf('{',start);
  let depth=0, quote=null, esc=false, lineComment=false, blockComment=false;
  for(let i=brace;i<src.length;i++){
    const ch=src[i], next=src[i+1];
    if(lineComment){ if(ch==='\n') lineComment=false; continue; }
    if(blockComment){ if(ch==='*'&&next==='/'){ blockComment=false; i++; } continue; }
    if(quote){
      if(esc){esc=false;continue;}
      if(ch==='\\'){esc=true;continue;}
      if(ch===quote){quote=null;}
      continue;
    }
    if(ch==='/'&&next==='/'){lineComment=true;i++;continue;}
    if(ch==='/'&&next==='*'){blockComment=true;i++;continue;}
    if(ch==='\''||ch==='"'||ch==='`'){quote=ch;continue;}
    if(ch==='{') depth++;
    else if(ch==='}'){
      depth--;
      if(depth===0) return src.slice(start,i+1);
    }
  }
  throw new Error('unterminated openOriginalImage');
}

const fnText=extractFunction(html,start);
const writes=[];
const sandbox={
  console,
  srcToImageBlob:async()=>{throw new Error('forced decode failure')},
  URL:{createObjectURL(){throw new Error('should not reach createObjectURL')},revokeObjectURL(){}},
  location:{href:''},
  setTimeout(){},
  window:{
    open(){
      return {document:{write(s){writes.push(String(s))},close(){}}};
    }
  }
};
vm.createContext(sandbox);
vm.runInContext(fnText+';this.openOriginalImage=openOriginalImage;',sandbox);

(async()=>{
  let rejected=null;
  try{await sandbox.openOriginalImage('original://source')}catch(e){rejected=e}
  if(rejected || !writes.some(s=>s.includes('original://source')) || sandbox.location.href){
    console.log('FUNCTION_SOURCE='+fnText);
    console.log('WRITES='+JSON.stringify(writes));
    console.log('LOCATION='+sandbox.location.href);
    console.log('REJECTED='+(rejected&&rejected.stack||rejected));
  }
  assert.strictEqual(rejected,null,'fallback must not reject when image conversion fails');
  assert.ok(writes.some(s=>s.includes('original://source')),'when popup opens, fallback should render original src in that popup');
  assert.strictEqual(sandbox.location.href,'','successful popup fallback must not navigate the current app away');
  console.log('openOriginalImage popup fallback regression passed');
})().catch(err=>{console.error(err.stack||err);process.exit(1)});

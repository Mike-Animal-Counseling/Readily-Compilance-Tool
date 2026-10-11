import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
const cwd = process.cwd();
const origin = 'http://127.0.0.1:3010', code = randomBytes(32).toString('hex');
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', '3010', '-H', '127.0.0.1'], {cwd,env:{...process.env,NODE_ENV:'development',APP_ORIGIN:origin,DEMO_ACCESS_CODE:code,SESSION_SECRET:randomBytes(32).toString('hex'),REDIS_URL:''},stdio:['ignore','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});
let logs='';for(const stream of [child.stdout,child.stderr])stream.on('data',x=>{logs=(logs+x.toString()).slice(-8000)});
try {
 let ready=false;
 for(let i=0;i<40;i++){
  try {let response=await fetch(origin+'/demo-access',{signal:AbortSignal.timeout(2000)});if(response.ok){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 assert.ok(ready,'Local server failed to start: '+logs);
 const login=await fetch(origin+'/api/demo-access',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({code}),signal:AbortSignal.timeout(15000)});
 assert.equal(login.status,200,'Login failed');
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const stream='BT /F1 12 Tf 72 720 Td (Synthetic HTTP policy) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let pdf='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
 const xref=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('');pdf+=`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 const form=new FormData();form.append('policies',new Blob([pdf],{type:'application/pdf'}),'synthetic.pdf');
 const parsed=await fetch(origin+'/api/parse-policies',{method:'POST',headers:{origin,cookie},body:form,signal:AbortSignal.timeout(30000)});
 const body=await parsed.json();assert.equal(parsed.status,200,'HTTP PDF parsing failed: '+JSON.stringify(body)+'\n'+logs);
 assert.equal(body.documents[0].pageCount,1);console.log('Real Next.js HTTP login and isolated PDF upload passed');
} finally {
 if(child.exitCode===null){
  if(process.platform==='win32') {
    const cleanup=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
    await Promise.race([new Promise(resolve=>cleanup.on('exit',resolve)),new Promise(resolve=>setTimeout(resolve,5000))]);
  } else {
    try {process.kill(-child.pid,'SIGTERM');} catch(error) {if(error.code!=='ESRCH')throw error;}
    await new Promise(resolve=>setTimeout(resolve,500));
    try {process.kill(-child.pid,'SIGKILL');} catch(error) {if(error.code!=='ESRCH')throw error;}
  }
}
}

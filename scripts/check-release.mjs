import {readFile} from 'node:fs/promises';
const file=new URL('../automation/evidence/release-evidence.json',import.meta.url);
const e=JSON.parse(await readFile(file,'utf8'));
const https=s=>{try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
const checks={commit:/^[0-9a-f]{40}$/i.test(e.gitSha||''),build:e.buildStatus==='PASS',types:e.typecheckStatus==='PASS',unit:e.unitStatus==='PASS',ui:e.uiStatus==='PASS',foundry:e.foundryStatus==='PASS',arc:https(e.arc?.receiptUrl)&&/^https:\/\/testnet\.arcscan\.app\/tx\/0x[0-9a-f]{64}$/i.test(e.arc?.receiptUrl||''),graph:https(e.graph?.liveEvidenceUrl),cre:e.cre?.simulationStatus==='PASS'&&https(e.cre?.evidenceUrl),human:e.humanApproval?.status==='APPROVED'&&https(e.humanApproval?.reference)};
const blocked=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name);
console.log(JSON.stringify({decision:blocked.length?'NO_GO':'SUBMITTED_EVIDENCE_COMPLETE',assurance:'Local status/reference preflight only; links and proofs are not independently verified; no deployment occurs',checks,blocked},null,2));
process.exitCode=blocked.length?1:0;

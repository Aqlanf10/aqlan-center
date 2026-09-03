import './load-env.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const checks=['schema','concurrency','audit','clinical','plans','identity','documents','ortho','ceph','release','recovery','treatment','inventory','executive','messages','ceph-study'];
let failed=false;
for(const check of checks){
  const result=spawnSync(process.execPath,['--import','tsx',fileURLToPath(new URL(`./verify-${check}.mjs`,import.meta.url))],{stdio:'inherit',env:{...process.env,KEEP_TEST_DB:'0'}});
  if(result.status!==0){failed=true;console.error(`FAILED: ${check}`,result.error?.message??'');}
}
process.exitCode=failed?1:0;

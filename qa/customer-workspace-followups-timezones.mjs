// Run only the count cases at the same fixed instant on different device timezones; the OC date must stay Hong Kong time.
import {spawnSync} from 'node:child_process'
if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Loopback emulator required.')
for(const [zone,today]of [['UTC','2026-10-17'],['Australia/Sydney','2026-10-17'],['America/Los_Angeles','2026-10-17']]){
 console.log(`Follow-ups Due calendar: ${zone}, expected today ${today}`)
 const result=spawnSync(process.execPath,['--test','--test-name-pattern=Follow-ups Due','qa/customer-workspace-sync-emulator.mjs'],{
  stdio:'inherit',env:{...process.env,TZ:zone,WORKSPACE_EXPECT_TODAY:today},
 })
 if(result.error)throw result.error
 if(result.status!==0)process.exit(result.status||1)
}

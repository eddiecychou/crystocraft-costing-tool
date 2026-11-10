import {WORK_STAGES,WORK_STAGE_DESCRIPTIONS} from '../../dashboardWorkbench'

// Reuse the design system's existing purple, amber and green status variants.
const tones = {exploration:'badge-concept',quotation:'badge-sampled',order:'badge-active'}
export default function WorkStageBadge({stage}) {
  if (!Object.hasOwn(WORK_STAGES,stage)) return null
  return <span className={tones[stage]} data-work-stage={stage} title={WORK_STAGE_DESCRIPTIONS[stage]}>{WORK_STAGES[stage]}</span>
}

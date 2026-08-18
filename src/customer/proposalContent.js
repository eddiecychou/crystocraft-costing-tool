// PHASE 0 — temporary hard-coded Sun Life proposal content.
// See Sun-Life-Proposal-Build-Spec.md §10 Phase 0 / §9 Q1.
//
// Every string and image below is a PLACEHOLDER for layout proof only — none
// of this is real Sun Life brand copy. Real copy is being AI-drafted from
// source material separately and will be reviewed/approved by the owner
// before anything here goes live. This file is deleted in Phase 4, once
// ProposalPage reads customers/{id}/proposal/current via src/customerProposal.js
// instead. Images reuse the existing homepage pillar photos purely as visual
// stand-ins — they are NOT Sun Life assets and must not ship as final.
//
// Shape mirrors the real Firestore doc (spec §3.2) so swapping the data
// source in Phase 4 is a like-for-like replacement, not a rewrite.

import heroPlaceholder from '../assets/customer/hero-corporate.jpg'
import sectionA from '../assets/customer/pillar-corporate.jpg'
import sectionB from '../assets/customer/pillar-figurine.jpg'
import sectionC from '../assets/customer/pillar-crystal.jpg'

export const PLACEHOLDER_NOTICE =
  'Draft layout — placeholder text and photos, not final Sun Life content.'

export const sunLifeProposal = {
  status: 'draft',
  hero_image: heroPlaceholder,
  tagline: '[PLACEHOLDER TAGLINE] — A partnership crafted in crystal.',
  briefing:
    '[PLACEHOLDER BRIEFING] Draft brand direction paragraph — where we introduce Sun Life\'s ' +
    'programme, tone and the reason for this proposal. Real content pending.',
  sections: [
    {
      heading: '[PLACEHOLDER] Concept One',
      tagline: '[PLACEHOLDER] A short section tagline',
      briefing: '[PLACEHOLDER] A paragraph describing this concept or story beat — real copy pending.',
      images: [sectionA],
      products: [
        { name: '[PLACEHOLDER PRODUCT] Crystal Award', image: sectionA, to: null },
        { name: '[PLACEHOLDER PRODUCT] Desk Trophy', image: sectionB, to: null },
      ],
    },
    {
      heading: '[PLACEHOLDER] Concept Two',
      tagline: '[PLACEHOLDER] Another section tagline',
      briefing: '[PLACEHOLDER] A second paragraph — real copy pending.',
      images: [sectionB, sectionC],
      products: [
        { name: '[PLACEHOLDER PRODUCT] Gift Set', image: sectionC, to: null },
      ],
    },
  ],
  cta_label: 'Make an enquiry',
}

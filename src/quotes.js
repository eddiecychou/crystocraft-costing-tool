// Shared helper for client_quotes status — see QuoteDetail.jsx's STATUS_OPTIONS
// comment (bug-fix pack B-01). 'confirmed' is canonical; 'won' is a legacy
// value some existing quotes still carry and is never migrated, only aliased
// wherever a quote is checked for the "won" state.
export const quoteIsConfirmed = status => status === 'confirmed' || status === 'won'

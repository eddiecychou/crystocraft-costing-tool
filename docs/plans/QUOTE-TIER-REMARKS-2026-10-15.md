# V8.18 quotation PDF tier remarks

The supplied Mandy Pong PDF includes quantity/price tiers but omits each saved tier.remarks. QuoteDetail already saves this field; QuotePDF never rendered it. The PDF now groups each tier's quantity/unit, price, amount and optional remark together, printing the remark directly beneath its own price row. Shared tier groups preserve numeric alignment when remarks wrap. Product-level remarks and quote-wide notes remain separate. Numeric calculations, primary-tier grand total and selected units are unchanged; no quote data writes or migration.

Four added regressions verify tier association, blank remarks, quote/product notes, Chinese fallback selection and real multipage rendering of long/multiline remarks. Existing PDF unit checks remain. Full prebuild suite now74checks. Rendered fixture `/private/tmp/v818-evidence/quote-tier-remarks-regression.pdf` and PNG show wrapped remarks with aligned numbers and clear tier association.

Candidate and production verification pending.

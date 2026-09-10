# Crystocraft Operation Center — Sales Return, Credit Note and Invoice Requirements

## 1. Context

Cindy is responsible for Crystocraft's Finance and Accounting work. She identified a need to record and manage sales returns and credit notes in the Operation Center, especially for Amazon transactions. The current application does not provide a dedicated Sales Return or Credit Note workflow.

The current system uses `orders` as a combined order, shipment and invoice record, with sales-invoice facts also written to the Supabase/Postgres financial tables and UC registry. The proposed feature must therefore be designed carefully so that it does not create inconsistent invoice, customer, stock, or accounting records.

## 2. Confirmed Requirements from the Screenshots

| ID | Requirement | Initial interpretation | Status |
|---|---|---|---|
| SR-01 | Add a dedicated place in the app to record Sales Return and/or Credit Note | Finance users need to find, create, review and track these records instead of keeping them outside the app | Confirmed need |
| SR-02 | Amazon is the main use case | The workflow must support Amazon orders, including cases where one invoice covers multiple orders or transactions | Confirmed context |
| SR-03 | The system may need to work alongside previous JES records | The feature should support referencing an original JES invoice, SI number, UC number, or legacy record where relevant | Needs confirmation |
| SR-04 | Invoice amount and actual money received can differ slightly in the final decimal digit | Example shown: computed subtotal HKD 26,833.23 versus PI-stated subtotal and amount received HKD 26,833.26 | Confirmed problem example |
| SR-05 | Accounting must be able to manually adjust the accounting amount | The app should provide an explicit controlled adjustment field, not silently overwrite the calculated amount | Confirmed need |
| SR-06 | Sales Invoice needs a Remarks field | Remarks may explain an abandoned name, the reason for an exception, or other accounting context; exact display rules are still open | Confirmed need |
| SR-07 | Sales Invoice needs a Customer PO# field | The invoice should display or carry the Customer PO# already available on the order form | Confirmed need |
| SR-08 | Invoice date must be editable | Invoice date should not always equal the date on which the invoice is generated | Confirmed need |
| SR-09 | Invoice date may reflect the actual receipt/accounting date | This is important for online orders and Amazon, where accounting may issue one invoice several months after the underlying transactions | Confirmed business context |

## 3. Proposed Domain Separation

The implementation should distinguish the following records instead of treating them as one generic adjustment:

| Record | Purpose | Financial effect | Inventory effect | Link required |
|---|---|---|---|---|
| Sales Return | Records that goods were returned by the customer or marketplace | May or may not create a credit note, depending on the accounting decision | May return goods to stock, quarantine stock, or record no stock movement | Original order/invoice and returned lines |
| Credit Note | Formal accounting document reducing a previously issued invoice or amount receivable | Negative financial adjustment against an original invoice | Usually no direct inventory effect unless explicitly linked to a return | Original invoice/SI/UC and reason |
| Invoice adjustment | Small correction to accounting amount, such as a rounding or received-amount difference | Changes the accounting amount while retaining the calculated system amount | No inventory effect | Invoice and adjustment reason |
| Sales Invoice | Original invoice issued to the customer or marketplace | Positive receivable/sales document | Normally no direct return effect | Order, customer, PO, UC/SI |

The first technical decision is whether Cindy's request means one combined screen with different record types, or separate Sales Return and Credit Note modules connected to Sales Invoices.

## 4. Initial Functional Scope

### 4.1 Sales Return / Credit Note register

The app should provide a register with search, filtering and status handling. The minimum fields likely include:

| Field | Purpose |
|---|---|
| Record number | Internal return or credit-note identifier |
| Record type | Sales Return, Credit Note, or Invoice Adjustment |
| Record date | Date the record was created or approved |
| Accounting date | Date used by Finance/Accounting |
| Customer / marketplace | Amazon, other B2C channel, or B2B customer |
| Original invoice number | Link to SI/invoice |
| Original UC number | Link to UC registry where applicable |
| Original order number | Link to the Operation Center order |
| Customer PO# | Carry forward or enter the relevant PO reference |
| Currency | Currency of the original document |
| Original amount | Amount on the original invoice |
| Calculated return/credit amount | Amount derived from selected lines and quantities |
| Accounting amount | Amount finally used by Finance |
| Adjustment amount | Difference between calculated and accounting amount |
| Reason | Return, damaged goods, customer request, marketplace adjustment, rounding, abandoned name, etc. |
| Remarks | Free-text accounting or operational explanation |
| Status | Draft, Submitted, Approved, Posted, Cancelled |
| Created by / approved by | Accountability |
| Supporting documents | Marketplace report, email, credit-note PDF, proof of return, etc. |

### 4.2 Original invoice linking

A user should be able to locate an original invoice using at least invoice number, UC number, SO/order number, customer, marketplace order reference, or Customer PO#. Once linked, the system should show the original invoice date, currency, customer, lines, quantities, totals and existing credit or return records.

The system should prevent or clearly warn about duplicate credits against the same invoice line. It should support partial returns and partial credit notes.

### 4.3 Amount handling

The application should preserve at least three values where applicable:

1. **System-calculated amount**, derived from invoice lines, quantity and unit price.
2. **Source-stated amount**, such as the amount stated on the PI, Amazon report, or external document.
3. **Accounting amount**, the amount Cindy elects to record after an approved manual adjustment.

The difference should be visible and named, for example `amount_difference` or `accounting_adjustment`, with a mandatory reason when the accounting amount differs from the calculated amount. The system should not silently replace the calculated amount.

### 4.4 Invoice dates

The invoice record should distinguish at least:

- Order date.
- Transaction or marketplace date, if available.
- Invoice generated date.
- Invoice date used for accounting.
- Payment or money-received date, if available.
- Credit-note date or return date.

The UI should make clear which date appears on the printed invoice and which date is used for financial reporting. Editing an already posted invoice date may need a permission restriction and an audit record.

### 4.5 Invoice display additions

Sales Invoice output should support:

- Customer PO#.
- Remarks, with a defined placement and visibility rule.
- Editable invoice date.
- Clear display of the accounting amount where it differs from the calculated amount.
- Original invoice reference for a Credit Note.
- Credit Note number and date where relevant.

## 5. Likely Integration Points

| Existing area | Required integration |
|---|---|
| Sales Invoices | Add invoice date, remarks, Customer PO#, amount adjustment and links to return/credit records |
| Production / Orders | Link the return to the original order and determine whether returned goods affect stock |
| UC Registry | Decide whether a Credit Note receives its own UC/SI-related number or references the original UC only |
| Supabase/Postgres financial tables | Store posted accounting facts in a controlled and auditable way |
| Inventory | Support return-to-stock, damaged, quarantine, or no-stock-movement outcomes |
| Amazon / B2C channels | Store marketplace order, settlement, refund, and reporting references if available |
| Customer record | Show relevant return and credit-note history |
| PDF / print | Print a formal Credit Note and update invoice presentation |
| Audit trail | Log amount edits, date edits, approvals, posting and cancellation |

## 6. Main Accounting Questions for Cindy

These questions should be answered before DeepSeek writes a final technical design:

1. Is a Sales Return a physical-goods event, while a Credit Note is the accounting document, or does Cindy want one record to represent both?
2. For Amazon, does one Credit Note correspond to one original invoice, one Amazon settlement report, or a batch of many orders?
3. Should a returned item increase stock, go to damaged/quarantine stock, or simply be recorded without changing inventory?
4. Does every Credit Note need a new document number? If yes, what numbering format should be used?
5. Does the Credit Note need a new UC number, a new SI-like number, or only a reference to the original UC/SI?
6. Is the accounting amount allowed to differ from the calculated amount because of rounding only, or also because of Amazon fees, refunds, exchange rates, discounts and settlement adjustments?
7. Must a manual amount adjustment require a reason and approval by a Finance user?
8. Which date should appear on the printed invoice: invoice date, payment date, transaction date, or accounting date?
9. Can a posted invoice date or amount be edited, or must the app create an adjustment record instead?
10. What does “放弃名之前，乜嘢就唔 show” mean operationally? Should a name be hidden from the invoice, or should a remark explain that the name was abandoned/not used?
11. Should Customer PO# be copied from the order automatically, or may Finance edit it on the invoice?
12. Does Cindy need an export compatible with PBIS, JES, a tax/accounting system, or an Excel workflow?
13. Which users may create, approve, post, cancel and edit Sales Returns or Credit Notes?
14. Is a Credit Note reversible through cancellation, or may users delete it while still in draft?
15. What supporting documents must be attached to an Amazon return or credit note?

## 7. Recommended Implementation Sequence

1. Confirm the accounting vocabulary and document-number rules with Cindy.
2. Add the missing Sales Invoice fields: editable accounting date, Customer PO#, Remarks, and explicit calculated/source/accounting amounts.
3. Add an append-only audit event whenever amount, date, status or original-invoice linkage changes.
4. Build the Sales Return and Credit Note data model and register, initially with draft and approved states.
5. Add original invoice linking and duplicate/over-credit validation.
6. Decide and implement inventory treatment for returned goods.
7. Add formal Credit Note PDF/print output and financial exports.
8. Add Amazon batch/settlement imports only after the single-record workflow is correct.

## 8. DeepSeek Technical Analysis Prompt

```text
You are reviewing the Crystocraft Operation Center codebase. Based on the attached system summary and the following Finance/Accounting requirements from Cindy, design a safe technical approach for implementing Sales Return, Credit Note, and Sales Invoice accounting adjustments.

Context:
- The app currently uses Firestore for operational data.
- Sales invoices and UC registry financial facts also involve Supabase/Postgres.
- The current `orders` record acts as order, shipment, and invoice.
- The app does not currently have a dedicated Sales Return or Credit Note workflow.
- Amazon is the main use case.
- Cindy needs to record sales returns and/or credit notes.
- Invoice calculated totals can differ by a small final-digit amount from the actual received amount.
- Finance needs an explicit manual accounting amount adjustment.
- Sales Invoice needs Remarks and Customer PO#.
- Invoice date must be editable because it may need to represent an accounting/payment date rather than the generated date.

Requirements to analyze:
1. Separate or combine Sales Return, Credit Note, and Invoice Adjustment records.
2. Link each record to the original order, invoice, SI, UC, customer, marketplace order, and Customer PO# where relevant.
3. Support partial returns and partial credit notes.
4. Preserve calculated amount, source-stated amount, accounting amount, and the difference between them.
5. Require a reason for manual financial adjustments.
6. Support editable accounting/invoice dates with appropriate permission and audit behavior.
7. Add invoice Remarks and Customer PO# to the data model, UI, PDF and exports.
8. Decide how returned goods affect inventory: returned-to-stock, damaged, quarantine, or no movement.
9. Define document numbering for Sales Returns and Credit Notes, including whether a new UC/SI-related number is required.
10. Support Amazon records, including the possibility of batch or settlement-based credit notes.
11. Avoid breaking existing SI allocation, UC registry, `app_sales_invoice`, invoice printing, customer invoice history, and portal access.
12. Consider the existing lack of a general audit trail and propose an auditable design.
13. Identify data migration requirements for existing invoices and records.
14. Identify security and permission requirements for Finance users, admins, creators, approvers and posters.

Please produce:

A. Current-state impact analysis.
B. Recommended domain model and Firestore/Postgres ownership for each field.
C. Proposed collections/tables, key fields, indexes and relationships.
D. State machine for Draft, Submitted, Approved, Posted and Cancelled.
E. Amount and rounding rules.
F. Date rules and posting rules.
G. Inventory treatment options and your recommendation.
H. Numbering and document-reference strategy.
I. UI pages and user flows.
J. PDF/print/export changes.
K. Permission and audit design.
L. Migration and backward-compatibility plan.
M. Edge cases and validation rules.
N. Testing plan.
O. A staged implementation plan with dependencies.

Do not modify code. Clearly label confirmed facts, assumptions, open questions, and decisions that require Cindy's approval. Do not invent accounting or legal rules. If the requirements are ambiguous, provide the safest default and list the exact question that must be answered before implementation.
```

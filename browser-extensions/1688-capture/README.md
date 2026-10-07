# Crystocraft 1688 Capture

An unpacked Chrome extension for a **user-initiated** 1688 sourcing capture. It
is not a crawler.

1. Open and choose the product/SKU on a normal `detail.1688.com` page.
2. Click the extension button.
3. It reads the rendered page text, visible selection and source image URLs; it also captures the viewport and scrolls the current listing to create stitched full-listing evidence panels (up to the first 30,000 CSS pixels).
4. It opens the signed-in Operation Center capture-review screen.
5. After review, OC saves an internal 1688 Captures inbox record.

The full-listing pass happens only after the staff member clicks the extension
button. It restores the original scroll position when complete, and does not
navigate away, open another listing, select a SKU, or perform any background
capture. The capture remains in extension storage for 30 minutes only. The
extension has no OC password, Firebase credential, background crawl, login
automation, CAPTCHA bypass or checkout capability.

## Load locally in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Pin **Crystocraft 1688 Capture** to the toolbar.

For a deliberate local-OC test, add the exact local OC origin to both
`host_permissions` and `externally_connectable.matches`; never use a wildcard origin.

Captured text and screenshots are source evidence, not confirmed product
claims. Review the selected SKU and confirm price, MOQ, material, dimensions,
logo method, packaging, lead time and compliance with the supplier before
creating an OC supplier/product/quote draft.

# Crystocraft ERP Coding System – Summary

This document summarizes the key structures and ideas in the existing JES / ERP coding rules, based on the original Chinese specification.

## 1. Overview

The ERP coding system is designed to:

- Uniquely identify **finished goods**, **semi‑finished goods**, **components**, **accessories**, **packaging**, and **outsourced items**.
- Encode **structure, material, color/plating, connection method, packaging style, customer linkage**, and sometimes **function** inside the code itself.
- Support the long‑running Crystocraft figurine business and related product lines.

Codes are used across production, purchasing, inventory, and BOM management.

## 2. Finished Product Codes (成品編號)

### 2.1 Crystocraft Finished Goods

- Example format: `U0257-001-GAB 00 P13 AB`
- Encodes:
  - Base product / design (e.g. `U0257`)
  - Variant or sequence (e.g. `001`)
  - Plating / color / finish (e.g. `GAB`)
  - Additional suffixes for packaging, customer‑specific versions, etc.

### 2.2 UB Business Series (商務系列)

- For custom / business series products.
- Example format: `UB001-000-GC1A21`
- Encodes:
  - UB series base (`UB001`)
  - Variant (`000`)
  - Plating / finish block (e.g. `GC1`)
  - Additional characters (e.g. `A21`) that may encode packaging or customer‑specific details.
- Example products: `UB001-000-GC1A21 Gem Top Pen`, `UB002-000-XC1A21 Flower Gem Top`.

These finished codes are tightly tied to the figurine/metal product catalog.

## 3. Semi‑Finished & Component Codes (半成品 / 配件)

Semi‑finished and component codes typically start with `FM-` and are grouped by function.

### 3.1 Crystocraft Main Body (主體) Codes

- General pattern: `FM-UXXXXBYXX-01 G`
- Encodes:
  - Main body design (e.g. `UXXXXBYXX`)
  - Connection method (e.g. `01`, `02`, …, `14`) describing how the part is mounted or joined.
  - Plating / color (e.g. `G` for gold, `C` for chrome, etc.).
- Connection method codes examples:
  - `01` – Welded nut or base plate for screw connection.
  - `02` – Independent base.
  - `03` – Small post at back for suction cup / rubber parts.
  - `04` – Top ring for chain or string.
  - `05` – Top and bottom rings (e.g. for wind chime style).
  - `06` – With clock movement.
  - `07` – Bottom post for spring.
  - `08` – Four side rings/nuts.
  - `09` – Special hanging series.
  - `10` – Tip connection at top.
  - `11` – Back connector for photo frame.
  - `12` – Back connector for champagne‑style items.
  - `13` – Brooch (配A13).
  - `14` – Main part welded permanently to accessory.

### 3.2 Main Accessories (主體附件) Codes

- Pattern: `FM-UXXXXPTXX-G`
- Encodes:
  - Accessory group associated with a main body.
  - Plating / color.

### 3.3 Assembly Style Codes (裝配款式)

- Pattern: `FM-XXXPTXX A-G`
- Encodes:
  - Specific assembly variant (款式編號組).
  - Plating / color.

### 3.4 Scattered / Transition Parts (零散配件)

- Pattern: `FM-SXXXX-G`
- Encodes small transition components used between main parts, with plating color.

### 3.5 UC Series Accessories

- Pattern: `FM-C01PT01-G`
- Encodes UC product series accessories, with plating.

### 3.6 Acrylic Boxes & Metal Plates (亞加力盒 / Metal Plate)

- Pattern: `FM-PL120120H1A-C`
- The `PL120120` encodes dimensions; `H1A` encodes drilling information.
- Drilling code `HXY` explained:
  - First character `H` = hole (basic, fixed).
  - Second character: number of holes using `1–9, A, B, C…` where `A=10`, `B=11`, etc.
  - Third character: version/position variant `A–Z` for same size & hole count but different hole positions.
- If no holes: `H00`, e.g. `FM-PL120120H00-C`.

### 3.7 Special Series (163/175/054 etc.)

- Examples:
  - `FM-163 U0329-G` – 163 bookmark series, plated together with main body.
  - `FM-175 U0393-G` – 175 letter opener series.
  - `FM-054 U0269.01-G` – 054 card holder series.

### 3.8 Chains (Chain)

- Chains are unified under FM codes like `FM-CN006C-G`.
- BOM usage measured in **meters (m)** as quantity; ERP notes explain conversion to mm for inventory.

### 3.9 Metal Wire (Metal Wire)

- Pattern: `FM-WR183IRN`
- Encodes metal wire type and diameter (e.g. `WR183` → 1.83 mm iron wire).
- Store and purchase units defined as `MM` (millimeters).

## 4. Mascot Series Codes

Mascot codes are a dedicated set under `FM-` with their own structure.

### 4.1 Mascot Main Body

- Pattern: `FM-S(ANG)H-1W(G)`
- Encodes:
  - Main body group.
  - Connection style (H, W, 1W, 2W, BM, P, HH, M, MH, QG, 2H, etc.).
  - Plating / color.

### 4.2 Mascot Split‑Plating Main Body

- Pattern: `FM-GLF.01-1(G)`
- Encodes main body parts that must be plated separately then assembled.

### 4.3 Mascot Accessories

- Pattern: `FM-K(48)-G`
- Encodes accessory group with plating.

### 4.4 Mascot Split‑Plating Accessories

- Pattern: `FM-K(68).01-C`
- Encodes accessories that are plated separately before assembly.

## 5. Outsourced Items (外購件)

Outsourced items usually use `P-` prefix.

### 5.1 Music Box Speakers (響鈴)

- Pattern: `P-MM001-01`
- Encodes:
  - `P` = purchased item.
  - `MM` = music box/speaker.
  - `001/002/003…` = tune number.
  - `01/02/03…` = size and model.

### 5.2 Paper Boxes (彩盒)

- Pattern: `P-PB099-01-02` (example)
- Encodes:
  - `P` = purchased item.
  - `PB` = paper box.
  - A numeric block for model.
  - Additional blocks for size and color.
- A separate **color code table** maps numeric codes to colors by box type (`P-GB`, `P-PB`, `P-TA`):
  - E.g. Blue, Brown, Gold, Green, Grey, Milk White, Orange, Pink, Purple, Red, Rubine Red, Silver, Shrimp, Rose Gold, etc., each with numeric codes per series.
- There are also codes for **hot-stamping logo types** (e.g. old green with CRYSTOCRAFT logo, new green for SPECTRA, Perfect Gift black box, etc.).

## 6. Towel Product Coding Example (毛巾产品)

The document also includes a **separate example** of a generic coding scheme for towel products, showing how a structured code can be designed:

- Format: `FP-XX-XXXX-XX`
  - `FP` – fixed prefix for towel products.
  - Category code (e.g. `BT` for Bath Towel / general towel category).
  - Function/material code (e.g. `MF` for Microfibre, `CL` for Cooling).
  - Size code: 4 digits representing width×length (e.g. `1560` for 80×156).
  - Color code: 2 letters (e.g. `WW` white, `RD` red, `BK` black, `BL` blue, `GY` gray, etc.).
- Example: `FP-BT-MF-1560-WW` for an 80×156 white microfibre swimming towel.

This towel section is more of a **template pattern** and separate from the Crystocraft FM/U/P codes.

## 7. Key Takeaways

- The ERP coding system is **manufacturing‑focused**: it encodes detailed information about parts, plating, connection, and packaging inside compact codes.
- Finished product codes (U/UB) represent marketable items; FM codes describe semi‑finished and components; P codes represent purchased items like music boxes and paper boxes.
- Special series (163, 175, Mascot, etc.) have their own structured patterns, but still follow the same logic: prefix + functional blocks.
- For your new costing tool and corporate‑gift product codes, these ERP codes will act as **low‑level references** inside BOM components rather than being exposed directly to B2B clients.

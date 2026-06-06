import { useState } from 'react'
import { collection, addDoc, getDocs, deleteDoc, doc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db } from '../firebase'

const IMPORT_DATA = [
  {
    "company_name": "Arribas Brothers",
    "contact_name": "Mark Lee",
    "country": "United States",
    "contact_emails": [
      "mark.lee@arribas.com"
    ],
    "contact_phones": [
      "407-828-4840 x2254",
      "cell 407-489-5959"
    ],
    "contact_email": "mark.lee@arribas.com",
    "contact_phone": "407-828-4840 x2254",
    "whatsapp": "",
    "website": "https://www.arribas.com",
    "tags": [
      "vip",
      "distributor",
      "usa",
      "email",
      "disney",
      "crystal-fabric"
    ],
    "segment": "VIP — Theme Park",
    "crm_status": "Active",
    "primary_channel": "Email",
    "is_personal_wa": false,
    "is_vip": true,
    "source": "Email Marketing",
    "notes": "GM of Arribas Brothers FL. Disney/theme park gift retailer. Came via crystal fabric email marketing. RELATED: Scott P (Japan sourcing), Dennis Leung (HK/HKDL sourcing).",
    "last_contact_date_str": "2026-06-02",
    "last_contact_notes": "Confirmed 3 sample colours: red, white, darker pink",
    "action_required": "Ship crystal fabric flower samples immediately (red/white/darker pink)",
    "products_interest": "Crystal fabric roses; crystal figurines; Disney/HKDL gifts"
  },
  {
    "company_name": "Arribas HK / United Art Metals HKG",
    "contact_name": "Dennis Leung",
    "country": "Hong Kong",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "vip",
      "distributor",
      "hk",
      "email",
      "disney",
      "hkdl"
    ],
    "segment": "VIP — Arribas (HK sourcing)",
    "crm_status": "Prospect",
    "primary_channel": "Email",
    "is_personal_wa": false,
    "is_vip": true,
    "source": "Email Marketing",
    "notes": "HK sourcing for Arribas Brothers. Coordinates HKDL items via United Art Metals HKG. Part of Arribas network: Mark Lee (FL), Scott P (Japan).",
    "last_contact_date_str": "2026-05-14",
    "last_contact_notes": "HKDL item info requested",
    "action_required": "Follow up on HKDL item information — coordinate with Mark Lee",
    "products_interest": "HKDL Disney items; HK sourcing for Arribas"
  },
  {
    "company_name": "Detesk",
    "contact_name": "Veronika Fojtíková",
    "country": "Czech Republic",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "distributor",
      "europe",
      "email",
      "zodiac",
      "czech"
    ],
    "segment": "Distributor — Europe",
    "crm_status": "Active",
    "primary_channel": "Email",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Email Marketing",
    "notes": "Long-term customer since Aug 2025. 16 emails. Zodiac order in progress. Payment confirmations via United Art Metals.",
    "last_contact_date_str": "2026-05-15",
    "last_contact_notes": "Zodiac order drawing status pending",
    "action_required": "Reply re zodiac schedule & confirm drawing/production status",
    "products_interest": "Zodiac figures; crystal gifts"
  },
  {
    "company_name": "TSC Hospitality",
    "contact_name": "Rupert Fowler",
    "country": "UK",
    "contact_emails": [
      "rupert@tschospitality.com"
    ],
    "contact_phones": [
      "+44 7748 966669"
    ],
    "contact_email": "rupert@tschospitality.com",
    "contact_phone": "+44 7748 966669",
    "whatsapp": "",
    "website": "",
    "tags": [
      "gift",
      "oem",
      "uk",
      "email",
      "whatsapp",
      "nfc"
    ],
    "segment": "Gift/OEM",
    "crm_status": "Prospect",
    "primary_channel": "Email",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Email Marketing",
    "notes": "TSC Hospitality UK. NFC coin custom serial numbers. Ship to London W11.",
    "last_contact_date_str": "2026-06-03",
    "last_contact_notes": "Invoice sent GBP 596.25 incl shipping GBP 180",
    "action_required": "Chase GBP 596.25 final payment — overdue. Ship to: Basement 6A Powis Gardens London W11 1JG",
    "products_interest": "NFC Coins custom serial; branded gifts"
  },
  {
    "company_name": "Widdop Bingham & Co Ltd",
    "contact_name": "Widdop Team",
    "country": "UK",
    "contact_emails": [
      "dean.stoloff@widdop.co.uk",
      "karen.shakeshaft@widdop.co.uk",
      "amy.yarwood@widdop.co.uk"
    ],
    "contact_phones": [],
    "contact_email": "dean.stoloff@widdop.co.uk",
    "contact_phone": "",
    "whatsapp": "",
    "website": "https://www.widdop.co.uk",
    "tags": [
      "distributor",
      "uk",
      "email",
      "roses",
      "crystal-fabric",
      "major"
    ],
    "segment": "Distributor — Major UK",
    "crm_status": "Active",
    "primary_channel": "Email",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Email Marketing",
    "notes": "MAJOR account — 142 emails. 8 contacts: Dean Stoloff (PO), Karen Shakeshaft (C74/balance), Amy Yarwood (PPWR/REACH), Lucy Hopkins (rose dev), Phil Liggins (payments), Becky Lear (balance), Sarah Lancashire (SP382), Claire Keenan (REACH docs). Crystocraft Poppy rose in development.",
    "last_contact_date_str": "2026-06-02",
    "last_contact_notes": "Multiple open items — balance, rose order, PPWR docs",
    "action_required": "Check C74 balance + confirm new rose order material + send PPWR/REACH compliance docs",
    "products_interest": "Crystal roses (Crystocraft Poppy); SP382; C74 order"
  },
  {
    "company_name": "Marco Polo SC",
    "contact_name": "Jacek Zelazny",
    "country": "Poland",
    "contact_emails": [
      "biuro@marcopolosc.pl"
    ],
    "contact_phones": [],
    "contact_email": "biuro@marcopolosc.pl",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "distributor",
      "poland",
      "email",
      "vip",
      "biggest-poland"
    ],
    "segment": "Distributor — Poland (BIGGEST)",
    "crm_status": "Prospect",
    "primary_channel": "Email",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Email Marketing",
    "notes": "Boss of Marco Polo SC — biggest Poland customer for Crystocraft. 5+ email threads. New order photo sent 3 Jun (26KB, unread). SO250022 prior order.",
    "last_contact_date_str": "2026-05-25",
    "last_contact_notes": "New order photo sent 3 Jun — unread",
    "action_required": "Open unread photo email & confirm new order — biggest Poland customer",
    "products_interest": "Crystocraft full range; crystal gifts; figurines"
  },
  {
    "company_name": "PHU Sovenir",
    "contact_name": "Dawid Reiter",
    "country": "Poland",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "distributor",
      "poland",
      "email"
    ],
    "segment": "Distributor — Poland",
    "crm_status": "Prospect",
    "primary_channel": "Email",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Email Marketing",
    "notes": "Polish souvenir distributor. 10+ emails. Two orders: SO250036 (prior) and SO260019 (new, production notice sent 28 May). Deposit received.",
    "last_contact_date_str": "2026-05-19",
    "last_contact_notes": "Material being ordered for SO260019",
    "action_required": "Update on SO260019 UC4928/26 production & shipping timeline",
    "products_interest": "Crystal products; souvenir items"
  },
  {
    "company_name": "Petrie B.V.",
    "contact_name": "Gerald Petrie",
    "country": "Netherlands",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "distributor",
      "europe",
      "email",
      "crystal-fabric",
      "netherlands"
    ],
    "segment": "Distributor — Europe",
    "crm_status": "Prospect",
    "primary_channel": "Email",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Email Marketing",
    "notes": "Crystal fabric from Crystocraft. Payment received, production starting. SO260008.",
    "last_contact_date_str": "2026-06-05",
    "last_contact_notes": "Payment received, sample production starting",
    "action_required": "Reply to latest email & update sample production status",
    "products_interest": "Crystal fabric — sample production"
  },
  {
    "company_name": "—",
    "contact_name": "Peter Lammer",
    "country": "—",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "distributor",
      "email"
    ],
    "segment": "Distributor",
    "crm_status": "Prospect",
    "primary_channel": "Email",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Email Marketing",
    "notes": "SO260005 UC4881/26. zheng.cl, 郑翠玲, Cindy Chou all involved.",
    "last_contact_date_str": "2026-05-26",
    "last_contact_notes": "Waiting balance + shipping arrangement",
    "action_required": "Chase balance payment & arrange shipping for SO260005",
    "products_interest": "Crystal products"
  },
  {
    "company_name": "—",
    "contact_name": "Marvin Schorli",
    "country": "Germany",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "distributor",
      "europe",
      "email",
      "germany",
      "swarovski"
    ],
    "segment": "Distributor — Europe",
    "crm_status": "Prospect",
    "primary_channel": "Email",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Email Marketing",
    "notes": "Requesting best Swarovski alternative. zheng.cl & Cindy Chou replying.",
    "last_contact_date_str": "2026-06-04",
    "last_contact_notes": "Alternative crystal spec being quoted",
    "action_required": "Confirm Swarovski alternative crystal spec & pricing for SO260016",
    "products_interest": "Swarovski alternative crystals"
  },
  {
    "company_name": "Kelvin's Collection",
    "contact_name": "Esther",
    "country": "Hong Kong",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "distributor",
      "hk",
      "personal-wa",
      "long-term"
    ],
    "segment": "Distributor — HK VIP",
    "crm_status": "Prospect",
    "primary_channel": "Personal WhatsApp",
    "is_personal_wa": true,
    "is_vip": false,
    "source": "Direct",
    "notes": "Long-term HK distributor. Esther is main contact via Eddie's personal WhatsApp. 3 production orders confirmed. Based in HK.",
    "last_contact_date_str": "2026-05-29",
    "last_contact_notes": "Production start on SO260002 needed",
    "action_required": "Contact Esther via personal WhatsApp — confirm SO260002 UC4868/26 production start",
    "products_interest": "Crystocraft full range"
  },
  {
    "company_name": "Matashi / All-in-Audio (AIA)",
    "contact_name": "Joe / Zach / Tony Lam",
    "country": "United States",
    "contact_emails": [
      "joe@matashi.com",
      "zach@matashi.com"
    ],
    "contact_phones": [],
    "contact_email": "joe@matashi.com",
    "contact_phone": "",
    "whatsapp": "",
    "website": "https://www.matashi.com",
    "tags": [
      "distributor",
      "usa",
      "personal-wa",
      "email",
      "aia",
      "matashi"
    ],
    "segment": "Distributor — USA Importer",
    "crm_status": "Prospect",
    "primary_channel": "Personal WhatsApp",
    "is_personal_wa": true,
    "is_vip": false,
    "source": "Direct",
    "notes": "AIA = All-in-Audio = Matashi. Joe is boss based in New Jersey NJ. Personal WhatsApp primary contact. Zach also contacts. Tony Lam internal. US custom crystal design house.",
    "last_contact_date_str": "2026-05-26",
    "last_contact_notes": "Multiple sample items pending",
    "action_required": "Contact Joe via personal WhatsApp — action Judaica samples / flower vase / laser engraving / new items / shipping",
    "products_interest": "Judaica items; flower vase; laser engraving; new items; packaging"
  },
  {
    "company_name": "—",
    "contact_name": "Sam Chan",
    "country": "Hong Kong",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "local-hk",
      "email",
      "whatsapp"
    ],
    "segment": "Local HK",
    "crm_status": "Active",
    "primary_channel": "Email",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Email Marketing",
    "notes": "Local HK customer. SI260022 UC4883/26. PayPal $44.01 received.",
    "last_contact_date_str": "2026-06-05",
    "last_contact_notes": "PayPal $44.01 received — done",
    "action_required": "Confirm order processing complete",
    "products_interest": "Offline order"
  },
  {
    "company_name": "Marco Polo SC",
    "contact_name": "Jacek Zelazny",
    "country": "Poland",
    "contact_emails": [
      "biuro@marcopolosc.pl"
    ],
    "contact_phones": [],
    "contact_email": "biuro@marcopolosc.pl",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "distributor",
      "poland",
      "email"
    ],
    "segment": "Distributor — Poland (BIGGEST)",
    "crm_status": "Prospect",
    "primary_channel": "Email",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Email Marketing",
    "notes": "Biggest Poland customer.",
    "last_contact_date_str": "2026-05-25",
    "last_contact_notes": "New order photo sent 3 Jun — unread",
    "action_required": "Open unread photo email & confirm new order",
    "products_interest": "Crystocraft full range"
  },
  {
    "company_name": "Prestige Productions HK Ltd",
    "contact_name": "Wendy",
    "country": "Hong Kong",
    "contact_emails": [
      "contact@prestige.com.hk"
    ],
    "contact_phones": [
      "+852 3521-0964"
    ],
    "contact_email": "contact@prestige.com.hk",
    "contact_phone": "+852 3521-0964",
    "whatsapp": "",
    "website": "https://prestige.com.hk",
    "tags": [
      "gift",
      "oem",
      "hk",
      "personal-wa",
      "luxury",
      "prestige"
    ],
    "segment": "Gift/OEM — Sourcing Agency",
    "crm_status": "Active",
    "primary_channel": "Personal WhatsApp",
    "is_personal_wa": true,
    "is_vip": false,
    "source": "Direct",
    "notes": "19+ yr HK sourcing & branded merchandise agency (prestige.com.hk). 300+ brands. Wendy is key person. Unit 2202, 22/F, Causeway Bay Plaza 1, 489 Hennessy Rd, Causeway Bay HK. NOT in email — personal WhatsApp only.",
    "last_contact_date_str": "2026-06-01",
    "last_contact_notes": "All OEM items pending — NOT in email",
    "action_required": "Contact Wendy via personal WhatsApp — action ALL: Delvaux pin 3D model / 3-layer basket sampling / wood handle prototype / trophy sample",
    "products_interest": "Delvaux pin; 3-layer basket; wood handle prototype; trophy sample; custom OEM"
  },
  {
    "company_name": "VCFC",
    "contact_name": "Viviana Palermo",
    "country": "—",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "gift",
      "oem",
      "email",
      "nfc",
      "vcfc"
    ],
    "segment": "Gift/OEM — Sports Club",
    "crm_status": "Prospect",
    "primary_channel": "Email",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Email Marketing",
    "notes": "40 emails since Feb 2026. Also contacts: Anastasia Allen, Evelyn Nikolaou. Insignia is coin reviewer within VCFC project.",
    "last_contact_date_str": "2026-06-05",
    "last_contact_notes": "200pcs in production — coin review ongoing",
    "action_required": "Check 200pcs NFC coin production status & ETA. Confirm Insignia coin review.",
    "products_interest": "NFC Coins 200pcs custom — VCFC Coin (Insignia review)"
  },
  {
    "company_name": "La Salle Primary School PTA",
    "contact_name": "Heymans Ho",
    "country": "Hong Kong",
    "contact_emails": [
      "heymans12@hotmail.com"
    ],
    "contact_phones": [],
    "contact_email": "heymans12@hotmail.com",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "gift",
      "oem",
      "hk",
      "personal-wa",
      "school",
      "lsps"
    ],
    "segment": "Gift/OEM — School",
    "crm_status": "Active",
    "primary_channel": "Personal WhatsApp",
    "is_personal_wa": true,
    "is_vip": false,
    "source": "Direct",
    "notes": "LSPSPTA contact. 5 emails Jan–Apr 2026. Black tumbler 55pcs with engraving + swimming bags done. Personal WhatsApp primary.",
    "last_contact_date_str": "2026-04-01",
    "last_contact_notes": "All orders completed",
    "action_required": "Completed — nurture for next school year orders",
    "products_interest": "Tumblers; swimming bags; mobile straps — school gifts"
  },
  {
    "company_name": "—",
    "contact_name": "+974 3009 3238",
    "country": "Qatar",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "+974 3009 3238",
    "website": "",
    "tags": [
      "whatsapp",
      "qatar",
      "hot-lead",
      "b2b",
      "custom"
    ],
    "segment": "WA — Hot B2B Lead",
    "crm_status": "Active",
    "primary_channel": "WhatsApp",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Direct",
    "notes": "Detailed B2B inquiry for custom crystal building models. Asked about materials, portfolio, custom mfg, lead time, pricing, Qatar shipping. Replied today asking for drawings.",
    "last_contact_date_str": "2026-06-03",
    "last_contact_notes": "Replied today — asked for drawings",
    "action_required": "Await architectural drawings — follow up 8 Jun if no reply",
    "products_interest": "Custom crystal architectural models; buildings"
  },
  {
    "company_name": "—",
    "contact_name": "+886 979 536 591",
    "country": "Taiwan",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "+886 979 536 591",
    "website": "",
    "tags": [
      "whatsapp",
      "taiwan",
      "lead"
    ],
    "segment": "WA — Lead",
    "crm_status": "Prospect",
    "primary_channel": "WhatsApp",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Direct",
    "notes": "Shared crystocraft.com product link.",
    "last_contact_date_str": "2026-06-04",
    "last_contact_notes": "Shared product link",
    "action_required": "Follow up with product info & pricing",
    "products_interest": "Personalized birthstone necklace"
  },
  {
    "company_name": "—",
    "contact_name": "+52 1 55 6921 4851",
    "country": "Mexico",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "+52 1 55 6921 4851",
    "website": "",
    "tags": [
      "whatsapp",
      "mexico",
      "lead"
    ],
    "segment": "WA — Lead",
    "crm_status": "Prospect",
    "primary_channel": "WhatsApp",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Direct",
    "notes": "Asked how many qty needed. No reply received.",
    "last_contact_date_str": "2026-05-20",
    "last_contact_notes": "Asked quantity — no reply",
    "action_required": "Follow up — asked qty, no reply",
    "products_interest": "In-stock product"
  },
  {
    "company_name": "—",
    "contact_name": "+55 16 99118-5833",
    "country": "Brazil",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "+55 16 99118-5833",
    "website": "",
    "tags": [
      "whatsapp",
      "brazil",
      "lead",
      "rose"
    ],
    "segment": "WA — Lead",
    "crm_status": "Prospect",
    "primary_channel": "WhatsApp",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Direct",
    "notes": "Asked which rose colour. No reply received.",
    "last_contact_date_str": "2026-05-19",
    "last_contact_notes": "Asked which rose — no reply",
    "action_required": "Follow up with rose colour options",
    "products_interest": "Rose product — colour choice"
  },
  {
    "company_name": "—",
    "contact_name": "+48 577 720 590",
    "country": "Poland",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "+48 577 720 590",
    "website": "",
    "tags": [
      "whatsapp",
      "poland",
      "lead",
      "music-box"
    ],
    "segment": "WA — Lead",
    "crm_status": "Prospect",
    "primary_channel": "WhatsApp",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Direct",
    "notes": "Freight Shenzhen→Poland $650 USD 6–12 days quoted. No reply since.",
    "last_contact_date_str": "2026-04-30",
    "last_contact_notes": "Freight $650 quoted — no reply",
    "action_required": "Follow up on music box order — freight $650 Shenzhen→Poland quoted",
    "products_interest": "Music box 100pcs"
  },
  {
    "company_name": "—",
    "contact_name": "Farooq Khan",
    "country": "Pakistan",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "+92 306 4333575",
    "website": "",
    "tags": [
      "whatsapp",
      "pakistan",
      "retail"
    ],
    "segment": "WA — Retail",
    "crm_status": "Prospect",
    "primary_channel": "WhatsApp",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Direct",
    "notes": "Retail buyer, 1 piece. Replied with website link today.",
    "last_contact_date_str": "2026-06-02",
    "last_contact_notes": "Replied with website link",
    "action_required": "Await reply — directed to website",
    "products_interest": "50th Anniversary gold heart figurine (1pc)"
  },
  {
    "company_name": "—",
    "contact_name": "+49 1521 1100338",
    "country": "Germany",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "+49 1521 1100338",
    "website": "",
    "tags": [
      "whatsapp",
      "germany",
      "lead"
    ],
    "segment": "WA — Lead",
    "crm_status": "Prospect",
    "primary_channel": "WhatsApp",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Direct",
    "notes": "Customer said 'Confirm'. May be order confirmation.",
    "last_contact_date_str": "2026-05-18",
    "last_contact_notes": "Said Confirm — possible order",
    "action_required": "Verify what was confirmed & process order if applicable",
    "products_interest": "—"
  },
  {
    "company_name": "—",
    "contact_name": "+237 6 52 75 78 08",
    "country": "Cameroon",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "+237 6 52 75 78 08",
    "website": "",
    "tags": [
      "whatsapp",
      "cameroon",
      "lead"
    ],
    "segment": "WA — Lead",
    "crm_status": "Prospect",
    "primary_channel": "WhatsApp",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Direct",
    "notes": "Part replacement discussion ongoing.",
    "last_contact_date_str": "2026-05-19",
    "last_contact_notes": "Part replacement offered",
    "action_required": "Follow up on part replacement",
    "products_interest": "Replacement parts"
  },
  {
    "company_name": "—",
    "contact_name": "Haleema Asiri",
    "country": "Saudi Arabia",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "alibaba",
      "saudi-arabia",
      "new"
    ],
    "segment": "Alibaba — New",
    "crm_status": "Active",
    "primary_channel": "Alibaba",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Alibaba",
    "notes": "New inquiry 6 Jun. Needs immediate reply.",
    "last_contact_date_str": "2026-06-06",
    "last_contact_notes": "New inquiry today",
    "action_required": "Reply on Alibaba today",
    "products_interest": "Crystal products"
  },
  {
    "company_name": "—",
    "contact_name": "Peter Mink",
    "country": "Netherlands",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "alibaba",
      "netherlands",
      "l1",
      "zodiac"
    ],
    "segment": "Alibaba — L1+",
    "crm_status": "Active",
    "primary_channel": "Alibaba",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Alibaba",
    "notes": "L1+ buyer. Added to contacts. Zodiac signs order pending.",
    "last_contact_date_str": "2026-06-06",
    "last_contact_notes": "Zodiac order — top CRM action",
    "action_required": "Reply re zodiac signs order — CRM top Alibaba action item",
    "products_interest": "Zodiac signs"
  },
  {
    "company_name": "Arribas Brothers (Japan)",
    "contact_name": "Scott P",
    "country": "Japan",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "alibaba",
      "japan",
      "vip",
      "arribas",
      "disney",
      "Distributor"
    ],
    "segment": "VIP — Arribas (Japan sourcing)",
    "crm_status": "Prospect",
    "primary_channel": "Alibaba",
    "is_personal_wa": false,
    "is_vip": true,
    "source": "Alibaba",
    "notes": "Works for Arribas Brothers Japan sourcing office. Treat as VIP. Same parent company as Mark Lee (FL GM) and Dennis Leung (HK).",
    "last_contact_date_str": "2026-05-30",
    "last_contact_notes": "Alibaba sourcing for Arribas Japan",
    "action_required": "Follow up — treat as Arribas VIP. Coordinate with Mark Lee (Florida).",
    "products_interest": "Crystal products — Arribas Japan sourcing"
  },
  {
    "company_name": "—",
    "contact_name": "Aurora Perezmonclova",
    "country": "Spain",
    "contact_emails": [
      "auroraperezmonclova4@gmail.com"
    ],
    "contact_phones": [],
    "contact_email": "auroraperezmonclova4@gmail.com",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "alibaba",
      "spain",
      "l1",
      "romantic-gifts"
    ],
    "segment": "Alibaba — L1+",
    "crm_status": "Prospect",
    "primary_channel": "Alibaba",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Alibaba",
    "notes": "L1+ buyer. 224 product views, 36 valid inquiries, member since 2021. Shipping query answered.",
    "last_contact_date_str": "2026-05-29",
    "last_contact_notes": "Replied today re shipping query",
    "action_required": "Await reply — strong buyer profile (224 views, 36 inquiries, 2021 member)",
    "products_interest": "Crystal anniversary gift; romantic gifts"
  },
  {
    "company_name": "MikeDenny",
    "contact_name": "Mike Denny",
    "country": "Poland",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "alibaba",
      "poland",
      "l1",
      "figurine"
    ],
    "segment": "Alibaba — L1+",
    "crm_status": "Prospect",
    "primary_channel": "Alibaba",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Alibaba",
    "notes": "L1+ buyer. 304 product views, 25 login days, member since 2022. Crystal crafts, night lights interest.",
    "last_contact_date_str": "2026-05-29",
    "last_contact_notes": "Replied today",
    "action_required": "Await reply — L1+ buyer (304 views, 25 login days, 2022 member)",
    "products_interest": "Crystal Swan Couple Figurine; crystal crafts; night lights"
  },
  {
    "company_name": "Regalo Original SL",
    "contact_name": "Romina Fride",
    "country": "Spain",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "alibaba",
      "spain",
      "distributor",
      "regalo"
    ],
    "segment": "Distributor — Spain",
    "crm_status": "Prospect",
    "primary_channel": "Alibaba",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Alibaba",
    "notes": "Romina Fride IS Regalo Original SL. Alibaba order SO260018 UC4926/26 completed. New order being discussed.",
    "last_contact_date_str": "2026-05-14",
    "last_contact_notes": "Order done; new order pending",
    "action_required": "Follow up new order & material for Regalo Original",
    "products_interest": "Crystal products; Alibaba order"
  },
  {
    "company_name": "—",
    "contact_name": "Ron Eichhorn",
    "country": "Austria",
    "contact_emails": [
      "ron@true-eye.com"
    ],
    "contact_phones": [],
    "contact_email": "ron@true-eye.com",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "alibaba",
      "austria",
      "glass",
      "drinkware"
    ],
    "segment": "Alibaba — Active",
    "crm_status": "Prospect",
    "primary_channel": "Alibaba",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Alibaba",
    "notes": "Prefers pure glass over crystal. Registration 2 Jun 2026. Replied today.",
    "last_contact_date_str": "2026-06-03",
    "last_contact_notes": "Replied with pure glass alternatives",
    "action_required": "Await reply — offered pure glass decanter options",
    "products_interest": "Pure glass wine decanters; glass products"
  },
  {
    "company_name": "—",
    "contact_name": "Vladimir Nicolas",
    "country": "Canada",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "alibaba",
      "canada",
      "active"
    ],
    "segment": "Alibaba — Active",
    "crm_status": "Prospect",
    "primary_channel": "Alibaba",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Alibaba",
    "notes": "Active ongoing thread.",
    "last_contact_date_str": "2026-06-04",
    "last_contact_notes": "Ongoing thread",
    "action_required": "Follow up",
    "products_interest": "Crystal products"
  },
  {
    "company_name": "—",
    "contact_name": "Edith Flores",
    "country": "Mexico",
    "contact_emails": [
      "mw4d8z8yr6@privaterelay.appleid.com"
    ],
    "contact_phones": [],
    "contact_email": "mw4d8z8yr6@privaterelay.appleid.com",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "alibaba",
      "mexico",
      "lead",
      "wind-chime"
    ],
    "segment": "Alibaba — Lead",
    "crm_status": "Prospect",
    "primary_channel": "Alibaba",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Alibaba",
    "notes": "36 units crystal wind chime. Replied today.",
    "last_contact_date_str": "2026-05-31",
    "last_contact_notes": "Replied today with standard intro",
    "action_required": "Await reply",
    "products_interest": "Metal wind chime w/ crystals (36pcs)"
  },
  {
    "company_name": "—",
    "contact_name": "Charlie Mackennz",
    "country": "Russia",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "alibaba",
      "russia",
      "active"
    ],
    "segment": "Alibaba — Active",
    "crm_status": "Prospect",
    "primary_channel": "Alibaba",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Alibaba",
    "notes": "Active.",
    "last_contact_date_str": "2026-06-01",
    "last_contact_notes": "Ongoing thread",
    "action_required": "Follow up",
    "products_interest": "Crystal products"
  },
  {
    "company_name": "—",
    "contact_name": "Diego Briones",
    "country": "Mexico",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "alibaba",
      "mexico",
      "active"
    ],
    "segment": "Alibaba — Active",
    "crm_status": "Prospect",
    "primary_channel": "Alibaba",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Alibaba",
    "notes": "Active.",
    "last_contact_date_str": "2026-05-31",
    "last_contact_notes": "Ongoing thread",
    "action_required": "Follow up",
    "products_interest": "Crystal product"
  },
  {
    "company_name": "—",
    "contact_name": "DENILSON RIBEIRO",
    "country": "Brazil",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "alibaba",
      "brazil",
      "active"
    ],
    "segment": "Alibaba — Active",
    "crm_status": "Prospect",
    "primary_channel": "Alibaba",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Alibaba",
    "notes": "Active.",
    "last_contact_date_str": "2026-05-23",
    "last_contact_notes": "Ongoing thread",
    "action_required": "Follow up",
    "products_interest": "Crystal products"
  },
  {
    "company_name": "—",
    "contact_name": "Lesly Avina",
    "country": "United States",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "alibaba",
      "usa",
      "active"
    ],
    "segment": "Alibaba — Active",
    "crm_status": "Prospect",
    "primary_channel": "Alibaba",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Alibaba",
    "notes": "Active.",
    "last_contact_date_str": "2026-05-23",
    "last_contact_notes": "Ongoing thread",
    "action_required": "Follow up",
    "products_interest": "Crystal product"
  },
  {
    "company_name": "—",
    "contact_name": "Natalia Siwczak",
    "country": "Poland",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "alibaba",
      "poland",
      "active"
    ],
    "segment": "Alibaba — Active",
    "crm_status": "Prospect",
    "primary_channel": "Alibaba",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Alibaba",
    "notes": "Active.",
    "last_contact_date_str": "2026-05-21",
    "last_contact_notes": "Ongoing thread",
    "action_required": "Follow up",
    "products_interest": "Crystal products"
  },
  {
    "company_name": "—",
    "contact_name": "Tobias Goppert",
    "country": "Germany",
    "contact_emails": [],
    "contact_phones": [],
    "contact_email": "",
    "contact_phone": "",
    "whatsapp": "",
    "website": "",
    "tags": [
      "alibaba",
      "germany",
      "active"
    ],
    "segment": "Alibaba — Active",
    "crm_status": "Prospect",
    "primary_channel": "Alibaba",
    "is_personal_wa": false,
    "is_vip": false,
    "source": "Alibaba",
    "notes": "Active.",
    "last_contact_date_str": "2026-05-15",
    "last_contact_notes": "Ongoing thread",
    "action_required": "Follow up",
    "products_interest": "Crystal products"
  }
]

function parseDateStr(s) {
  if (!s) return null
  try {
    return Timestamp.fromDate(new Date(s))
  } catch {
    return null
  }
}

export default function ImportData() {
  const [log, setLog] = useState([])
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)

  function addLog(msg) { setLog(l => [...l, msg]) }

  async function handleClearAndImport() {
    if (!confirm('This will DELETE all existing customers and import 40 fresh records. Are you sure?')) return
    setRunning(true)
    setLog([])
    setDone(false)

    try {
      // 1. Delete existing customers
      addLog('Deleting existing customers…')
      const existing = await getDocs(collection(db, 'customers'))
      await Promise.all(existing.docs.map(d => deleteDoc(doc(db, 'customers', d.id))))
      addLog(`Deleted ${existing.docs.length} existing customer(s).`)

      // 2. Import new records
      addLog('Importing 40 new customers…')
      let count = 0
      for (const r of IMPORT_DATA) {
        const { last_contact_date_str, last_contact_notes, action_required, products_interest, ...coreData } = r
        
        const payload = {
          ...coreData,
          last_contacted: parseDateStr(last_contact_date_str),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
        
        const ref = await addDoc(collection(db, 'customers'), payload)
        
        // Seed initial enquiry — may fail if Firestore rules not yet published
        if (last_contact_notes || action_required) {
          try {
            await addDoc(collection(db, 'customers', ref.id, 'enquiries'), {
              date: parseDateStr(last_contact_date_str) || Timestamp.now(),
              description: [last_contact_notes, action_required].filter(Boolean).join(' — Action: '),
              product_interest: products_interest ? products_interest.split(';').map(s => s.trim()).filter(Boolean) : [],
              channel: r.primary_channel || '',
              status: 'Open',
              follow_up_date: null,
              outcome_notes: '',
              linked_quote_ids: [],
              createdAt: serverTimestamp(),
            })
          } catch {
            // Enquiry rules not published yet — customer still saved, skip enquiry
          }
        }

        count++
        addLog(`✓ ${count}/40 — ${r.company_name} (${r.contact_name || '—'})`)
      }

      addLog('')
      addLog(`✅ Import complete! ${count} customers imported.`)
      addLog('⚠️  Enquiry seeding requires Firestore rules to be published — see below if enquiries are missing.')
      setDone(true)
    } catch (err) {
      addLog(`❌ Error: ${err.message}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">CRM Data Import</h1>
      <p className="text-sm text-gray-500 mb-6">
        One-time import of 40 customers from <code>Crystocraft_CRM_Import.xlsx</code>.
        This will clear all existing customers first.
      </p>

      <div className="card p-5 mb-4">
        <p className="text-sm font-semibold text-gray-700 mb-1">What this does:</p>
        <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside mb-4">
          <li>Deletes ALL existing customers in Firestore</li>
          <li>Imports 40 customers with full CRM fields (channel, status, segment, VIP, etc.)</li>
          <li>Seeds one initial enquiry entry per customer from last contact notes</li>
        </ul>
        <button
          onClick={handleClearAndImport}
          disabled={running || done}
          className="btn-primary"
        >
          {running ? 'Importing…' : done ? '✅ Done' : '🚀 Clear & Import 40 Customers'}
        </button>
      </div>

      {log.length > 0 && (
        <div className="card p-4 font-mono text-xs text-gray-700 space-y-0.5 max-h-96 overflow-y-auto">
          {log.map((line, i) => <div key={i}>{line || <br />}</div>)}
        </div>
      )}
    </div>
  )
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const WP_BASE_URL     = Deno.env.get('WP_BASE_URL')
  const WP_USERNAME     = Deno.env.get('WP_USER')
  const WP_APP_PASSWORD = Deno.env.get('WP_PASS')

  if (!WP_BASE_URL || !WP_USERNAME || !WP_APP_PASSWORD) {
    return new Response(JSON.stringify({ error: 'WordPress credentials not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  const credentials = btoa(`${WP_USERNAME}:${WP_APP_PASSWORD}`)
  const wpApi = `${WP_BASE_URL}/wp-json/wp/v2`

  // Payload shape:
  //   Spotlight: { type:'spotlight', hero:{firebase_url,alt_text}, content:{...result, sections:[{heading,body,images:[]}]} }
  //   Roundup:   { type:'roundup',  content:{...result},           images:[{firebase_url,alt_text,caption}] }
  let type, content, images, hero
  try {
    const body = await req.json()
    type = body.type; content = body.content; images = body.images; hero = body.hero
  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed to parse request body: ${err.message}` }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── Helper: read JPEG/PNG dimensions from binary header (fallback if Canvas unavailable) ──
  function readImageDimensions(arrayBuffer) {
    const v = new DataView(arrayBuffer)
    try {
      // JPEG: scan for SOF markers (FF C0..C3, C5..C7, C9..CB, CD..CF)
      if (v.getUint16(0) === 0xFFD8) {
        let i = 2
        while (i < v.byteLength - 8) {
          if (v.getUint8(i) !== 0xFF) break
          const marker = v.getUint8(i + 1)
          if ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) ||
              (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF)) {
            return { width: v.getUint16(i + 7), height: v.getUint16(i + 5) }
          }
          i += 2 + v.getUint16(i + 2)
        }
      }
      // PNG: dimensions at bytes 16–23
      if (v.getUint32(0) === 0x89504E47) {
        return { width: v.getUint32(16), height: v.getUint32(20) }
      }
    } catch {}
    return null
  }

  // ── Helper: resize + compress image
  // imageType 'hero'    → always 1200px wide (banner use), max 400KB
  // imageType 'content' → square→1000px, landscape→1200px, portrait→1000px, max 200KB
  // Returns { buffer, width, height }
  async function resizeAndCompress(arrayBuffer, imageType = 'content') {
    const isHero   = imageType === 'hero'
    const MAX_BYTES = isHero ? 400 * 1024 : 200 * 1024

    // Always try to get original dims from header (used in fallback filename)
    const origDims = readImageDimensions(arrayBuffer)

    try {
      const blob   = new Blob([arrayBuffer], { type: 'image/jpeg' })
      const bitmap = await createImageBitmap(blob)
      const { width, height } = bitmap
      const ratio = width / height

      let tw, th
      if (isHero) {
        // Hero: always treat as landscape banner — 1200px wide max
        tw = Math.min(width, 1200); th = Math.round(tw / ratio)
      } else if (ratio >= 0.85 && ratio <= 1.18) {
        // Square content: cap longest side at 1000px
        tw = Math.min(width, 1000); th = Math.round(tw / ratio)
      } else if (width >= height) {
        // Landscape content: 1200px wide
        tw = Math.min(width, 1200); th = Math.round(tw / ratio)
      } else {
        // Portrait content: 1000px wide
        tw = Math.min(width, 1000); th = Math.round(tw / ratio)
      }

      // Skip redraw if already within target size and small enough
      if (tw === width && th === height && arrayBuffer.byteLength <= MAX_BYTES) {
        bitmap.close()
        return { buffer: arrayBuffer, width: tw, height: th }
      }

      const canvas = new OffscreenCanvas(tw, th)
      canvas.getContext('2d').drawImage(bitmap, 0, 0, tw, th)
      bitmap.close()

      const qualities = isHero
        ? [0.88, 0.80, 0.70, 0.60, 0.50]
        : [0.85, 0.75, 0.65, 0.50, 0.35, 0.25]

      for (const quality of qualities) {
        const out = await canvas.convertToBlob({ type: 'image/jpeg', quality })
        const buf = await out.arrayBuffer()
        if (buf.byteLength <= MAX_BYTES) return { buffer: buf, width: tw, height: th }
      }
      // Last resort: lowest quality
      const last = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.20 })
      return { buffer: await last.arrayBuffer(), width: tw, height: th }

    } catch (err) {
      console.error('resizeAndCompress failed:', err?.message, '| size:', arrayBuffer.byteLength, '| dims:', origDims)
      return { buffer: arrayBuffer, width: origDims?.width || 0, height: origDims?.height || 0 }
    }
  }

  function slugify(str) {
    return (str || 'crystocraft')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60)
  }

  // ── Helper: upload one image to WP Media Library ───────────────────────────
  // imageType: 'hero' | 'content'
  async function uploadOne(firebase_url, alt_text = '', caption = '', productName = '', imageType = 'content') {
    try {
      const imgRes = await fetch(firebase_url)
      if (!imgRes.ok) return null
      const raw  = await imgRes.arrayBuffer()
      const { buffer: imgBuffer, width, height } = await resizeAndCompress(raw, imageType)
      const sizeStr  = width && height ? `${width}x${height}` : Date.now().toString()
      const filename = `${slugify(productName)}-${imageType}-${sizeStr}.jpg`

      const mediaRes = await fetch(`${wpApi}/media`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Type': 'image/jpeg',
        },
        body: imgBuffer,
      })
      if (!mediaRes.ok) { console.error('Media upload failed:', await mediaRes.text()); return null }
      const mediaData = await mediaRes.json()

      // Set alt text + caption
      await fetch(`${wpApi}/media/${mediaData.id}`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ alt_text, caption }),
      })

      return { wp_id: mediaData.id, wp_url: mediaData.source_url, alt_text, caption }
    } catch (err) {
      console.error('uploadOne error:', err)
      return null
    }
  }

  // ── Gutenberg block builders ───────────────────────────────────────────────
  function imgBlock(media, size = 'large', extraClass = '', linkUrl = '') {
    if (!media) return ''
    const cls = ['wp-block-image', `size-${size}`, extraClass].filter(Boolean).join(' ')
    const imgEl = `<img src="${media.wp_url}" alt="${media.alt_text || ''}" />`
    const figInner = linkUrl ? `<a href="${linkUrl}">${imgEl}</a>` : imgEl
    const caption = media.caption ? `<figcaption class="wp-element-caption">${media.caption}</figcaption>` : ''
    const linkAttr = linkUrl ? `,"linkDestination":"custom"` : ''
    return `<!-- wp:image {"id":${media.wp_id},"sizeSlug":"${size}"${linkAttr}} -->\n<figure class="${cls}">${figInner}${caption}</figure>\n<!-- /wp:image -->\n\n`
  }

  function buttonBlock(text, url) {
    if (!url || !text) return ''
    return `<!-- wp:buttons -->\n<div class="wp-block-buttons">\n<!-- wp:button -->\n<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="${url}">${text}</a></div>\n<!-- /wp:button -->\n</div>\n<!-- /wp:buttons -->\n\n`
  }

  function headingBlock(text) {
    if (!text) return ''
    return `<!-- wp:heading {"level":2} -->\n<h2 class="wp-block-heading">${text}</h2>\n<!-- /wp:heading -->\n\n`
  }

  function paraBlock(text) {
    if (!text) return ''
    const inner = text.replace(/\n\n/g, '</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>')
    return `<!-- wp:paragraph -->\n<p>${inner}</p>\n<!-- /wp:paragraph -->\n\n`
  }

  // 1 image: wp:columns — text (60%) left, image (40%) right
  function columnsBlock(heading, body, media) {
    const textBlocks = (heading ? headingBlock(heading) : '') + paraBlock(body)
    const imgCol = imgBlock(media, 'medium')
    return `<!-- wp:columns {"isStackedOnMobile":true} -->\n<div class="wp-block-columns is-layout-flex">\n` +
      `<!-- wp:column {"width":"60%"} -->\n<div class="wp-block-column" style="flex-basis:60%">\n${textBlocks}</div>\n<!-- /wp:column -->\n\n` +
      `<!-- wp:column {"width":"40%"} -->\n<div class="wp-block-column" style="flex-basis:40%">\n${imgCol}</div>\n<!-- /wp:column -->\n</div>\n<!-- /wp:columns -->\n\n`
  }

  // 2–3 images: text then wp:gallery
  function galleryBlock(heading, body, mediaArr) {
    const n = mediaArr.length
    const innerImgs = mediaArr.map(m =>
      `<!-- wp:image {"id":${m.wp_id},"sizeSlug":"medium"} -->\n<figure class="wp-block-image size-medium"><img src="${m.wp_url}" alt="${m.alt_text || ''}" /></figure>\n<!-- /wp:image -->`
    ).join('\n')
    return (heading ? headingBlock(heading) : '') +
      paraBlock(body) +
      `<!-- wp:gallery {"columns":${n},"linkTo":"none"} -->\n<figure class="wp-block-gallery has-nested-images columns-${n} is-cropped">\n${innerImgs}\n</figure>\n<!-- /wp:gallery -->\n\n`
  }

  try {
    let html = ''
    let featuredMediaId = null
    let totalUploaded = 0
    let totalImages = 0

    // ── SPOTLIGHT ─────────────────────────────────────────────────────────────
    if (type === 'spotlight') {
      const sections = content.sections || []
      totalImages = (hero ? 1 : 0) + sections.reduce((n, s) => n + (s.images?.length || 0), 0)

      const productName = content.product_name || ''
      const productUrl  = content.product_url  || ''

      // Upload hero + ALL section images in parallel
      const [heroMedia, ...sectionMediaArrays] = await Promise.all([
        hero?.firebase_url
          ? uploadOne(hero.firebase_url, hero.alt_text || '', '', productName, 'hero')
          : Promise.resolve(null),
        ...sections.map(section =>
          Promise.all((section.images || []).map(img =>
            uploadOne(img.firebase_url, img.alt_text, img.caption, productName, 'content')
          ))
        ),
      ])

      if (heroMedia) { featuredMediaId = heroMedia.wp_id; totalUploaded++ }
      sectionMediaArrays.forEach(arr => arr.forEach(m => { if (m) totalUploaded++ }))

      // Hero is set as featured_media — theme displays it as banner, do NOT add to content

      const spacer = `<!-- wp:spacer {"height":"48px"} -->\n<div style="height:48px" aria-hidden="true" class="wp-block-spacer"></div>\n<!-- /wp:spacer -->\n\n`

      sections.forEach((section, i) => {
        if (i > 0) html += spacer
        const imgs = (sectionMediaArrays[i] || []).filter(Boolean)
        const isCta   = section.type === 'cta'
        const linkUrl = section.section_url || productUrl  // per-section overrides global
        const linkedHeading = (section.heading && linkUrl)
          ? `<!-- wp:heading {"level":2} -->\n<h2 class="wp-block-heading"><a href="${linkUrl}">${section.heading}</a></h2>\n<!-- /wp:heading -->\n\n`
          : headingBlock(section.heading)
        if (imgs.length === 1) {
          html += linkedHeading + paraBlock(section.body) + imgBlock(imgs[0], 'large', '', linkUrl)
        } else if (imgs.length >= 2) {
          // heading already rendered with link — pass null heading to galleryBlock
          html += linkedHeading + paraBlock(section.body) + `<!-- wp:gallery {"columns":${imgs.length},"linkTo":"none"} -->\n<figure class="wp-block-gallery has-nested-images columns-${imgs.length} is-cropped">\n${imgs.map(m => `<!-- wp:image {"id":${m.wp_id},"sizeSlug":"medium"} -->\n<figure class="wp-block-image size-medium"><img src="${m.wp_url}" alt="${m.alt_text || ''}" /></figure>\n<!-- /wp:image -->`).join('\n')}\n</figure>\n<!-- /wp:gallery -->\n\n`
        } else {
          html += linkedHeading + paraBlock(section.body)
        }
        if (isCta && linkUrl) html += buttonBlock('View Product →', linkUrl)
      })

    // ── ROUNDUP ───────────────────────────────────────────────────────────────
    } else if (type === 'roundup') {
      const { intro, items, conclusion } = content
      totalImages = (hero ? 1 : 0) + (items || []).reduce((n, item) => n + (item.images?.length || 0), 0)

      // Upload hero + all item images in parallel
      const heroProductName = (items?.[0]?.product_name) || ''
      const [heroMedia, ...itemMediaArrays] = await Promise.all([
        hero?.firebase_url
          ? uploadOne(hero.firebase_url, hero.alt_text || '', '', heroProductName, 'hero')
          : Promise.resolve(null),
        ...(items || []).map(item =>
          Promise.all((item.images || []).map(img =>
            uploadOne(img.firebase_url, img.alt_text, img.caption, img.product_name || item.product_name || '', 'content')
          ))
        ),
      ])

      if (heroMedia) { featuredMediaId = heroMedia.wp_id; totalUploaded++ }
      itemMediaArrays.forEach(arr => arr.forEach(m => { if (m) totalUploaded++ }))

      const productUrl = content.product_url || ''

      const itemSpacer = `<!-- wp:spacer {"height":"48px"} -->\n<div style="height:48px" aria-hidden="true" class="wp-block-spacer"></div>\n<!-- /wp:spacer -->\n\n`

      // Hero is featured_media only — theme displays it as banner
      if (intro?.body) { html += paraBlock(intro.body); html += itemSpacer }

      items?.forEach((item, idx) => {
        if (idx > 0) html += itemSpacer
        const imgs    = (itemMediaArrays[idx] || []).filter(Boolean)
        const linkUrl = item.item_url || productUrl  // per-item overrides global
        const linkedHeading = (item.heading && linkUrl)
          ? `<!-- wp:heading {"level":2} -->\n<h2 class="wp-block-heading"><a href="${linkUrl}">${item.heading}</a></h2>\n<!-- /wp:heading -->\n\n`
          : headingBlock(item.heading)
        if (imgs.length === 1) {
          html += linkedHeading + paraBlock(item.body) + imgBlock(imgs[0], 'large', '', linkUrl)
        } else if (imgs.length >= 2) {
          html += linkedHeading + paraBlock(item.body) + `<!-- wp:gallery {"columns":${imgs.length},"linkTo":"none"} -->\n<figure class="wp-block-gallery has-nested-images columns-${imgs.length} is-cropped">\n${imgs.map(m => `<!-- wp:image {"id":${m.wp_id},"sizeSlug":"medium"} -->\n<figure class="wp-block-image size-medium"><img src="${m.wp_url}" alt="${m.alt_text || ''}" /></figure>\n<!-- /wp:image -->`).join('\n')}\n</figure>\n<!-- /wp:gallery -->\n\n`
        } else {
          html += linkedHeading + paraBlock(item.body)
        }
      })

      if (conclusion) {
        html += itemSpacer
        html += headingBlock(conclusion.heading) + paraBlock(conclusion.body)
        if (productUrl) html += buttonBlock('Enquire Now →', productUrl)
      }
    }

    // ── Handle tags — in parallel ─────────────────────────────────────────────
    const tagIds = (await Promise.all(
      (content.tags || []).map(async tagName => {
        try {
          const searchRes = await fetch(`${wpApi}/tags?search=${encodeURIComponent(tagName)}`, {
            headers: { 'Authorization': `Basic ${credentials}` },
          })
          const existing = await searchRes.json()
          if (existing.length > 0) return existing[0].id
          const createRes = await fetch(`${wpApi}/tags`, {
            method: 'POST',
            headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: tagName }),
          })
          const newTag = await createRes.json()
          return newTag.id || null
        } catch { return null }
      })
    )).filter(Boolean)

    // ── Create draft post ─────────────────────────────────────────────────────
    const postPayload = {
      title:   content.seo_title,
      slug:    content.slug,
      content: html,
      status:  'draft',
      tags:    tagIds,
      ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
      meta: {
        ...(content.meta_description ? { _yoast_wpseo_metadesc: content.meta_description } : {}),
        ...(content.focus_keyword   ? { _yoast_wpseo_focuskw:  content.focus_keyword   } : {}),
      },
    }

    const postRes = await fetch(`${wpApi}/posts`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(postPayload),
    })

    if (!postRes.ok) {
      const err = await postRes.text()
      throw new Error(`Post creation failed: ${err}`)
    }

    const post = await postRes.json()

    return new Response(JSON.stringify({
      success: true,
      post_id: post.id,
      edit_url: `${WP_BASE_URL}/wp-admin/post.php?post=${post.id}&action=edit`,
      preview_url: post.link,
      images_uploaded: totalUploaded,
      images_total: totalImages,
    }), { headers: { 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
}

export const config = { path: '/api/publish-to-wordpress' }

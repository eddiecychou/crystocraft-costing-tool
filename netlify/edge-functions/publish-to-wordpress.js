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

  // ── Helper: resize to standard dimensions then compress to under 200KB ───────
  // Rules: square (ratio 0.85–1.18) → max 1000×1000 px
  //        landscape (wider)         → max 1200px wide, proportional height
  //        portrait  (taller)        → max 1000px wide, proportional height
  async function resizeAndCompress(arrayBuffer) {
    const MAX_BYTES = 200 * 1024
    try {
      const blob   = new Blob([arrayBuffer], { type: 'image/jpeg' })
      const bitmap = await createImageBitmap(blob)
      const { width, height } = bitmap
      const ratio = width / height

      let tw, th
      if (ratio >= 0.85 && ratio <= 1.18) {
        // Square-ish → cap longest side at 1000px, preserve ratio (no crop)
        if (width >= height) {
          tw = Math.min(width, 1000)
          th = Math.round(tw / ratio)
        } else {
          th = Math.min(height, 1000)
          tw = Math.round(th * ratio)
        }
      } else if (width >= height) {
        // Landscape banner → cap width at 1200px, proportional height
        tw = Math.min(width, 1200)
        th = Math.round(tw / ratio)
      } else {
        // Portrait → cap width at 1000px, proportional height
        tw = Math.min(width, 1000)
        th = Math.round(tw / ratio)
      }

      // Skip canvas processing if already the right size and small enough
      if (tw === width && th === height && arrayBuffer.byteLength <= MAX_BYTES) {
        bitmap.close()
        return arrayBuffer
      }

      const canvas = new OffscreenCanvas(tw, th)
      canvas.getContext('2d').drawImage(bitmap, 0, 0, tw, th)
      bitmap.close()

      // Reduce JPEG quality until under 200KB
      for (const quality of [0.85, 0.75, 0.65, 0.5, 0.35]) {
        const out = await canvas.convertToBlob({ type: 'image/jpeg', quality })
        const buf = await out.arrayBuffer()
        if (buf.byteLength <= MAX_BYTES) return buf
      }
      // Last resort
      const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.25 })
      return await out.arrayBuffer()
    } catch {
      // OffscreenCanvas not available in this runtime — upload original
      console.warn('Image resize unavailable; uploading original')
      return arrayBuffer
    }
  }

  // ── Helper: upload one image to WP Media Library ───────────────────────────
  async function uploadOne(firebase_url, alt_text = '', caption = '') {
    try {
      const imgRes = await fetch(firebase_url)
      if (!imgRes.ok) return null
      const raw       = await imgRes.arrayBuffer()
      const imgBuffer = await resizeAndCompress(raw)
      const filename  = `crystocraft-${Date.now()}.jpg`

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
  function imgBlock(media, size = 'large', extraClass = '') {
    if (!media) return ''
    const cls = ['wp-block-image', `size-${size}`, extraClass].filter(Boolean).join(' ')
    return `<!-- wp:image {"id":${media.wp_id},"sizeSlug":"${size}"} -->\n<figure class="${cls}"><img src="${media.wp_url}" alt="${media.alt_text || ''}" />${media.caption ? `<figcaption class="wp-element-caption">${media.caption}</figcaption>` : ''}</figure>\n<!-- /wp:image -->\n\n`
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

      // Upload hero + ALL section images in parallel
      const [heroMedia, ...sectionMediaArrays] = await Promise.all([
        hero?.firebase_url
          ? uploadOne(hero.firebase_url, hero.alt_text || '', '')
          : Promise.resolve(null),
        ...sections.map(section =>
          Promise.all((section.images || []).map(img =>
            uploadOne(img.firebase_url, img.alt_text, img.caption)
          ))
        ),
      ])

      if (heroMedia) { featuredMediaId = heroMedia.wp_id; totalUploaded++ }
      sectionMediaArrays.forEach(arr => arr.forEach(m => { if (m) totalUploaded++ }))

      // Hero is set as featured_media — theme displays it as banner, do NOT add to content

      sections.forEach((section, i) => {
        const imgs = (sectionMediaArrays[i] || []).filter(Boolean)
        if (imgs.length === 1) {
          html += columnsBlock(section.heading, section.body, imgs[0])
        } else if (imgs.length >= 2) {
          html += galleryBlock(section.heading, section.body, imgs)
        } else {
          html += headingBlock(section.heading) + paraBlock(section.body)
        }
      })

    // ── ROUNDUP ───────────────────────────────────────────────────────────────
    } else if (type === 'roundup') {
      const { intro, items, conclusion } = content
      totalImages = (images || []).length

      // Upload all product images in parallel
      const uploadedImages = await Promise.all(
        (images || []).map(img => uploadOne(img.firebase_url, img.alt_text, img.caption))
      )
      totalUploaded = uploadedImages.filter(Boolean).length

      if (uploadedImages[0]?.wp_id) featuredMediaId = uploadedImages[0].wp_id

      if (intro?.body) html += paraBlock(intro.body)

      items?.forEach((item, idx) => {
        const media = uploadedImages[idx]
        html += media
          ? columnsBlock(item.heading, item.body, media)
          : headingBlock(item.heading) + paraBlock(item.body)
        if (idx < items.length - 1)
          html += `<!-- wp:separator {"className":"is-style-wide"} -->\n<hr class="wp-block-separator is-style-wide"/>\n<!-- /wp:separator -->\n\n`
      })

      if (conclusion) html += headingBlock(conclusion.heading) + paraBlock(conclusion.body)
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

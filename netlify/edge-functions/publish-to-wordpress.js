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
  const { type, content, images, hero } = await req.json()

  // ── Helper: upload one image to WP Media Library ───────────────────────────
  async function uploadOne(firebase_url, alt_text = '', caption = '') {
    try {
      const imgRes = await fetch(firebase_url)
      if (!imgRes.ok) return null
      const imgBuffer = await imgRes.arrayBuffer()
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

    // ── SPOTLIGHT (new per-section format) ────────────────────────────────────
    if (type === 'spotlight') {
      const sections = content.sections || []

      // Count total images to upload
      totalImages = (hero ? 1 : 0) + sections.reduce((n, s) => n + (s.images?.length || 0), 0)

      // Upload hero
      let heroMedia = null
      if (hero?.firebase_url) {
        heroMedia = await uploadOne(hero.firebase_url, hero.alt_text || '', '')
        if (heroMedia) { featuredMediaId = heroMedia.wp_id; totalUploaded++ }
      }

      // Upload section images in parallel per section (sequential sections to preserve order)
      const sectionsWithMedia = []
      for (const section of sections) {
        const uploaded = []
        for (const img of (section.images || [])) {
          const m = await uploadOne(img.firebase_url, img.alt_text, img.caption)
          if (m) { uploaded.push(m); totalUploaded++ }
        }
        sectionsWithMedia.push({ ...section, uploadedImages: uploaded })
      }

      // Build HTML
      if (heroMedia) {
        html += imgBlock(heroMedia, 'large', 'hero-image')
      }

      for (const section of sectionsWithMedia) {
        const imgs = section.uploadedImages
        if (imgs.length === 1) {
          html += columnsBlock(section.heading, section.body, imgs[0])
        } else if (imgs.length >= 2) {
          html += galleryBlock(section.heading, section.body, imgs)
        } else {
          html += headingBlock(section.heading) + paraBlock(section.body)
        }
      }

    // ── ROUNDUP ───────────────────────────────────────────────────────────────
    } else if (type === 'roundup') {
      const { intro, items, conclusion } = content
      totalImages = (images || []).length

      // Upload all product images
      const uploadedImages = []
      for (const img of (images || [])) {
        const m = await uploadOne(img.firebase_url, img.alt_text, img.caption)
        uploadedImages.push(m)
        if (m) totalUploaded++
      }

      // Featured image = first uploaded
      if (uploadedImages[0]?.wp_id) featuredMediaId = uploadedImages[0].wp_id

      // Intro
      if (intro?.body) html += paraBlock(intro.body)

      // Each item: columns layout (text left, image right)
      items?.forEach((item, idx) => {
        const media = uploadedImages[idx]
        if (media) {
          html += columnsBlock(item.heading, item.body, media)
        } else {
          html += headingBlock(item.heading) + paraBlock(item.body)
        }
        if (idx < items.length - 1) {
          html += `<!-- wp:separator {"className":"is-style-wide"} -->\n<hr class="wp-block-separator is-style-wide"/>\n<!-- /wp:separator -->\n\n`
        }
      })

      // Conclusion
      if (conclusion) {
        html += headingBlock(conclusion.heading) + paraBlock(conclusion.body)
      }
    }

    // ── Handle tags ───────────────────────────────────────────────────────────
    const tagIds = []
    for (const tagName of (content.tags || [])) {
      try {
        const searchRes = await fetch(`${wpApi}/tags?search=${encodeURIComponent(tagName)}`, {
          headers: { 'Authorization': `Basic ${credentials}` },
        })
        const existing = await searchRes.json()
        if (existing.length > 0) {
          tagIds.push(existing[0].id)
        } else {
          const createRes = await fetch(`${wpApi}/tags`, {
            method: 'POST',
            headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: tagName }),
          })
          const newTag = await createRes.json()
          if (newTag.id) tagIds.push(newTag.id)
        }
      } catch {}
    }

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

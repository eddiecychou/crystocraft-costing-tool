export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const WP_BASE_URL    = Deno.env.get('WP_BASE_URL')
  const WP_USERNAME    = Deno.env.get('WP_USERNAME')
  const WP_APP_PASSWORD = Deno.env.get('WP_APP_PASSWORD')

  if (!WP_BASE_URL || !WP_USERNAME || !WP_APP_PASSWORD) {
    return new Response(JSON.stringify({ error: 'WordPress credentials not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  const credentials = btoa(`${WP_USERNAME}:${WP_APP_PASSWORD}`)
  const wpApi = `${WP_BASE_URL}/wp-json/wp/v2`

  const { type, content, images } = await req.json()
  // content: { title, slug, meta_description, focus_keyword, tags, sections/items/intro/conclusion }
  // images: [{ firebase_url, alt_text, caption }]

  try {
    // ── Step 1: Upload images to WordPress Media Library ──────────────────────
    const uploadedImages = []
    for (const img of (images || [])) {
      try {
        // Fetch image from Firebase via our existing proxy
        const proxyUrl = `${WP_BASE_URL.replace('https://www.crystocraft.com', '')}/api/download-image?url=${encodeURIComponent(img.firebase_url)}&filename=product-image.jpg`

        // Fetch directly from Firebase (edge function can do cross-origin)
        const imgRes = await fetch(img.firebase_url)
        if (!imgRes.ok) throw new Error(`Failed to fetch image: ${img.firebase_url}`)
        const imgBlob = await imgRes.blob()
        const imgBuffer = await imgBlob.arrayBuffer()

        // Upload to WordPress media library
        const filename = `crystocraft-${Date.now()}.jpg`
        const mediaRes = await fetch(`${wpApi}/media`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Type': 'image/jpeg',
          },
          body: imgBuffer,
        })

        if (!mediaRes.ok) {
          const err = await mediaRes.text()
          console.error('Media upload failed:', err)
          uploadedImages.push({ ...img, wp_id: null, wp_url: img.firebase_url })
          continue
        }

        const mediaData = await mediaRes.json()

        // Set alt text and caption
        await fetch(`${wpApi}/media/${mediaData.id}`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            alt_text: img.alt_text || '',
            caption: img.caption || '',
          }),
        })

        uploadedImages.push({ ...img, wp_id: mediaData.id, wp_url: mediaData.source_url })
      } catch (err) {
        console.error('Image upload error:', err)
        uploadedImages.push({ ...img, wp_id: null, wp_url: img.firebase_url })
      }
    }

    // ── Step 2: Build post HTML content ───────────────────────────────────────
    let html = ''

    if (type === 'spotlight') {
      const { sections } = content
      const imageMap = {}
      uploadedImages.forEach((img, i) => { imageMap[i] = img })

      // Hero image (first image, full width)
      if (uploadedImages[0]) {
        const hero = uploadedImages[0]
        html += `<!-- wp:image {"id":${hero.wp_id || 0},"sizeSlug":"large","className":"hero-image"} -->
<figure class="wp-block-image size-large hero-image">
  <img src="${hero.wp_url}" alt="${hero.alt_text || ''}" />
  ${hero.caption ? `<figcaption>${hero.caption}</figcaption>` : ''}
</figure>
<!-- /wp:image -->\n\n`
      }

      sections.forEach((section, idx) => {
        // Insert an image between sections (alternating left/right after index 0)
        const sectionImage = uploadedImages[idx + 1]

        if (section.heading) {
          html += `<!-- wp:heading {"level":2} -->
<h2>${section.heading}</h2>
<!-- /wp:heading -->\n\n`
        }

        html += `<!-- wp:paragraph -->
<p>${section.body.replace(/\n\n/g, '</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>')}</p>
<!-- /wp:paragraph -->\n\n`

        // Insert product image after every 2nd section
        if (sectionImage && idx % 2 === 1) {
          html += `<!-- wp:image {"id":${sectionImage.wp_id || 0},"sizeSlug":"medium","align":"${idx % 4 === 1 ? 'left' : 'right'}"} -->
<figure class="wp-block-image size-medium align${idx % 4 === 1 ? 'left' : 'right'}">
  <img src="${sectionImage.wp_url}" alt="${sectionImage.alt_text || ''}" />
  ${sectionImage.caption ? `<figcaption>${sectionImage.caption}</figcaption>` : ''}
</figure>
<!-- /wp:image -->\n\n`
        }
      })

    } else if (type === 'roundup') {
      const { intro, items, conclusion } = content

      // Intro
      if (intro?.body) {
        html += `<!-- wp:paragraph -->
<p>${intro.body.replace(/\n\n/g, '</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>')}</p>
<!-- /wp:paragraph -->\n\n`
      }

      // Each product item
      items.forEach((item, idx) => {
        const img = uploadedImages[idx]

        html += `<!-- wp:heading {"level":2} -->
<h2>${item.heading}</h2>
<!-- /wp:heading -->\n\n`

        // Alternate image left / image right
        if (img) {
          const align = idx % 2 === 0 ? 'left' : 'right'
          html += `<!-- wp:image {"id":${img.wp_id || 0},"sizeSlug":"medium","align":"${align}"} -->
<figure class="wp-block-image size-medium align${align}">
  <img src="${img.wp_url}" alt="${img.alt_text || ''}" />
  ${img.caption ? `<figcaption>${img.caption}</figcaption>` : ''}
</figure>
<!-- /wp:image -->\n\n`
        }

        html += `<!-- wp:paragraph -->
<p>${item.body.replace(/\n\n/g, '</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>')}</p>
<!-- /wp:paragraph -->\n\n`

        // Separator between items
        if (idx < items.length - 1) {
          html += `<!-- wp:separator {"className":"is-style-wide"} -->
<hr class="wp-block-separator is-style-wide"/>
<!-- /wp:separator -->\n\n`
        }
      })

      // Conclusion
      if (conclusion) {
        html += `<!-- wp:heading {"level":2} -->
<h2>${conclusion.heading}</h2>
<!-- /wp:heading -->\n\n`

        html += `<!-- wp:paragraph -->
<p>${conclusion.body.replace(/\n\n/g, '</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>')}</p>
<!-- /wp:paragraph -->\n\n`
      }
    }

    // ── Step 3: Handle tags ───────────────────────────────────────────────────
    const tagIds = []
    for (const tagName of (content.tags || [])) {
      try {
        // Try to find existing tag first
        const searchRes = await fetch(`${wpApi}/tags?search=${encodeURIComponent(tagName)}`, {
          headers: { 'Authorization': `Basic ${credentials}` },
        })
        const existing = await searchRes.json()
        if (existing.length > 0) {
          tagIds.push(existing[0].id)
        } else {
          // Create new tag
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

    // ── Step 4: Create draft post ─────────────────────────────────────────────
    const featuredImage = uploadedImages[0]

    const postPayload = {
      title: content.seo_title,
      slug: content.slug,
      content: html,
      status: 'draft',
      tags: tagIds,
      ...(featuredImage?.wp_id ? { featured_media: featuredImage.wp_id } : {}),
      meta: {
        ...(content.meta_description ? { _yoast_wpseo_metadesc: content.meta_description } : {}),
        ...(content.focus_keyword   ? { _yoast_wpseo_focuskw:  content.focus_keyword   } : {}),
      },
    }

    const postRes = await fetch(`${wpApi}/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
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
      images_uploaded: uploadedImages.filter(i => i.wp_id).length,
      images_total: images?.length || 0,
    }), {
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

export const config = { path: '/api/publish-to-wordpress' }

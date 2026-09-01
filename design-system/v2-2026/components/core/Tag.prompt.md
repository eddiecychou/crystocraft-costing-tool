Pill-shaped category tag. Used for product categories, filter chips, and collection labels. Rounder than Badge; interactive when onClick is provided.

```jsx
<Tag>Crystal Figurines</Tag>
<Tag variant="gold">Featured</Tag>
<Tag variant="sapphire">32 Facets</Tag>
<Tag variant="burgundy">Bespoke</Tag>
<Tag active>Selected</Tag>
<Tag onClick={() => setFilter('roses')}>Crystal Roses</Tag>
```

Use in horizontal scrollable rows for filter chips. Keep labels concise — 1–4 words. Combine with `active` prop to show selected state in filter groups.

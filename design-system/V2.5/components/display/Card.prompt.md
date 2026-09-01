Container card. Square corners by default (0 border-radius) — the Crystocraft signature. Subtle 1px border and soft ambient shadow. Use for product tiles, info panels, and quote blocks.

```jsx
<Card>Default white card</Card>
<Card variant="ivory">Ivory background</Card>
<Card variant="dark">Dark (ink) card</Card>
<Card padding="lg">Generous padding</Card>
<Card flat borderless>No shadow, no border</Card>
<Card hoverable onClick={() => navigate('/product')}>Clickable product tile</Card>
<Card radius="xs">Slight rounding for forms</Card>
```

Compose cards with Badge, Divider, Tag, Button:
```jsx
<Card padding="none" hoverable>
  <div style={{aspectRatio: '4/3', background: 'var(--color-ink)'}} />
  <div style={{padding: 'var(--space-5)'}}>
    <Badge variant="gifts" size="xs">New</Badge>
    <h3 style={{fontFamily: 'var(--font-serif)', marginTop: 'var(--space-2)'}}>
      Crystal Butterfly Figurine
    </h3>
    <Button variant="ghost" size="sm" style={{marginTop: 'var(--space-3)'}}>Shop Now</Button>
  </div>
</Card>
```

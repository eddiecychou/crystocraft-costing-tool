Dropdown select with the same underline/boxed styling as Input. Custom arrow icon matches the brand's geometric vocabulary.

```jsx
<Select
  label="Crystal Origin"
  placeholder="Select origin"
  options={['Bohemian Crystal', 'Chinese Crystal', 'Egyptian Crystal']}
/>
<Select
  label="Division"
  options={[
    { value: 'gifts', label: 'Crystocraft Gifts' },
    { value: 'crystals', label: 'Crystocraft Crystals' },
    { value: 'bespoke', label: 'Crystocraft Bespoke Gifting' },
  ]}
  variant="boxed"
/>
<Select label="Quantity" error="Please select a quantity" />
```

Use `variant="boxed"` in dense form layouts or on card surfaces with background. Default underline is best for clean single-page forms (e.g. enquiry forms).

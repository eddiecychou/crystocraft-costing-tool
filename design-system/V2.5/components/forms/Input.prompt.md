Text input with eyebrow-style label. Underline variant (default) gives a premium, editorial feel; boxed variant is for denser form layouts.

```jsx
<Input label="Your Name" placeholder="First and last name" />
<Input label="Email Address" type="email" required />
<Input label="Company" hint="For wholesale and trade enquiries" />
<Input label="Crystal Count" error="Please enter a valid quantity" />
<Input label="Message" disabled />
<Input label="Subject" variant="boxed" />
```

States:
- Default underline: bottom border only — clean, elegant
- Focus: border deepens to ink
- Error: border turns dark red, message shown below
- Disabled: 0.42 opacity, not-allowed cursor
- `required` adds a gold asterisk after the label

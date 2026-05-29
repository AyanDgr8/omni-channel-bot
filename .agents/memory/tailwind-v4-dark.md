---
name: Tailwind v4 dark mode
description: dark cannot be used as an @apply utility — it's a variant only
---

In Tailwind v4, `dark` is a **variant**, not a utility class. Using `@apply dark;` in CSS throws:
> Cannot apply unknown utility class `dark`

**Why:** Tailwind v4 changed the dark mode API — `dark:` is a variant prefix, not something you apply standalone.

**How to apply:** To force dark mode globally, add the `dark` class to the `<html>` element in JavaScript, or use `class="dark"` on the root element. Never put `dark` inside an `@apply` rule.

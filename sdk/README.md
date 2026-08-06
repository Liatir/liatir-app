# Liatir
[Liatir official website ↗](https://liatir.com)

This is the official JavaScript/TypeScript SDK for communicating with the native Liatir API.
It allows any web application to access native desktop features exposed by the Liatir wrapper, using a clean, typed, importable API.

If the app is running in a normal browser environment, the SDK provides a safe detection method `isLiatirAvailable()` so you can fallback.

---

## Installation

```bash
npm install liatir
```

or

```bash
yarn add liatir
```

---

## Usage

```ts
import { Liatir, isLiatirAvailable } from "liatir";

if (isLiatirAvailable()) {
  await Liatir.window.new();
} else {
  console.log("Running in browser mode — native features unavailable.");
}
```

---

## API Shape

The SDK exposes TypeScript definitions for the entire bridge via `LiatirAPI`, ensuring autocomplete and type safety.

---

## Detecting Native Environment

The SDK includes a lightweight helper:

```ts
isLiatirAvailable(): boolean
```

It **never throws**, even in SSR or when running outside Liatir.

Useful for apps that must run both:
- as a normal website
- and as a desktop app wrapped with Liatir


### When Liatir Is Not Available

If `Liatir` is missing (e.g. browser mode), trying to call native APIs directly will throw.

Make sure to guard features or provide fallbacks:

```ts
if (!isLiatirAvailable()) return;
await Liatir.window.new(...);
```

---

[Liatir official website ↗](https://liatir.com)

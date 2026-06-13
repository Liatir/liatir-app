# Desktopr
[Desktopr official website ↗](https://desktopr.app)

This is the official JavaScript/TypeScript SDK for communicating with the native Desktopr bridge.  
It allows any web application to access native desktop features exposed by the Desktopr wrapper, using a clean, typed, importable API.

If the app is running in a normal browser environment, the SDK provides a safe detection method `isDesktoprAvailable()` so you can fallback.

---

## Installation

```bash
npm install desktopr
```

or

```bash
yarn add desktopr
```

---

## Usage

```ts
import { Desktopr, isDesktoprAvailable } from "desktopr";

if (isDesktoprAvailable()) {
  await Desktopr.window.new();
} else {
  console.log("Running in browser mode — native features unavailable.");
}
```

---

## API Shape

The SDK exposes TypeScript definitions for the entire bridge via `DesktoprAPI`, ensuring autocomplete and type safety.

---

## Detecting Native Environment

The SDK includes a lightweight helper:

```ts
isDesktoprAvailable(): boolean
```

It **never throws**, even in SSR or when running outside Desktopr.

Useful for apps that must run both:
- as a normal website
- and as a desktop app wrapped with Desktopr


### When Desktopr Is Not Available

If `Desktopr` is missing (e.g. browser mode), trying to call native APIs directly will throw.

Make sure to guard features or provide fallbacks:

```ts
if (!isDesktoprAvailable()) return;
await Desktopr.window.new(...);
```

---

[Desktopr official website ↗](https://desktopr.app)

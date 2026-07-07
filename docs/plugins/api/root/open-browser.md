---
title: openBrowser
description: Opens an external URL from the Liatir API.
---

# .openBrowser

`Liatir.openBrowser(url)` opens a URL in the user's default external browser.

Use it for documentation, source pages, citations, or other links that should
leave the Liatir webview.

## Signature

```ts
openBrowser(url: string): Promise<void>
```

## Example

```ts
await Liatir.openBrowser('https://liatir.com');
```

## Notes

Only open URLs that the user intentionally requested. Do not use this method for
background network behavior.


---
title: Deep Links
description: Comprehensive guide to using Deep Links in Liatir desktop apps.
---


# Deep Links

Deep Links are a powerful feature in Liatir that allow your desktop application to be launched or controlled via custom URL schemes. They enable external sources, such as browsers or other apps, to open your desktop app and pass structured data directly into it. This is especially useful for workflows that require integration between different software or for deep navigation within your app.

## Overview

The deep linking flow in Liatir works as follows:

1. **Operating System** receives a custom URL scheme invocation (e.g., `myapp://some/path?query=123`).
2. The OS passes this URL to the Liatir native backend written in Rust.
3. The Rust backend parses the URL and converts it into a structured payload.
4. The payload is then forwarded to the JavaScript bridge.
5. JavaScript listeners inside your app can react to the deep link event and handle the data accordingly.

This seamless integration ensures that deep links are handled efficiently and securely across all supported platforms.

## Payload Structure

When a deep link is triggered, your app receives a payload with the following structures:

```js
DeepLinkPayload {
  /** The original full URL string */
  raw: string

  /** Parsed segments of the URL */
  segments: DeepLinkSegments
}

DeepLinkSegments {
  /** The scheme of the URL, e.g. "myapp" */
  scheme: string

  /** The full path part of the URL, e.g. "/some/path" */
  path: string

  /** The query parameters as key-value pairs */
  query: Record<string, string>

  /** The fragment identifier (hash) part, e.g. "section1" */
  fragment?: string // optional
}
```
### Example

**Example deeplink**: `myapp://some/path?query=123#some-fragment`

- **segments.scheme**: `myapp`;
- **segments.path**: `some/path`;
- **segments.query**: `{query: 123}`;
- **segments.fragment** `some-fragment`;

## Event Handling in JavaScript

To handle deep links in your Liatir app, use the `Liatir.events.onDeeplink()` method of the [events API area](events). This method can register a callback that receives the parsed payload whenever a deep link is triggered.

## Event Handling Example

```ts
Liatir.events.onDeeplink((payload: DeepLinkPayload) => {
  console.log("Deep link received:", payload)

  // Access the path
  const path = payload.segments.path

  // Access query parameters
  const params = payload.segments.query

  // Implement your custom logic based on the deep link
  if (path === "/open/item") {
    const itemId = params.id
    // Open the item in your app
    openItemById(itemId)
  }
})
```

## Platform Behavior

Liatir automatically registers your app’s custom URL scheme on supported platforms:

- **Windows**: Registers the URL scheme in the Windows Registry.
- **macOS**: Adds the URL scheme to the app’s `Info.plist`.
- **Linux**: Creates a `.desktop` file with the URL scheme registration.

This automatic registration means you don’t need to manually configure the OS to recognize your app’s deep links.

## Example Payload

Here is an example of a real deep link payload parsed by Liatir:

```json
{
  "raw": "myapp://open/item?id=42&ref=notification#details",
  "segments": {
    "scheme": "myapp",
    "path": "/open/item",
    "query": {
      "id": "42",
      "ref": "notification"
    },
    "fragment": "details"
  }
}
```

## Notes

:::tip
To test deep links locally during development, you can manually invoke them from your terminal or browser. For example:

```bash
open myapp://open/item?id=42
```

On Windows, you can use:

```powershell
start myapp://open/item?id=42
```

This will trigger your app’s deep link handler if it is running or launch the app otherwise.
:::

:::info
The deep link functionality is **not** exposed as a direct API on something like `Liatir.deeplink`. Instead, always use the event listener `Liatir.events.onDeeplink()` to receive and handle deep link payloads.
:::

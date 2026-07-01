---
title: Network Module
description: Documentation for the Network module of the Liatir API, providing connectivity monitoring, ping, DNS resolution, and bandwidth estimation functions.
---


# Network Module

The **Network module** provides a set of functions to monitor network connectivity, perform ping operations, resolve hostnames, and estimate bandwidth. It is designed to help applications keep track of network health and performance in real-time.

## Overview

This module is primarily used for:

- Network diagnostics and troubleshooting.
- Health-check mechanisms to verify connectivity status.
- Validating connections to specific hosts or services.
- Automatic monitoring of network conditions to trigger application behaviors.

By integrating these functions, applications can respond dynamically to network changes, improving reliability and user experience.

## API Reference

| Method                                    | Description                                                        |
|-------------------------------------------|--------------------------------------------------------------------|
| `status()`                                | Returns current connection status and last measurement results.   |
| `ping(url, timeout?)`                     | Performs a ping to a specific host or URL with optional timeout.   |
| `resolve(host)`                           | Resolves a hostname to its IP address.                             |
| `estimateBandwidth(url?, sizeHintBytes?, timeout?)` | Estimates downstream bandwidth by downloading a resource.          |
| `setMonitor(interval, targets?)`          | Starts periodic network monitoring at specified interval (ms).    |
| `stopMonitor()`                           | Stops the ongoing network monitoring process.                      |

## Network Status Event

If you start monitoring a network status with `setMonitor`, you can listen to status changes with the `onNetworkStatus` method of the [events module](./events.md):
```js
Liatir.events.onNetworkStatus((status)=>{/* ... */})
```

## Usage Example

```js
// Start monitoring network status every 10 seconds
Liatir.network.setMonitor(10000, ['https://example.com', 'https://api.example.com']);

// Listen for network status updates (use the events module for this)
Liatir.events.onNetworkStatus((status) => {
  console.log('Network status updated:', status);
});

// Later, stop monitoring if needed
// Liatir.network.stopMonitor();
```

## Notes

:::tip
Use `setMonitor` to periodically check connectivity and update your app’s offline/online status automatically. This helps keep the UI in sync with real network conditions without manual polling.
:::

:::warning
This API is not a replacement for low-level diagnostic tools and should be used as a high-level network status helper. Bandwidth estimation accuracy depends on network conditions and the underlying operating system’s capabilities.
:::

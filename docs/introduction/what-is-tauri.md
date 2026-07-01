# Tauri

Liatir Desktop app is based on [Tauri](https://tauri.app), but what is it?

## Overview

[Tauri](https://tauri.app) is a modern, open-source framework designed for building lightweight and secure cross-platform desktop applications, based on [Rust](https://rust-lang.org/). It allows developers to create desktop apps using familiar web technologies—HTML, CSS, and JavaScript—while leveraging a native backend written in Rust for performance-critical and system-level tasks.

### What is Rust?

Rust is a systems programming language focused on memory safety, concurrency, and performance. It prevents common bugs such as null pointer dereferencing, data races, and buffer overflows at compile time, reducing crashes and security vulnerabilities. Rust’s safety guarantees and efficiency make it an ideal choice for the native backend of desktop applications.

## Tauri vs Electron

- **Binary Size**: Tauri produces significantly smaller application binaries compared to Electron.
- **Resource Consumption**: Tauri apps consume much less RAM, improving performance on lower-end devices.
- **Security**: Tauri integrates native security features out of the box, enhancing application safety.
- **Auto-updates**: Built-in support for seamless auto-update mechanisms.
- **Technology Stack**: Both use web technologies for the frontend, but Tauri uses Rust for the backend, whereas Electron relies on Node.js and Chromium (less performant).

## How Liatir Uses Tauri

Liatir is built on Tauri’s foundation, utilizing Rust for all native components. This approach ensures that Liatir delivers true native performance and stability while maintaining the flexibility and rapid development speed offered by web technologies. The result is a secure, efficient, and easy-to-distribute desktop application.
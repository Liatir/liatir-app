/**
 * The runtime bundled into every Quenta presentation frame: React, the Stage kit (shadcn/ui components,
 * Liatir charts and the element renderers) and Tailwind's in-page compiler with Liatir's theme. Bundled
 * by the `liatir-presentation-runtime` plugin in vite.config.ts and run only inside the opaque sandbox
 * frame, where it draws a Stage page — a document, never code written by the model.
 */
import * as React from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import "@tailwindcss/browser"
import animations from "tw-animate-css"
import theme from "./theme.css"
import { PageView } from "./liatir/page"
import { applyAccent } from "./liatir/theme"
import type { Page } from "./spec/page"
import type { StageSource } from "./spec/tables"

const themeStyle = document.createElement("style")
themeStyle.setAttribute("type", "text/tailwindcss")
themeStyle.textContent = theme
const animationStyle = document.createElement("style")
animationStyle.textContent = animations
document.head.append(themeStyle, animationStyle)

/**
 * Draws a Stage page into the document's `#root`. Synchronous on purpose: the frame checks right after
 * this call that something was drawn, and an error while drawing must surface then. React alone would
 * only empty the page, so the error it reports during this first draw is rethrown to the caller; later
 * ones become page errors.
 */
function showPage(page: Page, sources: readonly StageSource[]) {
  const root = document.getElementById("root")
  if (!root) throw new Error("The Stage frame has no root element.")
  let drawing = true
  let failure: { error: unknown } | undefined
  applyAccent(page.accent)
  const reactRoot = createRoot(root, {
    onUncaughtError: (error) => {
      if (drawing) failure = { error }
      else reportError(error)
    },
  })
  try {
    flushSync(() => reactRoot.render(<PageView page={page} sources={sources} />))
  } finally {
    drawing = false
  }
  if (failure) throw failure.error
}

Object.assign(window, { LiatirStage: { showPage } })

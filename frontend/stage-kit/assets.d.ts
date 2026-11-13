// CSS is bundled as text and injected in the presentation frame.
declare module "*.css" {
  const text: string
  export default text
}
declare module "tw-animate-css" { const text: string; export default text }

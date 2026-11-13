declare module "virtual:liatir-presentation-runtime" {
  /** The presentation frame runtime (React + Stage kit + Tailwind), as script text. */
  const source: string;
  export default source;
  /** SHA-256 (hex) of `source`, naming the runtime a saved presentation needs. */
  export const runtimeId: string;
}

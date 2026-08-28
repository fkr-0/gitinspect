import type { ThreeElements } from "@react-three/fiber";

// Keep graph-elements self-contained under TypeScript/React JSX runtimes where
// dependency-side module augmentation is not pulled in transitively.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}

declare module "react/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}

declare module "react/jsx-dev-runtime" {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}

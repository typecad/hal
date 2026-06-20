// Ambient module declarations so `import { screen } from './x.ui.html'`
// type-checks before the lowering transformer emits the precise .d.ts.
declare module "*.ui.html" {
  export const screen: import("./src/types").ScreenTree;
}
declare module "*.ui.css";

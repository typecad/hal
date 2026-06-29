import { resolveColor } from "../ui/color.js";
import { DEFAULT_ALPHA_KEYBOARD, DEFAULT_NUMBER_KEYBOARD } from "../ui/default-keyboards.js";
import type { CSSProperty, CSSRule } from "../ui/css-parser.js";
import type { UIFontAssetModel, UIFontGlyphModel } from "../ui/font-assets.js";
import type { UIImageAsset } from "../ui/image-assets.js";
import type { KeyboardTemplate, UIKeyTemplate } from "../ui/html-parser.js";
import type { AnimationModel, KeyframeSetModel, UINodeModel, UIProgram, UITransitionModel } from "../ui/model.js";
import { layoutText } from "../ui/text-layout.js";
import { blendRgb565, HostAdafruitGFX } from "./host-gfx.js";
import type {
  PreviewBindingSpec,
  PreviewCallbackSpec,
  PreviewInitialAssignment,
  PreviewIntervalSpec,
  PreviewListBindingSpec,
  PreviewPinControlSpec,
  PreviewCanvasBindingSpec,
  PreviewSnapshot,
} from "./types.js";

const UI_TEXT_BUF = 32;
const UI_TOUCH_DEBOUNCE_MS = 50;
const UI_TOUCH_HOLD_MS = 600;
const UI_DRAG_THRESHOLD = 10;
const UI_SCROLL_EDGE_SNAP_PX = 12;
// Scroll physics (preview = capacitive + full-render tier; mirrors the C++ engine).
const UI_SCROLL_MAX_OVERSCROLL = 40;
const UI_SCROLL_STIFFNESS = 0.5;
const UI_SCROLL_SETTLE_MS = 180;
const UI_KB_REPEAT_MS = 100;
const UI_KB_TEXT_H = 24;
const UI_TRANSITION_SNAP_MS = 100;

const DEFAULT_KEY_BG = 0x4208;
const DEFAULT_KEY_FG = 0xffff;
const DEFAULT_KEY_BORDER = 0xffff;
const DEFAULT_KB_BG = 0x0000;

type MutableNode = UINodeModel;
type MutableAnimation = AnimationModel & {
  elapsed: number;
  active: boolean;
  lastUpdateMs: number;
};
type ScreenElementProxy = {
  value: number;
  text?: string;
  onClick(): void;
  onHold(): void;
  onRelease(): void;
};
type ScreenProxy = Record<string, ScreenElementProxy>;

interface PreviewKeyStyle {
  bg: number;
  fg: number;
  borderColor: number;
}

interface PreviewKey {
  ch: string;
  special: UIKeyTemplate["special"] | 255;
  style: PreviewKeyStyle;
}

interface PreviewListState extends PreviewListBindingSpec {
  itemCount: number;
  itemHeight: number;
  contentHeight: number;
  // NOTE: scroll no longer lives here — it's on the node (node.scrollY), mirroring
  // the C++ engine. This object now carries only the binding + computed geometry.
}

interface RuntimeOptions {
  onFrame?: (rgba: Uint8ClampedArray) => void;
  onDiagnostics?: (message: string) => void;
}

function clampText(text: unknown): string {
  return String(text ?? "").slice(0, UI_TEXT_BUF);
}

function lerpColor(a: number, b: number, k100: number): number {
  if (k100 >= 100) return b & 0xffff;
  const ar = (a >> 11) & 0x1f;
  const ag = (a >> 5) & 0x3f;
  const ab = a & 0x1f;
  const br = (b >> 11) & 0x1f;
  const bg = (b >> 5) & 0x3f;
  const bb = b & 0x1f;
  const r = ar + Math.trunc(((br - ar) * k100) / 100);
  const g = ag + Math.trunc(((bg - ag) * k100) / 100);
  const bl = ab + Math.trunc(((bb - ab) * k100) / 100);
  return ((r & 0x1f) << 11) | ((g & 0x3f) << 5) | (bl & 0x1f);
}

function resolveRuntimeColor(value: unknown): number {
  if (typeof value === "number") return value & 0xffff;
  if (typeof value === "string") return resolveColor(value, "rgb565") & 0xffff;
  return 0;
}

function mergeClassRules(classes: string[] | undefined, rules: CSSRule[]): CSSProperty {
  const merged: CSSProperty = {};
  const classSet = new Set(classes ?? []);
  for (const rule of rules) {
    // Only match single-compound selectors where all simples are classes in the set.
    if (rule.selector.compounds.length !== 1) continue;
    const compound = rule.selector.compounds[0];
    let ok = true;
    for (const s of compound) {
      if (s.kind !== "class" || !classSet.has(s.name)) { ok = false; break; }
    }
    if (ok) Object.assign(merged, rule.properties);
  }
  return merged;
}

function resolveKeyboardBackground(template: KeyboardTemplate, rules: CSSRule[]): number {
  const style = mergeClassRules(template.classes, rules);
  return style.background ? resolveRuntimeColor(style.background) : DEFAULT_KB_BG;
}

function resolveKeyStyle(key: UIKeyTemplate, template: KeyboardTemplate, rules: CSSRule[]): PreviewKeyStyle {
  const style = mergeClassRules([...(template.classes ?? []), ...(key.classes ?? [])], rules);
  return {
    bg: style.background ? resolveRuntimeColor(style.background) : DEFAULT_KEY_BG,
    fg: style.color ? resolveRuntimeColor(style.color) : DEFAULT_KEY_FG,
    borderColor: style.borderColor ? resolveRuntimeColor(style.borderColor) : DEFAULT_KEY_BORDER,
  };
}

const KF_BG = 1;
const KF_FG = 2;
const KF_OPACITY = 4;
const KF_TRANSFORM = 8;
const KF_SIZE = 16;

function cloneProgram(program: UIProgram): { nodes: MutableNode[]; transitions: UITransitionModel[]; animations: MutableAnimation[] } {
  return {
    nodes: program.nodes.map((node) => ({
      ...node,
      box: { ...node.box },
      classes: [...node.classes],
      options: node.options?.map((option) => ({ ...option })),
      screenId: node.screenId ?? 0,
      dirty: false,
      textBuffer: "",
      hasTextBinding: false,
      lastTextWidth: node.kind === "progress" || node.kind === "range" ? -1 : 0,
      lastTextHeight: 0,
      overscrollPx: 0,
      settling: false,
      lastPaintedScrollY: 0,
      lineHeight: node.lineHeight || 0,
      whiteSpaceMode: node.whiteSpaceMode ?? (node.nowrap ? 1 : 0),
      zIndex: node.zIndex ?? 0,
      value: node.value,
    })),
    transitions: (program.transitions ?? []).map((transition) => ({ ...transition, active: false, elapsed: 0 })),
    animations: (program.animations ?? []).map((animation) => ({
      ...animation,
      elapsed: 0,
      active: true,
      lastUpdateMs: 0,
    })),
  };
}

export class PreviewUIRuntime {
  readonly gfx: HostAdafruitGFX;
  readonly screen: ScreenProxy = {};
  private readonly nodes: MutableNode[];
  private readonly transitions: UITransitionModel[];
  private readonly keyframeSets: KeyframeSetModel[];
  private readonly animations: MutableAnimation[];
  private readonly fontAssets: UIFontAssetModel[];
  private readonly imageAssets: UIImageAsset[];
  private readonly bindings: PreviewBindingSpec[];
  private readonly listStates: PreviewListState[];
  private readonly callbacks: PreviewCallbackSpec[];
  private readonly pinControls: PreviewPinControlSpec[];
  private readonly canvasBindings: PreviewCanvasBindingSpec[];
  private readonly intervals: PreviewIntervalSpec[];
  private readonly initialAssignments: PreviewInitialAssignment[];
  /** Module-scoped `let`/`const`/`var` bindings, seeded once and shared (mutably)
   * across every callback body — mirrors the device hoisting them to globals. */
  private readonly moduleScope: Record<string, unknown> = {};
  private readonly onFrame?: (rgba: Uint8ClampedArray) => void;
  private readonly onDiagnostics?: (message: string) => void;
  private readonly screenCount: number;
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private activeScreen = 0;
  private touchState = 0;
  private touchNode = -1;
  // Awaitable tap source (mirrors the device __ui_tap_seq / __ui_tap_node).
  // Incremented on every completed tap (after click/release dispatch) so an
  // `await ui.onTap()` Promise can resolve by polling tapSeq. tapNode records
  // the hit node (-1 = empty space) for per-element awaiters. Public so the
  // onTap shim in build-program.ts can read them.
  tapSeq = 0;
  tapNode = -1;
  private touchDownTime = 0;
  private lastTouchTime = -UI_TOUCH_DEBOUNCE_MS;
  private lastReleaseTime = -UI_TOUCH_DEBOUNCE_MS;
  private lastTickTime = Date.now();
  private dragStartX = 0;
  private dragStartY = 0;
  private lastTouchX = 0;
  private lastTouchY = 0;
  private isDragging = false;
  // Unified scroll gesture: one owner per gesture (single hit-scan; lists are
  // scrollable and found by the same scan). Settle-animation state lives here.
  private scrollNode = -1;
  private settleStartMs = 0;
  private settleFromOverscroll = 0;  // settle start value (bounce-back; +top/-bottom)
  private settleFromScrollY = 0;     // settle start value (edge snap; +toward 0, -toward max)
  private rangeNode = -1;
  private keyboardVisible = false;
  private keyboardDirty: 0 | 1 | 2 = 0;
  private keyboardTarget = -1;
  private keyboardKeys: PreviewKey[] = [];
  private keyboardRows = 0;
  private keyboardCols = 0;
  private keyboardBg = DEFAULT_KB_BG;
  private keyboardBox = { x: 0, y: 0, w: 0, h: 0 };
  private keyboardBuffer = "";
  private keyboardMaxLen = UI_TEXT_BUF;
  private keyboardShift = false;
  private keyboardBackspaceHeld = false;
  private keyboardBackspaceRepeat = 0;
  private keyboardPressedKey = -1;
  private keyboardRepaintKey = -1;

  constructor(private readonly snapshot: PreviewSnapshot, options: RuntimeOptions = {}) {
    const { nodes, transitions, animations } = cloneProgram(snapshot.program);
    this.nodes = nodes;
    this.transitions = transitions;
    this.keyframeSets = snapshot.program.keyframeSets ?? [];
    this.animations = animations;
    this.fontAssets = snapshot.program.fontAssets ?? [];
    this.imageAssets = snapshot.program.imageAssets ?? [];
    this.bindings = snapshot.bindings;
    this.listStates = (snapshot.listBindings ?? []).map((binding) => ({
      ...binding,
      itemCount: 0,
      itemHeight: 24,
      contentHeight: 0,
    }));
    this.callbacks = snapshot.callbacks;
    this.pinControls = snapshot.pinControls;
    this.canvasBindings = snapshot.canvasBindings ?? [];
    this.intervals = snapshot.intervals;
    this.initialAssignments = snapshot.initialAssignments;
    this.screenCount = Math.max(1, ...this.nodes.map((node) => (node.screenId ?? 0) + 1));
    this.onFrame = options.onFrame;
    this.onDiagnostics = options.onDiagnostics;
    this.gfx = new HostAdafruitGFX(snapshot.program.width, snapshot.program.height, new Uint8Array(snapshot.font));
    this.createScreenProxy();
  }

  start(): void {
    this.gfx.begin();
    this.gfx.setRotation(this.snapshot.program.display?.rotation ?? 1);
    this.gfx.fillScreen(0x0000);
    this.seedModuleScope();
    this.applyInitialAssignments();
    this.uiInit();
    this.tick(16);
    for (const interval of this.intervals) {
      this.timers.push(setInterval(() => {
        this.runBody(interval.body);
        this.tick();
      }, interval.delayMs));
    }
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
  }

  tick(deltaMs?: number): void {
    const now = Date.now();
    const delta = deltaMs ?? Math.max(0, now - this.lastTickTime);
    this.lastTickTime = now;
    this.evaluateBindings();
    this.advanceTransitions(delta);
    this.advanceAnimations(delta);
    // Advance any in-flight scroll settle animation (bounce-back / edge-snap).
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.nodes[i].settling) this.advanceScrollSettle(i);
    }
    if (this.drawDirty()) {
      this.onFrame?.(this.gfx.toRgbaBytes());
    }
  }

  pointerDown(x: number, y: number): void {
    this.handleTouch(x, y);
    this.tick();
  }

  pointerMove(x: number, y: number): void {
    if (this.touchState !== 0) {
      this.handleTouch(x, y);
      this.tick();
    }
  }

  pointerUp(): void {
    this.handleNoTouch();
    this.tick();
  }

  triggerPin(control: PreviewPinControlSpec): void {
    if (control.kind === "toggle" && control.nodeIndex !== undefined) {
      const node = this.nodes[control.nodeIndex];
      node.value = node.value ? 0 : 1;
      this.markDirty(control.nodeIndex);
      this.runBody(control.body);
    } else if (control.kind === "change" && control.nodeIndex !== undefined) {
      const node = this.nodes[control.nodeIndex];
      const count = Math.max(1, control.optionCount ?? 2);
      node.value = (node.value + 1) % count;
      this.markDirty(control.nodeIndex);
      this.runBody(control.body);
    } else if (control.kind === "press" && control.nodeIndex !== undefined) {
      this.uiOnPress(control.nodeIndex);
    } else if (control.kind === "release" && control.nodeIndex !== undefined) {
      this.uiOnRelease(control.nodeIndex);
    } else if (control.kind === "watch") {
      this.runBody(control.body);
    }
    this.tick();
  }

  private createScreenProxy(): void {
    for (const node of this.nodes) {
      if (!node.id) continue;
      const proxy: ScreenElementProxy = {
        get value() {
          return node.value;
        },
        set value(v: number) {
          node.value = Number(v) || 0;
          node.dirty = true;
        },
        onClick: () => undefined,
        onHold: () => undefined,
        onRelease: () => undefined,
      };
      if (node.kind === "input") {
        Object.defineProperty(proxy, "text", {
          enumerable: true,
          get() {
            return node.textBuffer;
          },
          set(v: string) {
            node.textBuffer = clampText(v);
            node.dirty = true;
          },
        });
      }
      Object.defineProperty(this.screen, node.id, {
        enumerable: true,
        value: proxy,
      });
    }
  }

  private applyInitialAssignments(): void {
    for (const assignment of this.initialAssignments) {
      const value = this.evaluateExpression(assignment.expression);
      this.nodes[assignment.nodeIndex].value = Number(value) || 0;
      this.markDirty(assignment.nodeIndex);
    }
  }

  /** Seed module-scoped variables from their initializers, evaluated once. These
   * live for the lifetime of the runtime and are shared mutably with callback
   * bodies via runBody/evaluateExpression (see moduleVarNames()). */
  private seedModuleScope(): void {
    for (const v of this.snapshot.moduleVars ?? []) {
      if (!/^[$A-Z_a-z][$\w]*$/.test(v.name)) continue;
      this.moduleScope[v.name] = v.initializer !== undefined
        ? this.evaluateExpression(v.initializer)
        : undefined;
    }
  }

  private moduleVarNames(): string[] {
    return (this.snapshot.moduleVars ?? [])
      .map((v) => v.name)
      .filter((name) => /^[$A-Z_a-z][$\w]*$/.test(name));
  }

  private uiInit(): void {
    for (const node of this.nodes) node.dirty = true;
    for (const binding of this.bindings) {
      if (binding.property !== "text") continue;
      const node = this.nodes[binding.nodeIndex];
      node.hasTextBinding = true;
      node.textBuffer = clampText(node.text ?? "");
    }
    for (const node of this.nodes) {
      if (node.tag === "select" && node.options && node.options.length > 0) {
        node.hasTextBinding = true;
        node.textBuffer = clampText(node.options[0]?.text ?? node.text ?? "");
      }
    }
    for (const list of this.listStates) {
      this.refreshListState(list);
    }
  }

  private isActiveNode(node: MutableNode): boolean {
    return (node.screenId ?? 0) === this.activeScreen;
  }

  private isEffectivelyVisible(node: MutableNode): boolean {
    if (!node.visible) return false;
    let parent = node.parentIndex;
    while (parent >= 0 && this.nodes[parent]) {
      if (!this.nodes[parent].visible) return false;
      parent = this.nodes[parent].parentIndex;
    }
    return true;
  }

  private drawsBefore(a: MutableNode, b: MutableNode): boolean {
    const az = Math.trunc(a.zIndex ?? 0);
    const bz = Math.trunc(b.zIndex ?? 0);
    if (az !== bz) return az < bz;
    return a.index < b.index;
  }

  private compareDrawOrder(a: MutableNode, b: MutableNode): number {
    const az = Math.trunc(a.zIndex ?? 0);
    const bz = Math.trunc(b.zIndex ?? 0);
    if (az !== bz) return az - bz;
    return a.index - b.index;
  }

  private navigate(screenIdx: number): void {
    const next = Math.trunc(Number(screenIdx));
    if (!Number.isFinite(next) || next < 0 || next >= this.screenCount || next === this.activeScreen) return;
    this.activeScreen = next;
    if (this.keyboardVisible) {
      this.keyboardVisible = false;
      this.keyboardDirty = 0;
      this.keyboardTarget = -1;
      this.keyboardPressedKey = -1;
      this.keyboardBackspaceHeld = false;
    }
    this.gfx.fillScreen(0x0000);
    for (const node of this.nodes) {
      node.dirty = true;
      if (node.kind === "progress" || node.kind === "range") node.lastTextWidth = -1;
      else node.lastTextWidth = 0;
      node.lastTextHeight = 0;
    }
  }

  private evaluateBindings(): void {
    for (const binding of this.bindings) {
      const node = this.nodes[binding.nodeIndex];
      const value = this.evaluateExpression(binding.expression);
      if (binding.property === "text") {
        const text = clampText(value);
        if (text !== node.textBuffer) {
          node.textBuffer = text;
          this.markDirty(binding.nodeIndex);
        }
      } else if (binding.property === "background") {
        const next = resolveRuntimeColor(value);
        if (next !== node.bg) {
          node.bg = next;
          node.hasBg = true;
          this.markDirty(binding.nodeIndex);
        }
      } else if (binding.property === "color") {
        const next = resolveRuntimeColor(value);
        if (next !== node.fg) {
          node.fg = next;
          this.markDirty(binding.nodeIndex);
        }
      } else if (binding.property === "borderColor") {
        const next = resolveRuntimeColor(value);
        if (next !== node.borderColor) {
          node.borderColor = next;
          this.markDirty(binding.nodeIndex);
        }
      } else if (binding.property === "visible") {
        const next = Boolean(value);
        if (next !== node.visible) {
          this.setVisible(binding.nodeIndex, next);
        }
      } else if (binding.property === "value") {
        const next = Math.trunc(Number(value) || 0);
        if (next !== node.value) {
          node.value = next;
          this.markDirty(binding.nodeIndex);
        }
      }
    }

    for (const node of this.nodes) {
      if (node.tag !== "select" || !node.options || node.options.length === 0) continue;
      const next = clampText(node.options[node.value]?.text ?? node.options[0]?.text ?? "");
      if (next !== node.textBuffer) {
        node.textBuffer = next;
        this.markDirty(node.index);
      }
    }
    for (const list of this.listStates) {
      this.refreshListState(list);
    }
  }

  private refreshListState(list: PreviewListState): void {
    const node = this.nodes[list.nodeIndex];
    if (!node) return;
    const countValue = this.evaluateExpression(list.countExpression);
    const itemCount = Math.max(0, Math.trunc(Number(countValue) || 0));
    const itemHeight = Math.max(1, Math.trunc(node.listItemHeight || list.itemHeight || 24));
    const contentHeight = itemCount * itemHeight;
    const maxScroll = Math.max(0, contentHeight - node.box.h);
    // Scroll lives on the node now; keep it clamped as the content size changes.
    const nextScrollY = Math.max(0, Math.min(maxScroll, node.scrollY));
    const changed = itemCount !== list.itemCount ||
      itemHeight !== list.itemHeight ||
      contentHeight !== list.contentHeight ||
      nextScrollY !== node.scrollY ||
      node.contentHeight !== contentHeight;
    list.itemCount = itemCount;
    list.itemHeight = itemHeight;
    list.contentHeight = contentHeight;
    node.scrollY = nextScrollY;
    node.contentHeight = contentHeight;
    if (changed) this.markDirty(list.nodeIndex);
  }

  private advanceTransitions(deltaMs: number): void {
    for (const transition of this.transitions) {
      if (!transition.active) continue;
      transition.elapsed += deltaMs;
      const k = transition.durationMs <= 0
        ? 100
        : Math.trunc((transition.elapsed * 100) / transition.durationMs);
      const drawK = transition.durationMs > 0 && transition.durationMs <= UI_TRANSITION_SNAP_MS ? 100 : k;
      const value = lerpColor(transition.prevValue, transition.targetValue, drawK);
      if (transition.prop === "color") this.nodes[transition.node].fg = value;
      else this.nodes[transition.node].bg = value;
      this.markDirty(transition.node);
      if (drawK >= 100) transition.active = false;
    }
  }

  private advanceAnimations(deltaMs: number): void {
    for (const animation of this.animations) {
      if (!animation.active) continue;
      // Mirrors the C++ engine (runtime-header.ts ~line 2842): only advance
      // animations whose node is on the active screen. Otherwise advancing a
      // cross-screen node mutates its geometry and clearCurrentNodePaint/markDirty
      // repaint its parent's background into the *active* screen's framebuffer
      // (e.g. the transform-screen dots bleeding onto home).
      const animNode = this.nodes[animation.node];
      if (animNode && !this.isActiveNode(animNode)) continue;
      animation.elapsed += deltaMs;
      let elapsedNoDelay = animation.elapsed;
      if (elapsedNoDelay < animation.delayMs) continue;
      elapsedNoDelay -= animation.delayMs;

      let completing = false;
      if (animation.iterations > 0 && elapsedNoDelay >= animation.iterations * animation.durationMs) {
        elapsedNoDelay = animation.iterations * animation.durationMs;
        completing = true;
      }

      let pct = 100;
      if (!completing && animation.durationMs > 0) {
        pct = Math.trunc(((elapsedNoDelay % animation.durationMs) * 100) / animation.durationMs);
      }

      const set = this.keyframeSets[animation.keyframeSet];
      const node = this.nodes[animation.node];
      if (!set || !node || set.stops.length === 0) continue;

      let lo = 0;
      let hi = set.stops.length - 1;
      for (let i = 0; i < set.stops.length; i++) {
        if (set.stops[i].percent <= pct) lo = i;
        if (set.stops[i].percent >= pct) {
          hi = i;
          break;
        }
      }

      const from = set.stops[lo];
      const to = set.stops[hi];
      const range = to.percent - from.percent;
      const k = range > 0 ? Math.trunc(((pct - from.percent) * 100) / range) : 0;
      let changed = false;

      if ((from.props & KF_BG) && (to.props & KF_BG)) {
        const next = range > 0 ? lerpColor(from.bg, to.bg, k) : from.bg;
        if (next !== node.bg) {
          node.bg = next;
          node.hasBg = true;
          changed = true;
        }
      }
      if ((from.props & KF_FG) && (to.props & KF_FG)) {
        const next = range > 0 ? lerpColor(from.fg, to.fg, k) : from.fg;
        if (next !== node.fg) {
          node.fg = next;
          changed = true;
        }
      }
      if ((from.props & KF_OPACITY) && (to.props & KF_OPACITY)) {
        const next = range > 0 ? Math.trunc(from.opacity + ((to.opacity - from.opacity) * k) / 100) : from.opacity;
        if (next !== node.opacity) {
          node.opacity = next;
          changed = true;
        }
      }
      let nextTransformX = node.transformOffsetX ?? 0;
      let nextTransformY = node.transformOffsetY ?? 0;
      let nextRotateDeg = node.rotateDeg ?? 0;
      let nextWidth = node.box.w;
      let nextHeight = node.box.h;
      let geometryChanged = false;
      const hasSizeFrame = (from.props & KF_SIZE) && (to.props & KF_SIZE);
      if (hasSizeFrame) {
        nextWidth = range > 0 ? Math.trunc(from.width + ((to.width - from.width) * k) / 100) : from.width;
        nextHeight = range > 0 ? Math.trunc(from.height + ((to.height - from.height) * k) / 100) : from.height;
        nextWidth = Math.max(0, nextWidth);
        nextHeight = Math.max(0, nextHeight);
        if (nextWidth !== node.box.w || nextHeight !== node.box.h) {
          changed = true;
          geometryChanged = true;
        }
      }
      if ((from.props & KF_TRANSFORM) && (to.props & KF_TRANSFORM)) {
        const pxX = range > 0 ? Math.trunc(from.transformOffsetX + ((to.transformOffsetX - from.transformOffsetX) * k) / 100) : from.transformOffsetX;
        const pxY = range > 0 ? Math.trunc(from.transformOffsetY + ((to.transformOffsetY - from.transformOffsetY) * k) / 100) : from.transformOffsetY;
        const pctX = range > 0 ? Math.trunc(from.translatePctX + ((to.translatePctX - from.translatePctX) * k) / 100) : from.translatePctX;
        const pctY = range > 0 ? Math.trunc(from.translatePctY + ((to.translatePctY - from.translatePctY) * k) / 100) : from.translatePctY;
        const scaleX = Math.max(0, range > 0 ? Math.trunc(from.scaleX + ((to.scaleX - from.scaleX) * k) / 100) : from.scaleX);
        const scaleY = Math.max(0, range > 0 ? Math.trunc(from.scaleY + ((to.scaleY - from.scaleY) * k) / 100) : from.scaleY);
        nextRotateDeg = range > 0 ? Math.trunc(from.rotateDeg + ((to.rotateDeg - from.rotateDeg) * k) / 100) : from.rotateDeg;
        let refW = hasSizeFrame ? nextWidth : animation.baseWidth;
        let refH = hasSizeFrame ? nextHeight : animation.baseHeight;
        if (refW <= 0) refW = node.box.w;
        if (refH <= 0) refH = node.box.h;
        const originPxX = Math.trunc((refW * animation.originX) / 100);
        const originPxY = Math.trunc((refH * animation.originY) / 100);
        const scaledW = Math.trunc((refW * scaleX) / 100);
        const scaledH = Math.trunc((refH * scaleY) / 100);
        const scaleOffsetX = originPxX - Math.trunc((originPxX * scaleX) / 100);
        const scaleOffsetY = originPxY - Math.trunc((originPxY * scaleY) / 100);
        nextTransformX = pxX + Math.trunc((refW * pctX) / 100) + scaleOffsetX;
        nextTransformY = pxY + Math.trunc((refH * pctY) / 100) + scaleOffsetY;
        nextWidth = Math.max(0, scaledW);
        nextHeight = Math.max(0, scaledH);
        if (
          nextTransformX !== (node.transformOffsetX ?? 0) ||
          nextTransformY !== (node.transformOffsetY ?? 0) ||
          nextRotateDeg !== (node.rotateDeg ?? 0) ||
          nextWidth !== node.box.w ||
          nextHeight !== node.box.h
        ) {
          changed = true;
          geometryChanged = true;
        }
      }

      if (changed && (completing || animation.elapsed - animation.lastUpdateMs >= 100)) {
        if (geometryChanged) {
          this.clearCurrentNodePaint(node);
          node.transformOffsetX = nextTransformX;
          node.transformOffsetY = nextTransformY;
          node.rotateDeg = nextRotateDeg;
          node.box.w = nextWidth;
          node.box.h = nextHeight;
        }
        this.markDirty(animation.node);
        animation.lastUpdateMs = animation.elapsed;
      }
      if (completing) animation.active = false;
    }
  }

  private drawYForNode(nodeIndex: number): number {
    return this.baseDrawYForNode(nodeIndex) + this.pressedOffsetYForNode(nodeIndex);
  }

  private baseDrawXForNode(nodeIndex: number): number {
    const node = this.nodes[nodeIndex];
    return node.box.x + (node.transformOffsetX ?? 0);
  }

  private baseDrawYForNode(nodeIndex: number): number {
    let y = this.nodes[nodeIndex].box.y + (this.nodes[nodeIndex].transformOffsetY ?? 0);
    let parent = this.nodes[nodeIndex].parentIndex;
    while (parent >= 0 && this.nodes[parent]) {
      if (this.nodes[parent].scrollable) {
        y -= this.nodes[parent].scrollY;
        // Rubber-band: overscrollPx (+top/-bottom) visibly offsets content past
        // the boundary during drag/settle. Applies to generic containers; lists
        // virtualize and manage their own offset in drawListNode.
        if (!this.nodes[parent].virtualized) y += this.nodes[parent].overscrollPx;
      }
      parent = this.nodes[parent].parentIndex;
    }
    return y;
  }

  private pressedOffsetXForNode(nodeIndex: number): number {
    const node = this.nodes[nodeIndex];
    return node.value > 0 ? (node.pressedOffsetX ?? 0) : 0;
  }

  private pressedOffsetYForNode(nodeIndex: number): number {
    const node = this.nodes[nodeIndex];
    return node.value > 0 ? (node.pressedOffsetY ?? 0) : 0;
  }

  private drawXForNode(nodeIndex: number): number {
    return this.baseDrawXForNode(nodeIndex) + this.pressedOffsetXForNode(nodeIndex);
  }

  private parentClearColor(node: MutableNode): number {
    const parent = node.parentIndex >= 0 ? this.nodes[node.parentIndex] : undefined;
    if (parent) return parent.hasBg ? parent.bg : parent.clearColor;
    return node.clearColor;
  }

  private clearPressOffsetArea(node: MutableNode, baseX: number, baseY: number): void {
    const ox = node.pressedOffsetX ?? 0;
    const oy = node.pressedOffsetY ?? 0;
    if (ox === 0 && oy === 0) return;

    const x0 = Math.min(baseX, baseX + ox);
    const y0 = Math.min(baseY, baseY + oy);
    const x1 = Math.max(baseX + node.box.w, baseX + ox + node.box.w);
    const y1 = Math.max(baseY + node.box.h, baseY + oy + node.box.h);
    if (this.repairCurrentNodePaintWithParent(node, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 })) return;
    this.gfx.fillRect(x0, y0, x1 - x0, y1 - y0, this.parentClearColor(node));
  }

  private shadowExtents(node: MutableNode): { left: number; top: number; right: number; bottom: number } {
    let left = 0;
    let top = 0;
    let right = 0;
    let bottom = 0;
    const count = Math.min(node.shadowCount ?? 0, 4);
    for (let i = 0; i < count; i++) {
      if (node.shadowInset?.[i]) continue;
      const blur = node.shadowBlur?.[i] || 1;
      const ox = node.shadowOffsetX?.[i] ?? 0;
      const oy = node.shadowOffsetY?.[i] ?? 0;
      left = Math.max(left, blur - ox);
      top = Math.max(top, blur - oy);
      right = Math.max(right, blur + ox);
      bottom = Math.max(bottom, blur + oy);
    }
    return { left, top, right, bottom };
  }

  private rotationQuadrant(deg: number | undefined): 0 | 1 | 2 | 3 {
    let normalized = Math.trunc(deg ?? 0) % 360;
    if (normalized < 0) normalized += 360;
    if (normalized === 90) return 1;
    if (normalized === 180) return 2;
    if (normalized === 270) return 3;
    return 0;
  }

  private canUseQuarterTurnBounds(node: MutableNode): boolean {
    return node.kind === "img" || (node.kind === "fill" && node.gradientEnabled === 0);
  }

  private rotatedFaceSize(node: MutableNode, w: number, h: number): { w: number; h: number } {
    if (!this.canUseQuarterTurnBounds(node)) return { w, h };
    const q = this.rotationQuadrant(node.rotateDeg);
    return q === 1 || q === 3 ? { w: h, h: w } : { w, h };
  }

  private drawImageWithFit(asset: UIImageAsset, x: number, y: number, rotateDeg: number | undefined, fitMode: number | undefined, targetW: number, targetH: number): void {
    const srcW = Math.trunc(asset.width);
    const srcH = Math.trunc(asset.height);
    targetW = Math.trunc(targetW);
    targetH = Math.trunc(targetH);
    if (srcW <= 0 || srcH <= 0 || targetW <= 0 || targetH <= 0) return;

    let drawW = srcW;
    let drawH = srcH;
    let offX = Math.trunc((targetW - drawW) / 2);
    let offY = Math.trunc((targetH - drawH) / 2);
    const mode = fitMode ?? 1;

    if (mode === 1) {
      drawW = targetW;
      drawH = targetH;
      offX = 0;
      offY = 0;
    } else if (mode === 2 || mode === 3 || mode === 4) {
      const scaleX = Math.max(1, Math.trunc((targetW * 1000) / srcW));
      const scaleY = Math.max(1, Math.trunc((targetH * 1000) / srcH));
      let scale = scaleX;
      if (mode === 2) {
        if (scaleY < scaleX) scale = scaleY;
      } else if (mode === 3) {
        if (scaleY > scaleX) scale = scaleY;
      } else {
        if (scaleY < scaleX) scale = scaleY;
        if (scale > 1000) scale = 1000;
      }
      drawW = Math.max(1, Math.trunc((srcW * scale) / 1000));
      drawH = Math.max(1, Math.trunc((srcH * scale) / 1000));
      if (mode === 3) {
        if (drawW < targetW) drawW = targetW;
        if (drawH < targetH) drawH = targetH;
      }
      offX = Math.trunc((targetW - drawW) / 2);
      offY = Math.trunc((targetH - drawH) / 2);
    }

    const q = this.rotationQuadrant(rotateDeg);
    for (let ty = 0; ty < targetH; ty++) {
      const localY = ty - offY;
      if (localY < 0 || localY >= drawH) continue;
      const srcY = Math.max(0, Math.min(srcH - 1, Math.trunc((localY * srcH) / drawH)));
      for (let tx = 0; tx < targetW; tx++) {
        const localX = tx - offX;
        if (localX < 0 || localX >= drawW) continue;
        const srcX = Math.max(0, Math.min(srcW - 1, Math.trunc((localX * srcW) / drawW)));
        const color = asset.data[srcY * srcW + srcX] ?? 0;
        let dx = tx;
        let dy = ty;
        if (q === 1) {
          dx = targetH - 1 - ty;
          dy = tx;
        } else if (q === 2) {
          dx = targetW - 1 - tx;
          dy = targetH - 1 - ty;
        } else if (q === 3) {
          dx = ty;
          dy = targetW - 1 - tx;
        }
        this.gfx.drawPixel(x + dx, y + dy, color);
      }
    }
  }

  private drawImageNode(node: MutableNode, drawY: number): void {
    const faceSize = this.rotatedFaceSize(node, node.box.w, node.box.h);
    if (node.hasBg) this.gfx.fillRect(node.box.x, drawY, faceSize.w, faceSize.h, node.bg);
    const assetId = node.imgDataId ?? 255;
    if (assetId >= this.imageAssets.length) return;
    this.drawImageWithFit(
      this.imageAssets[assetId],
      node.box.x,
      drawY,
      node.rotateDeg,
      node.objectFit,
      node.box.w,
      node.box.h,
    );
  }

  private nodePaintRect(node: MutableNode, baseX: number, baseY: number, drawX: number, drawY: number, textW: number, textH: number): { x: number; y: number; w: number; h: number } {
    const shadow = this.shadowExtents(node);
    let faceW = node.box.w;
    let faceH = node.box.h;
    if (node.kind === "text" || node.kind === "check" || node.kind === "radio") {
      if (node.lastTextWidth > faceW) faceW = node.lastTextWidth;
      if ((node.lastTextHeight ?? 0) > faceH) faceH = node.lastTextHeight;
      if (textW > faceW) faceW = textW;
      if (textH > faceH) faceH = textH;
    }
    ({ w: faceW, h: faceH } = this.rotatedFaceSize(node, faceW, faceH));

    let x0 = Math.min(baseX - shadow.left, drawX);
    let y0 = Math.min(baseY - shadow.top, drawY);
    let x1 = Math.max(baseX + faceW + shadow.right, drawX + faceW);
    let y1 = Math.max(baseY + faceH + shadow.bottom, drawY + faceH);
    if (node.outlineStyle && node.outlineWidth > 0) {
      const o = node.outlineWidth;
      x0 = Math.min(x0, drawX - o);
      y0 = Math.min(y0, drawY - o);
      x1 = Math.max(x1, drawX + faceW + o);
      y1 = Math.max(y1, drawY + faceH + o);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  private currentPaintRect(node: MutableNode): { x: number; y: number; w: number; h: number } {
    const displayText = node.hasTextBinding ? node.textBuffer : node.text;
    const ts = this.nodeTextSize(node);
    let textMaxW = node.box.w;
    if (node.kind === "check" || node.kind === "radio") {
      textMaxW = node.box.w > 22 ? node.box.w - 22 : 0;
    }
    const metrics = this.textLayout(node, displayText, textMaxW, ts);
    let paintTextW = metrics.width;
    let paintTextH = metrics.height;
    if (node.kind === "check" || node.kind === "radio") {
      paintTextW += 22;
      if (paintTextH < 16) paintTextH = 16;
    }
    return this.nodePaintRect(
      node,
      this.baseDrawXForNode(node.index),
      this.baseDrawYForNode(node.index),
      this.drawXForNode(node.index),
      this.drawYForNode(node.index),
      paintTextW,
      paintTextH,
    );
  }

  private currentSubtreePaintRect(node: MutableNode): { x: number; y: number; w: number; h: number } | undefined {
    let rect: { x: number; y: number; w: number; h: number } | undefined;
    for (let i = node.index; i < Math.min(node.subtreeEnd, this.nodes.length); i++) {
      const child = this.nodes[i];
      if (!child || !this.isActiveNode(child) || !this.isEffectivelyVisible(child)) continue;
      const childRect = this.currentPaintRect(child);
      if (childRect.w <= 0 || childRect.h <= 0) continue;
      if (!rect) {
        rect = { ...childRect };
      } else {
        const x0 = Math.min(rect.x, childRect.x);
        const y0 = Math.min(rect.y, childRect.y);
        const x1 = Math.max(rect.x + rect.w, childRect.x + childRect.w);
        const y1 = Math.max(rect.y + rect.h, childRect.y + childRect.h);
        rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
    }
    return rect;
  }

  private rectsIntersect(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
    return a.x + a.w > b.x && a.x < b.x + b.w && a.y + a.h > b.y && a.y < b.y + b.h;
  }

  private markOverlappingHigherLayersDirty(nodeIndex: number): void {
    const node = this.nodes[nodeIndex];
    if (!node || !this.isEffectivelyVisible(node) || !this.isActiveNode(node)) return;
    const rect = this.currentPaintRect(node);
    this.markOverlappingHigherLayersDirtyForRect(nodeIndex, rect);
  }

  private markOverlappingHigherLayersDirtyForRect(nodeIndex: number, rect: { x: number; y: number; w: number; h: number }): void {
    const node = this.nodes[nodeIndex];
    if (!node || !this.isEffectivelyVisible(node) || !this.isActiveNode(node)) return;
    if (rect.w <= 0 || rect.h <= 0) return;
    for (const candidate of this.nodes) {
      if (candidate.index === nodeIndex) continue;
      if (candidate.dirty || !this.isEffectivelyVisible(candidate) || !this.isActiveNode(candidate)) continue;
      if (!this.drawsBefore(node, candidate)) continue;
      const candidateRect = this.currentPaintRect(candidate);
      if (candidateRect.w <= 0 || candidateRect.h <= 0) continue;
      if (this.rectsIntersect(rect, candidateRect)) candidate.dirty = true;
    }
  }

  private repairCurrentNodePaintWithParent(node: MutableNode, rect: { x: number; y: number; w: number; h: number }): boolean {
    if (rect.w <= 0 || rect.h <= 0) return false;
    const parent = node.parentIndex >= 0 ? this.nodes[node.parentIndex] : undefined;
    if (!parent) return false;

    this.gfx.withClipRect(rect, () => {
      this.gfx.fillRect(rect.x, rect.y, rect.w, rect.h, this.parentClearColor(parent));
      const parentDrawX = this.drawXForNode(parent.index);
      const parentDrawY = this.drawYForNode(parent.index);
      const origParentX = parent.box.x;
      parent.box.x = parentDrawX;
      try {
        if (parent.gradientEnabled > 0) {
          this.drawGradientFill(parent, parentDrawY);
        } else if (parent.borderRadius > 0 && parent.hasBg) {
          this.gfx.fillRoundRect(parent.box.x, parentDrawY, parent.box.w, parent.box.h, parent.borderRadius, parent.bg);
        } else if (parent.hasBg) {
          this.gfx.fillRect(parent.box.x, parentDrawY, parent.box.w, parent.box.h, parent.bg);
        }
        if (parent.borderStyle) this.drawNodeBorder(parent, parentDrawX, parentDrawY, parent.borderColor || parent.fg);
        this.drawNodeOutline(parent, parentDrawX, parentDrawY);
      } finally {
        parent.box.x = origParentX;
      }
    });
    return true;
  }

  private clearCurrentNodePaint(node: MutableNode): void {
    const displayText = node.hasTextBinding ? node.textBuffer : node.text;
    const ts = this.nodeTextSize(node);
    const metrics = this.textLayout(node, displayText, node.box.w, ts);
    const rect = this.nodePaintRect(
      node,
      this.baseDrawXForNode(node.index),
      this.baseDrawYForNode(node.index),
      this.drawXForNode(node.index),
      this.drawYForNode(node.index),
      metrics.width,
      metrics.height,
    );
    if (rect.w <= 0 || rect.h <= 0) return;
    const clip = this.scrollClipForNode(node.index);
    const repairRect = this.intersectClipRect(clip, rect);
    if (repairRect.w <= 0 || repairRect.h <= 0) return;
    if (this.repairCurrentNodePaintWithParent(node, repairRect)) return;
    this.gfx.withClipRect(repairRect, () => {
      this.gfx.fillRect(repairRect.x, repairRect.y, repairRect.w, repairRect.h, this.parentClearColor(node));
      const parent = node.parentIndex >= 0 ? this.nodes[node.parentIndex] : undefined;
      if (parent) {
        const parentDrawY = this.drawYForNode(parent.index);
        const parentDrawX = this.drawXForNode(parent.index);
        if (parent.borderStyle) this.drawNodeBorder(parent, parentDrawX, parentDrawY, parent.borderColor || parent.fg);
        this.drawNodeOutline(parent, parentDrawX, parentDrawY);
      }
    });
  }

  private clearCurrentSubtreePaint(node: MutableNode): void {
    const rect = this.currentSubtreePaintRect(node);
    if (!rect || rect.w <= 0 || rect.h <= 0) return;
    const clip = this.scrollClipForNode(node.index);
    const repairRect = this.intersectClipRect(clip, rect);
    if (repairRect.w <= 0 || repairRect.h <= 0) return;
    if (this.repairCurrentNodePaintWithParent(node, repairRect)) return;
    this.gfx.withClipRect(repairRect, () => {
      this.gfx.fillRect(repairRect.x, repairRect.y, repairRect.w, repairRect.h, this.parentClearColor(node));
      const parent = node.parentIndex >= 0 ? this.nodes[node.parentIndex] : undefined;
      if (parent) {
        const parentDrawY = this.drawYForNode(parent.index);
        const parentDrawX = this.drawXForNode(parent.index);
        if (parent.borderStyle) this.drawNodeBorder(parent, parentDrawX, parentDrawY, parent.borderColor || parent.fg);
        this.drawNodeOutline(parent, parentDrawX, parentDrawY);
      }
    });
  }

  private setVisible(nodeIndex: number, visible: boolean): void {
    const node = this.nodes[nodeIndex];
    if (!node || node.visible === visible) return;

    if (!visible) {
      const subtreeRect = this.currentSubtreePaintRect(node);
      this.clearCurrentSubtreePaint(node);
      for (let i = Math.min(node.subtreeEnd, this.nodes.length) - 1; i >= nodeIndex; i--) {
        const child = this.nodes[i];
        if (!child || !this.isActiveNode(child)) continue;
        child.dirty = false;
      }
      if (subtreeRect) this.markOverlappingHigherLayersDirtyForRect(nodeIndex, subtreeRect);
      node.visible = false;
      return;
    }

    node.visible = true;
    for (let i = nodeIndex; i < Math.min(node.subtreeEnd, this.nodes.length); i++) {
      const child = this.nodes[i];
      if (!child || !this.isActiveNode(child) || !this.isEffectivelyVisible(child)) continue;
      child.dirty = true;
      this.markOverlappingHigherLayersDirty(i);
    }
  }

  private isClippedByScroll(nodeIndex: number, drawX: number, drawY: number): boolean {
    const node = this.nodes[nodeIndex];
    let parent = node.parentIndex;
    while (parent >= 0 && this.nodes[parent]) {
      const scrollParent = this.nodes[parent];
      if (
        scrollParent.scrollable &&
        (drawX < scrollParent.box.x ||
          drawX + node.box.w > scrollParent.box.x + scrollParent.box.w ||
          drawY < scrollParent.box.y ||
          drawY + node.box.h > scrollParent.box.y + scrollParent.box.h)
      ) {
        return true;
      }
      parent = scrollParent.parentIndex;
    }
    return false;
  }

  private scrollClipForNode(nodeIndex: number): { x: number; y: number; w: number; h: number } | undefined {
    let parent = this.nodes[nodeIndex].parentIndex;
    let clip: { x: number; y: number; w: number; h: number } | undefined;
    while (parent >= 0 && this.nodes[parent]) {
      const scrollParent = this.nodes[parent];
      if (scrollParent.scrollable) {
        const next = { x: scrollParent.box.x, y: scrollParent.box.y, w: scrollParent.box.w, h: scrollParent.box.h };
        if (!clip) {
          clip = next;
        } else {
          const x0 = Math.max(clip.x, next.x);
          const y0 = Math.max(clip.y, next.y);
          const x1 = Math.min(clip.x + clip.w, next.x + next.w);
          const y1 = Math.min(clip.y + clip.h, next.y + next.h);
          clip = { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
        }
      }
      parent = scrollParent.parentIndex;
    }
    return clip;
  }

  private rectIntersectsClip(node: MutableNode, drawY: number, clip: { x: number; y: number; w: number; h: number }): boolean {
    return node.box.x + node.box.w > clip.x &&
      node.box.x < clip.x + clip.w &&
      drawY + node.box.h > clip.y &&
      drawY < clip.y + clip.h;
  }

  private intersectClipRect(
    a: { x: number; y: number; w: number; h: number } | undefined,
    b: { x: number; y: number; w: number; h: number },
  ): { x: number; y: number; w: number; h: number } {
    if (!a) return b;
    const x0 = Math.max(a.x, b.x);
    const y0 = Math.max(a.y, b.y);
    const x1 = Math.min(a.x + a.w, b.x + b.w);
    const y1 = Math.min(a.y + a.h, b.y + b.h);
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  }

  private clearDirtyScrollViewports(): boolean {
    let changed = false;
    for (const node of this.nodes) {
      if (!this.isActiveNode(node)) continue;
      if (!node.scrollable || !this.isEffectivelyVisible(node) || node.contentHeight <= node.box.h) continue;
      if (node.dirty) {
        this.markScrollDescendantsDirtyLocal(node.index);
        for (let i = node.index; i < node.subtreeEnd; i++) {
      if (this.nodes[i]?.kind === "progress") this.nodes[i].lastTextWidth = -1;
      else if (this.nodes[i]?.kind === "range") this.nodes[i].lastTextWidth = -1;
      if (this.nodes[i]) this.nodes[i].lastTextHeight = 0;
        }
        this.gfx.fillRect(node.box.x, node.box.y, node.box.w, node.box.h, node.hasBg ? node.bg : node.clearColor);
        changed = true;
      }
    }
    return changed;
  }

  private drawScrollbars(scrollbarDirty: Set<number>): boolean {
    let changed = false;
    for (const node of this.nodes) {
      if (!this.isActiveNode(node)) continue;
      if (!node.scrollable || !this.isEffectivelyVisible(node) || node.contentHeight <= node.box.h) continue;
      if (!scrollbarDirty.has(node.index)) continue;
      const tx = node.box.x + node.box.w - 4;
      const ty = node.box.y;
      const th = node.box.h;
      node.scrollY = Math.max(0, Math.min(node.scrollY, node.contentHeight - th));
      const trackColor = (node.fg >> 1) & 0x7bef;
      this.gfx.fillRect(tx, ty, 3, th, trackColor);
      const thumbH = Math.max(8, Math.trunc((th * th) / node.contentHeight));
      const thumbY = ty + Math.trunc(((node.box.h - thumbH) * node.scrollY) / Math.max(1, node.contentHeight - th));
      this.gfx.fillRect(tx, thumbY, 3, thumbH, node.fg);
      changed = true;
    }
    return changed;
  }

  private nodeTextSize(node: MutableNode): number {
    return Math.max(1, Math.trunc(node.textSize || 2));
  }

  private fontAsset(fontFace: number | undefined): UIFontAssetModel | undefined {
    if (!fontFace) return undefined;
    return this.fontAssets.find((asset) => asset.id === fontFace);
  }

  private fontGlyph(asset: UIFontAssetModel, codepoint: number): UIFontGlyphModel | undefined {
    return asset.glyphs.find((glyph) => glyph.codepoint === codepoint);
  }

  private fontAlpha(asset: UIFontAssetModel, glyph: UIFontGlyphModel, pixelIndex: number): number {
    const nibble = glyph.dataOffset + pixelIndex;
    const byte = asset.alpha[nibble >> 1] ?? 0;
    return (nibble & 1) ? byte & 0x0f : byte >> 4;
  }

  private textWidth(text: string | undefined, size: number, fontFace = 0, letterSpacing = 0): number {
    const displayText = text ?? "";
    const asset = this.fontAsset(fontFace);
    if (!asset) {
      if (!displayText) return 0;
      let width = 0;
      for (const _ch of displayText) width += Math.max(1, Math.trunc(size)) * 6 + Math.trunc(letterSpacing);
      return width;
    }
    let width = 0;
    for (const ch of displayText) {
      const glyph = this.fontGlyph(asset, ch.codePointAt(0) ?? 0);
      width += glyph ? glyph.advance : Math.trunc(asset.lineHeight / 2);
    }
    return width;
  }

  private textHeight(size: number, fontFace = 0): number {
    return this.fontAsset(fontFace)?.lineHeight ?? this.gfx.textHeight(size);
  }

  private textLineHeight(node: MutableNode, size: number): number {
    const lineHeight = Math.trunc(node.lineHeight || 0);
    return lineHeight > 0 ? lineHeight : this.textHeight(size, node.fontFace);
  }

  private textWhiteSpace(node: MutableNode): string {
    switch (node.whiteSpaceMode ?? (node.nowrap ? 1 : 0)) {
      case 1: return "nowrap";
      case 2: return "pre";
      case 3: return "pre-line";
      default: return "normal";
    }
  }

  private textLayout(node: MutableNode, text: string | undefined, maxWidth: number | undefined, size: number) {
    const constrainedWidth = maxWidth !== undefined && maxWidth > 0 ? maxWidth : undefined;
    return layoutText(text ?? "", {
      maxWidth: constrainedWidth,
      whiteSpace: this.textWhiteSpace(node),
      lineHeight: this.textLineHeight(node, size),
      measureText: (value) => this.textWidth(value, size, node.fontFace, node.letterSpacing),
    });
  }

  private clipTextToWidth(text: string, maxWidth: number, size: number, fontFace = 0, letterSpacing = 0): string {
    let out = "";
    let width = 0;
    for (const ch of text) {
      const next = this.textWidth(ch, size, fontFace, letterSpacing);
      if (width + next > maxWidth) break;
      out += ch;
      width += next;
    }
    return out;
  }

  private drawAssetText(text: string, x: number, y: number, fg: number, bg: number, antialias: boolean | undefined, fontFace = 0): boolean {
    const asset = this.fontAsset(fontFace);
    if (!asset) return false;
    let cursor = x;
    const baseline = y + asset.baseline;
    for (const ch of text) {
      const glyph = this.fontGlyph(asset, ch.codePointAt(0) ?? 0);
      if (!glyph) {
        cursor += Math.trunc(asset.lineHeight / 2);
        continue;
      }
      for (let gy = 0; gy < glyph.height; gy++) {
        for (let gx = 0; gx < glyph.width; gx++) {
          const alpha = this.fontAlpha(asset, glyph, gy * glyph.width + gx);
          if (alpha === 0) continue;
          const dx = cursor + glyph.xOffset + gx;
          const dy = baseline + glyph.yOffset + gy;
          if (antialias) {
            this.gfx.drawPixel(dx, dy, alpha >= 15 ? fg : blendRgb565(fg, bg, Math.trunc((alpha * 100) / 15)));
          } else if (alpha >= 8) {
            this.gfx.drawPixel(dx, dy, fg);
          }
        }
      }
      cursor += glyph.advance;
    }
    return true;
  }

  private drawText(text: string | undefined, x: number, y: number, fg: number, bg: number, size: number, antialias: boolean | undefined, fontFace = 0, letterSpacing = 0): void {
    const displayText = text ?? "";
    if (this.drawAssetText(displayText, x, y, fg, bg, antialias, fontFace)) return;
    if (antialias && letterSpacing === 0 && this.snapshot.program.colorFormat !== "mono" && (fg & 0xffff) !== (bg & 0xffff)) {
      this.gfx.drawAntialiasedText(displayText, x, y, fg, bg, size);
      return;
    }
    this.gfx.setTextColor(fg, bg);
    this.gfx.setTextSize(size);
    this.gfx.setTextWrap(false);
    if (letterSpacing === 0) {
      this.gfx.setCursor(x, y);
      this.gfx.print(displayText);
      return;
    }
    let cursor = x;
    for (const ch of displayText) {
      this.gfx.setCursor(cursor, y);
      this.gfx.print(ch);
      cursor += Math.max(1, Math.trunc(size)) * 6 + Math.trunc(letterSpacing);
    }
  }

  private drawGradientFill(node: MutableNode, drawY: number): void {
    const bx = node.box.x;
    const by = drawY;
    const bw = node.box.w;
    const bh = node.box.h;
    if (bw <= 0 || bh <= 0) return;
    if (node.gradientEnabled === 1) {
      for (let y = 0; y < bh; y++) {
        const opacity = Math.trunc((y * 100) / (bh > 1 ? bh - 1 : 1));
        this.gfx.drawFastHLine(bx, by + y, bw, blendRgb565(node.gradientColor1, node.gradientColor2, opacity));
      }
    } else if (node.gradientEnabled === 2) {
      for (let x = 0; x < bw; x++) {
        const opacity = Math.trunc((x * 100) / (bw > 1 ? bw - 1 : 1));
        this.gfx.drawFastVLine(bx + x, by, bh, blendRgb565(node.gradientColor1, node.gradientColor2, opacity));
      }
    }
  }

  private drawNodeShadow(node: MutableNode, drawY: number, insetOnly: boolean): void {
    const count = Math.min(node.shadowCount ?? 0, 4);
    if (count <= 0) return;
    const bx = node.box.x;
    const by = drawY;
    const bw = node.box.w;
    const bh = node.box.h;
    const clearCol = node.clearColor;
    const radius = Math.max(0, Math.trunc(node.borderRadius || 0));

    for (let s = 0; s < count; s++) {
      const inset = !!node.shadowInset?.[s];
      if (insetOnly && !inset) continue;
      if (!insetOnly && inset) continue;
      const shadowCol = node.shadowColor?.[s] ?? 0;
      const ox = Math.trunc(node.shadowOffsetX?.[s] ?? 0);
      const oy = Math.trunc(node.shadowOffsetY?.[s] ?? 0);
      const rawBlur = Math.trunc(node.shadowBlur?.[s] ?? 0);
      const blur = rawBlur === 0 ? 1 : rawBlur;
      const baseAlpha = Math.max(0, Math.min(100, Math.trunc(node.shadowAlpha?.[s] ?? 100)));

      if (inset && rawBlur === 0) {
        const insetBg = node.hasBg ? node.bg : node.clearColor;
        const col = blendRgb565(shadowCol, insetBg, baseAlpha);
        if (oy > 0) this.gfx.fillRect(bx, by, bw, oy, col);
        else if (oy < 0) this.gfx.fillRect(bx, by + bh + oy, bw, -oy, col);
        if (ox > 0) this.gfx.fillRect(bx, by, ox, bh, col);
        else if (ox < 0) this.gfx.fillRect(bx + bw + ox, by, -ox, bh, col);
        if (ox === 0 && oy === 0) this.gfx.drawRect(bx, by, bw, bh, col);
        continue;
      }

      for (let pass = blur; pass >= 1; pass--) {
        const opacity = Math.trunc(baseAlpha / (pass + 1));
        const col = blendRgb565(shadowCol, inset ? (node.hasBg ? node.bg : clearCol) : clearCol, opacity);
        if (inset) {
          const ix = bx + pass + ox;
          const iy = by + pass + oy;
          const iw = bw - 2 * pass;
          const ih = bh - 2 * pass;
          if (iw <= 0 || ih <= 0) continue;
          this.gfx.fillRect(ix, iy, iw, 1, col);
          this.gfx.fillRect(ix, iy + ih - 1, iw, 1, col);
          this.gfx.fillRect(ix, iy, 1, ih, col);
          this.gfx.fillRect(ix + iw - 1, iy, 1, ih, col);
        } else {
          const sx = bx + ox - pass;
          const sy = by + oy - pass;
          const sw = bw + 2 * pass;
          const sh = bh + 2 * pass;
          if (radius > 0) this.gfx.fillRoundRect(sx, sy, sw, sh, radius + pass, col);
          else this.gfx.fillRect(sx, sy, sw, sh, col);
        }
      }
    }
  }

  private drawRectOutline(x: number, y: number, w: number, h: number, radius: number, style: number, width: number, color: number): void {
    if (style === 0 || width <= 0 || w <= 0 || h <= 0) return;
    for (let b = 0; b < width; b++) {
      const rx = x + b;
      const ry = y + b;
      const rw = w - 2 * b;
      const rh = h - 2 * b;
      if (rw <= 0 || rh <= 0) return;
      const r = radius > b ? radius - b : 0;
      if (style === 1) {
        if (r > 0) this.drawClosedRoundRect(rx, ry, rw, rh, r, color);
        else this.gfx.drawRect(rx, ry, rw, rh, color);
      } else {
        for (let dx = 0; dx < rw; dx += 8) {
          const seg = Math.min(4, rw - dx);
          if (seg > 0) {
            this.gfx.drawFastHLine(rx + dx, ry, seg, color);
            this.gfx.drawFastHLine(rx + dx, ry + rh - 1, seg, color);
          }
        }
        for (let dy = 0; dy < rh; dy += 8) {
          const seg = Math.min(4, rh - dy);
          if (seg > 0) {
            this.gfx.drawFastVLine(rx, ry + dy, seg, color);
            this.gfx.drawFastVLine(rx + rw - 1, ry + dy, seg, color);
          }
        }
      }
    }
  }

  private drawClosedRoundRect(x: number, y: number, w: number, h: number, radius: number, color: number): void {
    let r = Math.max(0, Math.trunc(radius));
    if (w <= 0 || h <= 0) return;
    r = Math.min(r, Math.trunc(Math.min(w, h) / 2));
    if (r <= 0) {
      this.gfx.drawRect(x, y, w, h, color);
      return;
    }
    this.gfx.drawRoundRect(x, y, w, h, r, color);
    this.gfx.drawPixel(x + r, y, color);
    this.gfx.drawPixel(x + w - r - 1, y, color);
    this.gfx.drawPixel(x + r, y + h - 1, color);
    this.gfx.drawPixel(x + w - r - 1, y + h - 1, color);
    this.gfx.drawPixel(x, y + r, color);
    this.gfx.drawPixel(x + w - 1, y + r, color);
    this.gfx.drawPixel(x, y + h - r - 1, color);
    this.gfx.drawPixel(x + w - 1, y + h - r - 1, color);
  }

  private drawNodeBorder(node: MutableNode, drawX: number, drawY: number, color: number): void {
    this.drawRectOutline(drawX, drawY, node.box.w, node.box.h, node.borderRadius, node.borderStyle, node.borderWidth, color);
  }

  private drawNodeOutline(node: MutableNode, drawX: number, drawY: number): void {
    if (!node.outlineStyle || !node.outlineWidth) return;
    const w = node.outlineWidth;
    this.drawRectOutline(drawX - w, drawY - w, node.box.w + 2 * w, node.box.h + 2 * w, node.borderRadius + w, node.outlineStyle, w, node.outlineColor);
  }

  // Set dirty=true across a scroll subtree WITHOUT the per-child O(n) overlap
  // repair. During scroll the subtree repaints into a freshly-cleared canvas, so
  // intra-subtree repair is pointless, and scroll children are draw-clipped to
  // the container's viewport box — so a single overlap check at the container
  // (done by markScrollDescendantsDirty) covers all external higher-z neighbors.
  private markScrollDescendantsDirtyLocal(nodeIndex: number): void {
    const node = this.nodes[nodeIndex];
    for (let i = nodeIndex + 1; i < node.subtreeEnd; i++) {
      if (this.nodes[i]) this.nodes[i].dirty = true;
    }
    this.nodes[nodeIndex].dirty = true;
  }

  private markScrollDescendantsDirty(nodeIndex: number): void {
    this.markScrollDescendantsDirtyLocal(nodeIndex);
    // Single overlap check at the container covers every external higher-z
    // neighbor of the viewport (children are clipped to this box). Drops scroll
    // marking from O(K·n) to O(K + n).
    this.markOverlappingHigherLayersDirty(nodeIndex);
  }

  private drawDirty(): boolean {
    if (this.keyboardVisible) {
      this.keyboardTick(Date.now());
      if (this.keyboardDirty === 0) return false;
      if (this.keyboardDirty === 1) {
        this.drawKeyboard();
      } else {
        this.drawKeyboardTextRow();
        if (this.keyboardRepaintKey >= 0) this.drawKeyboardKey(this.keyboardRepaintKey);
      }
      this.keyboardDirty = 0;
      this.keyboardRepaintKey = -1;
      return true;
    }

    let changed = this.clearDirtyScrollViewports();
    const scrollbarDirty = new Set<number>();
    for (const node of this.nodes) {
      if (this.isActiveNode(node) && this.isEffectivelyVisible(node) && node.scrollable && node.dirty) scrollbarDirty.add(node.index);
    }
    const dirtyNodes = this.nodes
      .filter((node) => {
        if (!node.dirty) return false;
        if (!this.isActiveNode(node)) {
          node.dirty = false;
          return false;
        }
        if (!this.isEffectivelyVisible(node)) {
          node.dirty = false;
          return false;
        }
        return true;
      })
      .sort((a, b) => this.compareDrawOrder(a, b));
    for (const node of dirtyNodes) {
      if (!node.dirty) continue;
      if (!this.isEffectivelyVisible(node)) {
        node.dirty = false;
        continue;
      }
      if (!this.isActiveNode(node)) {
        node.dirty = false;
        continue;
      }
      const origBoxX = node.box.x;
      const baseX = this.baseDrawXForNode(node.index);
      const baseY = this.baseDrawYForNode(node.index);
      const drawX = this.drawXForNode(node.index);
      const drawY = this.drawYForNode(node.index);
      node.box.x = drawX;
      const scrollClip = this.scrollClipForNode(node.index);
      if (scrollClip && !this.rectIntersectsClip(node, drawY, scrollClip)) {
        node.box.x = origBoxX;
        node.dirty = false;
        continue;
      }
      this.clearPressOffsetArea(node, baseX, baseY);

      const displayText = node.hasTextBinding ? node.textBuffer : node.text;
      const ts = this.nodeTextSize(node);
      let bColor = node.borderColor || node.fg;
      if (node.opacity < 100) bColor = blendRgb565(bColor, node.clearColor, node.opacity);

      this.gfx.withClipRect(scrollClip, () => {
        node.box.x = baseX;
        this.drawNodeShadow(node, baseY, false);
        node.box.x = drawX;
        switch (node.kind) {
          case "fill":
            if (node.gradientEnabled > 0) {
              this.drawGradientFill(node, drawY);
            } else {
              const fillSize = this.rotatedFaceSize(node, node.box.w, node.box.h);
              if (node.borderRadius > 0 && node.hasBg) this.gfx.fillRoundRect(node.box.x, drawY, fillSize.w, fillSize.h, node.borderRadius, node.bg);
              else if (node.hasBg) this.gfx.fillRect(node.box.x, drawY, fillSize.w, fillSize.h, node.bg);
              if (node.borderStyle) this.drawRectOutline(node.box.x, drawY, fillSize.w, fillSize.h, node.borderRadius, node.borderStyle, node.borderWidth, bColor);
            }
            this.drawNodeShadow(node, drawY, true);
            break;
          case "text":
            this.drawTextNode(node, displayText, drawY, ts);
            break;
          case "button":
            this.drawButtonNode(node, displayText, bColor, drawY, ts);
            break;
          case "check":
            this.drawCheckNode(node, displayText, drawY, ts);
            break;
          case "radio":
            this.drawRadioNode(node, displayText, drawY, ts);
            break;
          case "progress":
            this.drawProgressNode(node, drawY);
            break;
          case "range":
            this.drawRangeNode(node, drawY);
            break;
          case "input":
            this.drawInputNode(node, drawY);
            break;
          case "img":
            this.drawImageNode(node, drawY);
            break;
          case "list":
            this.drawListNode(node, drawY, scrollClip);
            break;
          case "canvas":
            this.drawCanvasNode(node, drawY);
            break;
        }
        if (node.kind === "fill" && this.rotationQuadrant(node.rotateDeg) !== 0 && node.outlineStyle && node.outlineWidth > 0) {
          const w = node.outlineWidth;
          const outlineSize = this.rotatedFaceSize(node, node.box.w, node.box.h);
          this.drawRectOutline(node.box.x - w, drawY - w, outlineSize.w + 2 * w, outlineSize.h + 2 * w, node.borderRadius + w, node.outlineStyle, w, node.outlineColor);
        } else {
          this.drawNodeOutline(node, node.box.x, drawY);
        }
      });
      changed = true;
      node.box.x = origBoxX;
      node.dirty = false;
    }
    return this.drawScrollbars(scrollbarDirty) || changed;
  }

  private lineX(node: MutableNode, lineWidth: number, left: number, maxWidth: number, align = node.textAlign): number {
    if (align === 1) return left + Math.trunc((maxWidth - lineWidth) / 2);
    if (align === 2) return left + maxWidth - lineWidth;
    return left;
  }

  private drawTextLines(node: MutableNode, displayText: string | undefined, left: number, top: number, maxWidth: number, ts: number, fg: number, bg: number, align = node.textAlign): { width: number; height: number } {
    const layout = this.textLayout(node, displayText, maxWidth, ts);
    let y = top;
    for (const line of layout.lines) {
      const x = this.lineX(node, line.width, left, maxWidth, align);
      this.drawText(line.text, x, y, fg, bg, ts, node.fontAntialias, node.fontFace, node.letterSpacing);
      if (node.underline) this.gfx.drawFastHLine(x, y + this.textHeight(ts, node.fontFace) - 1, line.width, fg);
      y += layout.lineHeight;
    }
    return { width: layout.width, height: layout.height };
  }

  private drawTextNode(node: MutableNode, displayText: string | undefined, drawY: number, ts: number): void {
    const layout = this.textLayout(node, displayText, node.box.w, ts);
    const clearW = Math.max(node.box.w, node.lastTextWidth, layout.width);
    const clearH = Math.max(node.box.h, node.lastTextHeight ?? 0, layout.height);
    const textClear = node.hasBg ? node.bg : node.clearColor;
    this.gfx.fillRect(node.box.x, drawY, clearW, clearH, textClear);
    node.lastTextWidth = layout.width;
    node.lastTextHeight = layout.height;
    if (node.textShadowCount > 0) {
      const shadowColor = blendRgb565(node.textShadowColor, textClear, node.textShadowAlpha);
      this.drawTextLines(
        node,
        displayText,
        node.box.x + node.textShadowOffsetX,
        drawY + node.textShadowOffsetY,
        node.box.w,
        ts,
        shadowColor,
        shadowColor,
      );
    }
    this.drawTextLines(node, displayText, node.box.x, drawY, node.box.w, ts, node.fg, textClear);
  }

  private listStateForNode(nodeIndex: number): PreviewListState | undefined {
    return this.listStates.find((list) => list.nodeIndex === nodeIndex);
  }

  private drawListNode(
    node: MutableNode,
    drawY: number,
    scrollClip: { x: number; y: number; w: number; h: number } | undefined,
  ): void {
    const list = this.listStateForNode(node.index);
    const bg = node.hasBg ? node.bg : node.clearColor;
    if (!list || list.itemHeight <= 0) {
      this.gfx.fillRect(node.box.x, drawY, node.box.w, node.box.h, bg);
      return;
    }

    this.gfx.fillRect(node.box.x, drawY, node.box.w, node.box.h, bg);
    const listClip = this.intersectClipRect(scrollClip, { x: node.box.x, y: drawY, w: node.box.w, h: node.box.h });
    this.gfx.withClipRect(listClip, () => {
      const itemHeight = list.itemHeight;
      const ts = this.nodeTextSize(node);
      const textH = this.textHeight(ts, node.fontFace);
      // Scroll + content size live on the node now (unified with containers).
      const listScrollY = node.scrollY;
      const listContentH = node.contentHeight;
      const first = Math.max(0, Math.trunc(listScrollY / itemHeight));
      const last = Math.min(list.itemCount - 1, Math.trunc((listScrollY + node.box.h - 1) / itemHeight) + 1);
      for (let row = first; row <= last; row++) {
        const itemY = drawY + row * itemHeight - listScrollY;
        const text = clampText(this.evaluateExpression(list.itemExpression, this.listLocal(list.itemParam, row)));
        this.drawText(
          text,
          node.box.x + 4,
          itemY + Math.trunc((itemHeight - textH) / 2),
          node.fg,
          bg,
          ts,
          node.fontAntialias,
          node.fontFace,
          node.letterSpacing,
        );
      }

      if (listContentH > node.box.h) {
        const tx = node.box.x + node.box.w - 4;
        const trackColor = (node.fg >> 1) & 0x7bef;
        this.gfx.fillRect(tx, drawY, 3, node.box.h, trackColor);
        const thumbH = Math.max(8, Math.trunc((node.box.h * node.box.h) / listContentH));
        const maxScroll = Math.max(1, listContentH - node.box.h);
        // Clamp the thumb to the track during overscroll (scrollY stays in range,
        // but overscrollPx can push the visual; the thumb pins to the ends).
        const clampedScrollY = Math.max(0, Math.min(listScrollY, listContentH - node.box.h));
        const thumbY = drawY + Math.trunc(((node.box.h - thumbH) * clampedScrollY) / maxScroll);
        this.gfx.fillRect(tx, thumbY, 3, thumbH, node.fg);
      }
    });
  }

  private drawCanvasNode(node: MutableNode, drawY: number): void {
    const binding = this.canvasBindings.find((b) => b.nodeIndex === node.index);
    if (!binding) return;
    this.runCanvasBody(binding.drawBody, node.box.x, drawY, node.canvasW ?? node.box.w, node.canvasH ?? node.box.h);
  }

  /** Lower a canvas drawBody (`ctx.X(...)` source) against the host gfx.
   *  Mirrors the device ctx→ui_display_* rewrite so preview and device match.
   *  Coordinates are translated to the node origin (ox, oy). Only the flat call
   *  sequence is supported — same constraint as bindList item expressions. */
  private runCanvasBody(body: string, ox: number, oy: number, cw: number, ch: number): void {
    const color = (c: string): number => {
      try { return resolveColor(c.replace(/^['"]|['"]$/g, ""), "rgb565"); } catch { return 0xffff; }
    };
    const n = (i: number, args: string[]) => parseInt(args[i], 10) || 0;
    // Resolve each numeric argument: ctx.width/height → canvas dims, integer
    // literals parse directly, anything else (e.g. screen.gauge.value, Math.*,
    // module vars) is evaluated against the screen proxy / module scope. This
    // mirrors the device, which emits these as real C++ expressions evaluated at
    // draw time (`__ui_nodes[i].value`), so the canvas tracks live state.
    const num = (i: number, args: string[]): number => {
      const t = args[i].trim();
      if (t === "ctx.width" || t === "ctx?.width") return cw;
      if (t === "ctx.height" || t === "ctx?.height") return ch;
      const parsed = parseInt(t, 10);
      if (Number.isNaN(parsed)) {
        const value = this.evaluateExpression(t);
        return Math.trunc(Number(value)) || 0;
      }
      return parsed || 0;
    };
    const g = this.gfx;
    const re = /ctx\.(fillRect|rect|fillCircle|circle|line|hline|vline|fillRoundRect|roundRect|drawPixel|fillScreen|text)\(([^)]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const method = m[1];
      const args = m[2].split(",").map((s) => s.trim());
      if (method === "fillRect") g.fillRect(ox + num(0, args), oy + num(1, args), num(2, args), num(3, args), color(args[4]));
      else if (method === "rect") g.drawRect(ox + num(0, args), oy + num(1, args), num(2, args), num(3, args), color(args[4]));
      else if (method === "fillCircle") g.fillCircle(ox + num(0, args), oy + num(1, args), num(2, args), color(args[3]));
      else if (method === "circle") g.drawCircle(ox + num(0, args), oy + num(1, args), num(2, args), color(args[3]));
      else if (method === "line") g.drawLine(ox + num(0, args), oy + num(1, args), ox + num(2, args), oy + num(3, args), color(args[4]));
      else if (method === "hline") g.drawFastHLine(ox + num(0, args), oy + num(1, args), num(2, args), color(args[3]));
      else if (method === "vline") g.drawFastVLine(ox + num(0, args), oy + num(1, args), num(2, args), color(args[3]));
      else if (method === "fillRoundRect") g.fillRoundRect(ox + num(0, args), oy + num(1, args), num(2, args), num(3, args), num(4, args), color(args[5]));
      else if (method === "roundRect") g.drawRoundRect(ox + num(0, args), oy + num(1, args), num(2, args), num(3, args), num(4, args), color(args[5]));
      else if (method === "drawPixel") g.drawPixel(ox + num(0, args), oy + num(1, args), color(args[2]));
      else if (method === "fillScreen") g.fillRect(ox, oy, cw, ch, color(args[0]));
      else if (method === "text") {
        g.setCursor(ox + num(0, args), oy + num(1, args));
        if (args.length >= 4) g.setTextColor(color(args[3]));
        g.print(args[2].replace(/^['"`]|['"`]$/g, ""));
      }
    }
  }
  private drawButtonNode(node: MutableNode, displayText: string | undefined, bColor: number, drawY: number, ts: number): void {
    if (node.borderRadius > 0 && node.hasBg) this.gfx.fillRoundRect(node.box.x, drawY, node.box.w, node.box.h, node.borderRadius, node.bg);
    else if (node.hasBg) this.gfx.fillRect(node.box.x, drawY, node.box.w, node.box.h, node.bg);
    this.drawNodeShadow(node, drawY, true);
    if (node.borderStyle) this.drawNodeBorder(node, node.box.x, drawY, bColor);
    const layout = this.textLayout(node, displayText, node.box.w, ts);
    const top = drawY + Math.trunc((node.box.h - layout.height) / 2);
    this.drawTextLines(node, displayText, node.box.x, top, node.box.w, ts, node.fg, node.hasBg ? node.bg : node.clearColor, 1);
  }

  private drawCheckNode(node: MutableNode, displayText: string | undefined, drawY: number, ts: number): void {
    const layout = this.textLayout(node, displayText, Math.max(0, node.box.w - 22), ts);
    const clearW = Math.max(node.box.w, node.lastTextWidth);
    const clearH = Math.max(node.box.h, node.lastTextHeight ?? 0, layout.height);
    this.gfx.fillRect(node.box.x, drawY, clearW, clearH, node.hasBg ? node.bg : node.clearColor);
    node.lastTextWidth = 22 + layout.width;
    node.lastTextHeight = Math.max(layout.height, 16);

    const cbX = node.box.x;
    const cbY = drawY;
    if (node.value) {
      this.gfx.fillRect(cbX, cbY, 16, 16, node.fg);
      const inv = node.hasBg ? node.bg : node.clearColor;
      this.gfx.drawLine(cbX + 3, cbY + 8, cbX + 7, cbY + 12, inv);
      this.gfx.drawLine(cbX + 4, cbY + 8, cbX + 8, cbY + 12, inv);
      this.gfx.drawLine(cbX + 3, cbY + 9, cbX + 7, cbY + 13, inv);
      this.gfx.drawLine(cbX + 7, cbY + 12, cbX + 13, cbY + 4, inv);
      this.gfx.drawLine(cbX + 8, cbY + 12, cbX + 14, cbY + 4, inv);
      this.gfx.drawLine(cbX + 7, cbY + 13, cbX + 13, cbY + 5, inv);
    } else {
      this.gfx.drawRect(cbX, cbY, 16, 16, node.fg);
    }
    this.drawTextLines(node, displayText, node.box.x + 22, drawY, Math.max(0, node.box.w - 22), ts, node.fg, node.hasBg ? node.bg : node.clearColor, 0);
  }

  private drawRadioNode(node: MutableNode, displayText: string | undefined, drawY: number, ts: number): void {
    const layout = this.textLayout(node, displayText, Math.max(0, node.box.w - 22), ts);
    const clearW = Math.max(node.box.w, node.lastTextWidth);
    const clearH = Math.max(node.box.h, node.lastTextHeight ?? 0, layout.height);
    this.gfx.fillRect(node.box.x, drawY, clearW, clearH, node.hasBg ? node.bg : node.clearColor);
    node.lastTextWidth = 22 + layout.width;
    node.lastTextHeight = Math.max(layout.height, 16);

    const cbX = node.box.x;
    const cbY = drawY;
    if (node.value) {
      this.gfx.fillCircle(cbX + 8, cbY + 8, 7, node.fg);
      this.gfx.fillCircle(cbX + 8, cbY + 8, 3, node.hasBg ? node.bg : node.clearColor);
    } else {
      this.gfx.drawCircle(cbX + 8, cbY + 8, 7, node.fg);
    }
    this.drawTextLines(node, displayText, node.box.x + 22, drawY, Math.max(0, node.box.w - 22), ts, node.fg, node.hasBg ? node.bg : node.clearColor, 0);
  }

  private drawProgressNode(node: MutableNode, drawY: number): void {
    const bx = node.box.x;
    const by = drawY;
    const bw = node.box.w;
    const bh = node.box.h;
    const bgCol = node.hasBg ? node.bg : node.clearColor;
    const fgCol = node.fg;
    const pct = Math.max(0, Math.min(100, node.value));
    const fillW = Math.trunc(((bw - 2) * pct) / 100);
    const prevW = node.lastTextWidth;

    if (prevW < 0) {
      this.gfx.drawRect(bx, by, bw, bh, fgCol);
      this.gfx.fillRect(bx + 1, by + 1, bw - 2, bh - 2, bgCol);
      if (fillW > 0) this.gfx.fillRect(bx + 1, by + 1, fillW, bh - 2, fgCol);
    } else if (fillW > prevW) {
      this.gfx.fillRect(bx + 1 + prevW, by + 1, fillW - prevW, bh - 2, fgCol);
    } else if (fillW < prevW) {
      this.gfx.fillRect(bx + 1 + fillW, by + 1, prevW - fillW, bh - 2, bgCol);
    }

    node.lastTextWidth = fillW;
  }

  private drawRangeNode(node: MutableNode, drawY: number): void {
    const bx = node.box.x;
    const by = drawY;
    const bw = node.box.w;
    const bh = node.box.h;
    const fgCol = node.fg;
    const bgCol = node.hasBg ? node.bg : node.clearColor;
    const dimFg = (fgCol >> 1) & 0x7bef;
    const trackY = by + Math.trunc(bh / 2);
    const rangeMin = node.rangeMin;
    const rangeMax = node.rangeMax;
    const range = rangeMax > rangeMin ? rangeMax - rangeMin : 100;
    const value = Math.max(rangeMin, Math.min(rangeMax, node.value)) - rangeMin;
    const fillW = Math.trunc(((bw - 8) * value) / range);
    const prevFillW = node.lastTextWidth;
    let newThumbX = bx + 4 + fillW - 3;

    if (prevFillW < 0) {
      this.gfx.drawFastHLine(bx, trackY, bw, dimFg);
      this.gfx.drawFastHLine(bx + 4, trackY, fillW, fgCol);
    } else {
      const prevThumbX = bx + 4 + prevFillW - 3;
      let left = Math.min(prevThumbX, newThumbX);
      let right = Math.max(prevThumbX + 6, newThumbX + 6);
      left = Math.max(left, bx);
      right = Math.min(right, bx + bw);
      this.gfx.fillRect(left, trackY - 5, right - left, 10, bgCol);
      const fillEnd = bx + 4 + fillW;
      if (right <= fillEnd) {
        this.gfx.drawFastHLine(left, trackY, right - left, fgCol);
      } else if (left >= fillEnd) {
        this.gfx.drawFastHLine(left, trackY, right - left, dimFg);
      } else {
        this.gfx.drawFastHLine(left, trackY, fillEnd - left, fgCol);
        this.gfx.drawFastHLine(fillEnd, trackY, right - fillEnd, dimFg);
      }
    }

    newThumbX = Math.max(bx + 1, Math.min(bx + bw - 7, newThumbX));
    this.gfx.fillRect(newThumbX, trackY - 5, 6, 10, fgCol);
    node.lastTextWidth = fillW;
  }

  private drawInputNode(node: MutableNode, drawY: number): void {
    const bx = node.box.x;
    const by = drawY;
    const bw = node.box.w;
    const bh = node.box.h;
    const bgCol = node.hasBg ? node.bg : node.clearColor;
    const fgCol = node.fg;
    const border = node.borderColor || fgCol;
    const borderStyle = node.borderStyle || 1;
    const borderWidth = node.borderWidth || 1;
    const displayText = node.textBuffer || node.placeholder || node.text || "";
    const textColor = node.textBuffer ? fgCol : ((fgCol >> 1) & 0x7bef);
    const ts = this.nodeTextSize(node);
    const clippedText = this.clipTextToWidth(displayText, Math.max(0, bw - 8), ts, node.fontFace, node.letterSpacing);

    if (node.borderRadius > 0) this.gfx.fillRoundRect(bx, by, bw, bh, node.borderRadius, bgCol);
    else this.gfx.fillRect(bx, by, bw, bh, bgCol);
    this.drawRectOutline(bx, by, bw, bh, node.borderRadius, borderStyle, borderWidth, border);
    this.drawText(clippedText, bx + 4, by + Math.trunc((bh - this.textHeight(ts, node.fontFace)) / 2), textColor, bgCol, ts, node.fontAntialias, node.fontFace, node.letterSpacing);
  }

  private hitTest(tx: number, ty: number): number {
    let best = -1;
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (!this.isEffectivelyVisible(node)) continue;
      if (!this.isActiveNode(node)) continue;
      const drawX = this.drawXForNode(i);
      const drawY = this.drawYForNode(i);
      if (this.isClippedByScroll(i, drawX, drawY)) continue;
      if (tx >= drawX && tx < drawX + node.box.w && ty >= drawY && ty < drawY + node.box.h) {
        if (this.hasAnyHandler(i) && (best < 0 || this.drawsBefore(this.nodes[best], node))) best = i;
      }
    }
    return best;
  }

  // Unified scroll hit-scan: one pass over scrollable nodes. Lists are
  // scrollable (UA rule) and their contentHeight is seeded on the node by
  // refreshListState, so this single scan finds the owning container — list or
  // generic — topmost first.
  private findScrollNode(tx: number, ty: number): number {
    let best = -1;
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (!this.isActiveNode(node)) continue;
      if (!node.scrollable || !this.isEffectivelyVisible(node) || node.contentHeight <= node.box.h) continue;
      const drawX = this.drawXForNode(i);
      const drawY = this.drawYForNode(i);
      if (tx >= drawX && tx < drawX + node.box.w && ty >= drawY && ty < drawY + node.box.h) {
        if (best < 0 || this.drawsBefore(this.nodes[best], node)) best = i;
      }
    }
    return best;
  }

  private hasAnyHandler(nodeIndex: number): boolean {
    const node = this.nodes[nodeIndex];
    if (node.kind === "list") return true;
    if (node.kind === "range") return true;
    if (node.kind === "input") return true;
    if (node.tag === "check" || node.tag === "select" || node.tag === "radio") return true;
    return this.callbacks.some((callback) => callback.nodeIndex === nodeIndex);
  }

  private updateRangeValue(nodeIndex: number, tx: number): void {
    const node = this.nodes[nodeIndex];
    const rangeMin = node.rangeMin;
    const rangeMax = node.rangeMax;
    const range = rangeMax > rangeMin ? rangeMax - rangeMin : 100;
    const usable = Math.max(1, node.box.w - 8);
    const relX = tx - this.drawXForNode(nodeIndex) - 4;
    const next = Math.max(rangeMin, Math.min(rangeMax, rangeMin + Math.trunc((relX * range) / usable)));
    if (next !== node.value) {
      node.value = next;
      this.markDirty(nodeIndex);
    }
  }

  // ── Scroll engine: Input layer ────────────────────────────────────────────
  // Preview is the capacitive tier → passthrough 1:1 (no deadband).
  private smoothDragDelta(dy: number): number {
    return dy;
  }

  private scrollMax(nodeIndex: number): number {
    const node = this.nodes[nodeIndex];
    if (!node) return 0;
    return Math.max(0, node.contentHeight - node.box.h);
  }

  // Rubber-band excursion for d cumulative pixels dragged past a boundary.
  private overscrollFor(d: number): number {
    if (d <= 0) return 0;
    return Math.min(UI_SCROLL_MAX_OVERSCROLL, Math.round((UI_SCROLL_MAX_OVERSCROLL * d) / (d + UI_SCROLL_STIFFNESS)));
  }

  // ── Scroll engine: Physics layer ──────────────────────────────────────────
  // 1:1 in-bounds; rubber-band at edges; scrollY stays in [0, maxScroll] while
  // overscrollPx tracks the elastic excursion. Mirrors the C++ engine exactly.
  private applyScrollDelta(nodeIndex: number, dy: number): boolean {
    const node = this.nodes[nodeIndex];
    if (!node) return false;
    const maxS = this.scrollMax(nodeIndex);
    const sy = node.scrollY;
    const nextY = sy - dy;
    const prevOv = node.overscrollPx;
    let nextOv = prevOv;
    if (nextY < 0) {
      node.scrollY = 0;
      const draggedPast = dy - sy;
      const cum = Math.max(0, prevOv + draggedPast);
      nextOv = this.overscrollFor(cum);
    } else if (nextY > maxS) {
      node.scrollY = maxS;
      const draggedPast = nextY - maxS;
      const cum = (prevOv < 0 ? -prevOv : 0) + draggedPast;
      nextOv = -this.overscrollFor(cum);
    } else {
      node.scrollY = nextY;
      nextOv = 0;
    }
    node.overscrollPx = nextOv;
    const changed = node.scrollY !== sy || nextOv !== prevOv;
    if (changed) this.markScrollDescendantsDirty(nodeIndex);
    return changed;
  }

  // On release: arm a bounded settle — bounce overscroll back to 0, or edge-snap
  // scrollY within edgeSnapPx. The animation runs in advanceScrollSettle (tick).
  private releaseScroll(nodeIndex: number): boolean {
    const node = this.nodes[nodeIndex];
    if (!node) return false;
    if (node.overscrollPx !== 0) {
      node.settling = true;
      this.settleFromOverscroll = node.overscrollPx;
      this.settleFromScrollY = 0;
      this.settleStartMs = Date.now();
      return true;
    }
    const sy = node.scrollY;
    const maxS = this.scrollMax(nodeIndex);
    if (sy > 0 && sy <= UI_SCROLL_EDGE_SNAP_PX) {
      node.settling = true;
      this.settleFromScrollY = sy;
      this.settleFromOverscroll = 0;
      this.settleStartMs = Date.now();
      return true;
    }
    if (maxS > 0 && sy < maxS && sy >= maxS - UI_SCROLL_EDGE_SNAP_PX) {
      node.settling = true;
      this.settleFromScrollY = sy - maxS;
      this.settleFromOverscroll = 0;
      this.settleStartMs = Date.now();
      return true;
    }
    return false;
  }

  // Advance the settle animation for one node (ease-out, bounded ~180ms).
  private advanceScrollSettle(nodeIndex: number): void {
    const node = this.nodes[nodeIndex];
    if (!node || !node.settling) return;
    const elapsed = Date.now() - this.settleStartMs;
    const t = elapsed >= UI_SCROLL_SETTLE_MS ? 1 : elapsed / UI_SCROLL_SETTLE_MS;
    const k = 1 - (1 - t) * (1 - t);  // ease-out
    if (node.overscrollPx !== 0) {
      const from = this.settleFromOverscroll;
      node.overscrollPx = Math.round(from - from * k);
      if (t >= 1) node.overscrollPx = 0;
    } else if (this.settleFromScrollY !== 0) {
      const from = this.settleFromScrollY;
      const maxS = this.scrollMax(nodeIndex);
      if (from > 0) {
        node.scrollY = Math.round(from - from * k);
        if (t >= 1) node.scrollY = 0;
      } else {
        const target = maxS;
        node.scrollY = Math.round(target + (from * (1 - k)));
        if (t >= 1) node.scrollY = target;
      }
    }
    if (t >= 1) node.settling = false;
    this.markScrollDescendantsDirty(nodeIndex);
  }

  private dispatchListTap(nodeIndex: number, tx: number, ty: number): void {
    const node = this.nodes[nodeIndex];
    const list = this.listStateForNode(nodeIndex);
    if (!node || !list || !list.tapBody) return;
    const drawY = this.drawYForNode(nodeIndex);
    const row = Math.trunc((ty - drawY + node.scrollY) / Math.max(1, list.itemHeight));
    if (row < 0 || row >= list.itemCount) return;
    this.runBody(list.tapBody, this.listLocal(list.tapParam, row));
  }

  private handleTouch(tx: number, ty: number): void {
    const now = Date.now();
    this.lastTouchX = tx;
    this.lastTouchY = ty;
    if (this.keyboardVisible) {
      if (this.touchState === 0) {
        if (now - this.lastTouchTime < UI_TOUCH_DEBOUNCE_MS) return;
        this.touchState = 1;
        this.touchDownTime = now;
        this.keyboardHandleTouch(tx, ty);
      }
      this.lastTouchTime = now;
      return;
    }

    if (this.touchState === 0) {
      if (now - this.lastTouchTime < UI_TOUCH_DEBOUNCE_MS) return;
      const node = this.hitTest(tx, ty);
      this.touchNode = node;
      this.touchState = 1;
      this.touchDownTime = now;
      this.dragStartX = tx;
      this.dragStartY = ty;
      this.isDragging = false;
      // Unified scroll owner: one hit-scan covers containers and lists.
      this.scrollNode = this.findScrollNode(tx, ty);
      this.rangeNode = node >= 0 && this.nodes[node].kind === "range" ? node : -1;
      if (node >= 0) {
        if (this.nodes[node].kind === "button") this.setPressed(node, true);
        if (this.nodes[node].kind === "range") this.updateRangeValue(node, tx);
        this.markDirty(node);
      }
    } else {
      if (!this.isDragging && this.scrollNode >= 0 && Math.abs(ty - this.dragStartY) >= UI_DRAG_THRESHOLD) {
        this.isDragging = true;
      }
      // Unified scroll drag: immediate-apply each frame via the physics layer
      // (1:1 in-bounds, rubber-band at edges). No accumulator, no cadence gate.
      if (this.isDragging && this.scrollNode >= 0) {
        const rawDy = ty - this.dragStartY;
        if (rawDy !== 0) {
          const dy = this.smoothDragDelta(rawDy);
          if (dy !== 0) {
            this.applyScrollDelta(this.scrollNode, dy);
            this.dragStartX = tx;
            this.dragStartY = ty;
          }
        }
      } else if (this.rangeNode >= 0 && Math.abs(tx - this.dragStartX) >= UI_DRAG_THRESHOLD) {
        this.updateRangeValue(this.rangeNode, tx);
      } else if (this.touchState === 1 && this.touchNode >= 0 && now - this.touchDownTime >= UI_TOUCH_HOLD_MS) {
        this.touchState = 2;
        this.dispatch("hold", this.touchNode);
      }
    }
    this.lastTouchTime = now;
  }

  private handleNoTouch(): void {
    if (this.touchState === 0) return;
    const now = Date.now();
    if (now - this.lastReleaseTime < UI_TOUCH_DEBOUNCE_MS) return;
    if (this.keyboardVisible) {
      this.keyboardHandleTap();
      this.touchState = 0;
      this.touchNode = -1;
      this.isDragging = false;
      this.scrollNode = -1;
      this.rangeNode = -1;
      this.lastReleaseTime = now;
      return;
    }

    const elapsed = now - this.touchDownTime;
    const node = this.touchNode;
    // Release the scroll owner: arm a bounded settle (bounce-back / edge-snap).
    // No fling — motion ends with the finger; the settle is the only post-lift
    // motion and terminates within UI_SCROLL_SETTLE_MS.
    if (this.scrollNode >= 0) {
      this.releaseScroll(this.scrollNode);
    }
    if (node >= 0 && !this.isDragging) {
      if (elapsed < UI_TOUCH_HOLD_MS) {
        if (this.nodes[node].kind === "list") this.dispatchListTap(node, this.lastTouchX, this.lastTouchY);
        this.dispatchBuiltInClick(node);
        this.dispatch("click", node);
      }
      this.dispatch("release", node);
      if (this.nodes[node].kind === "button") this.setPressed(node, false);
      this.markDirty(node);
    }
    // Resume any `await ui.onTap()` awaiter. Runs for EVERY completed tap —
    // including empty-space taps (node == -1) and holds released above — so
    // "wake on any touch" works. After the click/release dispatch so onClick
    // fires first (matches the device runtime, "both fire").
    this.tapSeq++;
    this.tapNode = node;
    this.touchState = 0;
    this.touchNode = -1;
    this.isDragging = false;
    this.scrollNode = -1;
    this.rangeNode = -1;
    this.lastReleaseTime = now;
  }

  private dispatchBuiltInClick(nodeIndex: number): void {
    const node = this.nodes[nodeIndex];
    if (node.tag === "check") {
      node.value = node.value > 0 ? 0 : 1;
      this.markDirty(nodeIndex);
    } else if (node.tag === "select") {
      const count = Math.max(node.options?.length ?? 0, 2);
      node.value = (node.value + 1) % count;
      this.markDirty(nodeIndex);
    } else if (node.tag === "radio") {
      for (const candidate of this.nodes) {
        if (!this.isActiveNode(candidate)) continue;
        if (candidate.tag === "radio" && candidate.name && candidate.name === node.name) {
          candidate.value = 0;
          this.markDirty(candidate.index);
        }
      }
      node.value = 1;
      this.markDirty(nodeIndex);
    } else if (node.kind === "input") {
      this.keyboardOpen(nodeIndex);
    }
  }

  private keyboardTemplateForNode(node: MutableNode): KeyboardTemplate {
    if (node.keyboard) {
      const custom = this.snapshot.keyboardTemplates?.find((template) => template.id === node.keyboard);
      if (custom) return custom;
    }
    return node.inputType === "number" ? DEFAULT_NUMBER_KEYBOARD : DEFAULT_ALPHA_KEYBOARD;
  }

  private keyboardOpen(nodeIndex: number): void {
    const node = this.nodes[nodeIndex];
    const template = this.keyboardTemplateForNode(node);
    const cols = template.rows.length > 0 ? Math.max(...template.rows.map((row) => row.length)) : 0;
    this.keyboardTarget = nodeIndex;
    this.keyboardBuffer = clampText(node.textBuffer);
    this.keyboardMaxLen = Math.max(1, Math.min(node.maxlen || UI_TEXT_BUF, UI_TEXT_BUF));
    this.keyboardShift = false;
    this.keyboardBackspaceHeld = false;
    this.keyboardPressedKey = -1;
    this.keyboardRepaintKey = -1;
    this.keyboardRows = template.rows.length;
    this.keyboardCols = Math.max(1, cols);
    this.keyboardBg = resolveKeyboardBackground(template, this.snapshot.cssRules ?? []);
    this.keyboardKeys = [];

    for (const row of template.rows) {
      for (const key of row) {
        this.keyboardKeys.push({
          ch: key.ch,
          special: key.special,
          style: resolveKeyStyle(key, template, this.snapshot.cssRules ?? []),
        });
      }
      for (let p = row.length; p < this.keyboardCols; p++) {
        this.keyboardKeys.push({
          ch: " ",
          special: 255,
          style: { bg: DEFAULT_KEY_BG, fg: DEFAULT_KEY_FG, borderColor: DEFAULT_KEY_BORDER },
        });
      }
    }

    this.keyboardComputeBox();
    this.keyboardVisible = true;
    this.keyboardDirty = 1;
  }

  private keyboardClose(): void {
    if (this.keyboardTarget >= 0) {
      const node = this.nodes[this.keyboardTarget];
      node.textBuffer = clampText(this.keyboardBuffer).slice(0, this.keyboardMaxLen);
      this.markDirty(this.keyboardTarget);
      this.dispatch("change", this.keyboardTarget);
    }
    this.keyboardVisible = false;
    this.keyboardDirty = 0;
    this.keyboardTarget = -1;
    this.keyboardPressedKey = -1;
    this.keyboardBackspaceHeld = false;
    for (const node of this.nodes) node.dirty = true;
  }

  private keyboardComputeBox(): void {
    const isNumber = this.keyboardCols <= 4;
    const h = Math.trunc(this.snapshot.program.height * (isNumber ? 60 : 75) / 100);
    const w = isNumber ? Math.trunc(this.snapshot.program.width * 50 / 100) : this.snapshot.program.width;
    this.keyboardBox = {
      x: isNumber ? Math.trunc((this.snapshot.program.width - w) / 2) : 0,
      y: this.snapshot.program.height - h,
      w,
      h,
    };
  }

  private keyboardKeyRect(index: number): { x: number; y: number; w: number; h: number } {
    const col = index % this.keyboardCols;
    const row = Math.trunc(index / this.keyboardCols);
    const keysH = Math.max(1, this.keyboardBox.h - UI_KB_TEXT_H);
    return {
      x: this.keyboardBox.x + Math.trunc((col * this.keyboardBox.w) / this.keyboardCols),
      y: this.keyboardBox.y + UI_KB_TEXT_H + Math.trunc((row * keysH) / Math.max(1, this.keyboardRows)),
      w: Math.trunc(this.keyboardBox.w / this.keyboardCols),
      h: Math.trunc(keysH / Math.max(1, this.keyboardRows)),
    };
  }

  private keyboardHandleTouch(tx: number, ty: number): void {
    this.keyboardPressedKey = -1;
    for (let i = 0; i < this.keyboardKeys.length; i++) {
      const key = this.keyboardKeys[i];
      if (key.special === 255) continue;
      const rect = this.keyboardKeyRect(i);
      if (tx < rect.x || tx >= rect.x + rect.w || ty < rect.y || ty >= rect.y + rect.h) continue;
      this.keyboardPressedKey = i;
      this.keyboardRepaintKey = i;
      this.keyboardDirty = 2;
      if (key.special === 2) {
        this.keyboardBackspaceHeld = true;
        this.keyboardBackspaceRepeat = Date.now();
        this.keyboardDelete();
      }
      return;
    }
  }

  private keyboardHandleTap(): void {
    const keyIndex = this.keyboardPressedKey;
    this.keyboardBackspaceHeld = false;
    if (keyIndex < 0) return;
    const key = this.keyboardKeys[keyIndex];
    this.keyboardPressedKey = -1;

    switch (key.special) {
      case 0: {
        const wasShift = this.keyboardShift;
        let ch = key.ch.slice(0, 1);
        if (this.keyboardShift && ch >= "a" && ch <= "z") ch = ch.toUpperCase();
        this.keyboardInsert(ch);
        this.keyboardShift = false;
        this.keyboardRepaintKey = wasShift ? -1 : keyIndex;
        this.keyboardDirty = wasShift ? 1 : 2;
        break;
      }
      case 1:
        this.keyboardShift = !this.keyboardShift;
        this.keyboardDirty = 1;
        break;
      case 2:
        this.keyboardRepaintKey = keyIndex;
        this.keyboardDirty = 2;
        break;
      case 3:
        this.keyboardClose();
        break;
      case 4:
        this.keyboardSwapPage();
        break;
    }
  }

  private keyboardInsert(ch: string): void {
    if (!ch || this.keyboardBuffer.length >= this.keyboardMaxLen) return;
    this.keyboardBuffer = clampText(this.keyboardBuffer + ch).slice(0, this.keyboardMaxLen);
  }

  private keyboardDelete(): void {
    if (this.keyboardBuffer.length === 0) return;
    this.keyboardBuffer = this.keyboardBuffer.slice(0, -1);
  }

  private keyboardTick(now: number): void {
    if (!this.keyboardBackspaceHeld) return;
    if (now - this.keyboardBackspaceRepeat < UI_KB_REPEAT_MS) return;
    this.keyboardDelete();
    this.keyboardBackspaceRepeat = now;
    this.keyboardRepaintKey = this.keyboardPressedKey;
    this.keyboardDirty = 2;
  }

  private keyboardSwapPage(): void {
    const previousTarget = this.keyboardTarget;
    const template = this.keyboardCols <= 4 ? DEFAULT_ALPHA_KEYBOARD : DEFAULT_NUMBER_KEYBOARD;
    const cols = Math.max(...template.rows.map((row) => row.length));
    this.keyboardRows = template.rows.length;
    this.keyboardCols = Math.max(1, cols);
    this.keyboardBg = resolveKeyboardBackground(template, this.snapshot.cssRules ?? []);
    this.keyboardKeys = [];
    for (const row of template.rows) {
      for (const key of row) {
        this.keyboardKeys.push({
          ch: key.ch,
          special: key.special,
          style: resolveKeyStyle(key, template, this.snapshot.cssRules ?? []),
        });
      }
      for (let p = row.length; p < this.keyboardCols; p++) {
        this.keyboardKeys.push({
          ch: " ",
          special: 255,
          style: { bg: DEFAULT_KEY_BG, fg: DEFAULT_KEY_FG, borderColor: DEFAULT_KEY_BORDER },
        });
      }
    }
    this.keyboardTarget = previousTarget;
    this.keyboardComputeBox();
    this.keyboardDirty = 1;
  }

  private keyboardLabel(key: PreviewKey): string {
    switch (key.special) {
      case 1: return "SHIFT";
      case 2: return "DEL";
      case 3: return "OK";
      case 4: return this.keyboardCols <= 4 ? "ABC" : "123";
      default: {
        const ch = key.ch.slice(0, 1);
        return this.keyboardShift && ch >= "a" && ch <= "z" ? ch.toUpperCase() : ch;
      }
    }
  }

  private drawKeyboardTextRow(): void {
    this.gfx.fillRect(this.keyboardBox.x, this.keyboardBox.y, this.keyboardBox.w, UI_KB_TEXT_H, this.keyboardBg);
    this.gfx.setCursor(this.keyboardBox.x + 4, this.keyboardBox.y + 4);
    this.gfx.setTextColor(0xffff, this.keyboardBg);
    this.gfx.setTextSize(2);
    this.gfx.print(this.keyboardBuffer);
    this.gfx.print("_");
  }

  private drawKeyboardKey(index: number): void {
    const key = this.keyboardKeys[index];
    if (!key || key.special === 255) return;
    const rect = this.keyboardKeyRect(index);
    let bg = key.style.bg;
    let fg = key.style.fg;
    if (key.special === 1 && this.keyboardShift && index !== this.keyboardPressedKey) bg = 0xbdf7;
    if (index === this.keyboardPressedKey) {
      const previousBg = bg;
      bg = fg;
      fg = previousBg;
    }

    this.gfx.fillRect(rect.x + 1, rect.y + 1, Math.max(0, rect.w - 2), Math.max(0, rect.h - 2), bg);
    this.gfx.drawRect(rect.x + 1, rect.y + 1, Math.max(0, rect.w - 2), Math.max(0, rect.h - 2), key.style.borderColor);
    const label = this.keyboardLabel(key);
    this.gfx.setCursor(rect.x + Math.max(2, Math.trunc((rect.w - label.length * 6) / 2)), rect.y + Math.trunc(rect.h / 2) - 4);
    this.gfx.setTextColor(fg, bg);
    this.gfx.setTextSize(1);
    this.gfx.print(label);
  }

  private drawKeyboard(): void {
    this.gfx.fillRect(this.keyboardBox.x, this.keyboardBox.y, this.keyboardBox.w, this.keyboardBox.h, this.keyboardBg);
    this.drawKeyboardTextRow();
    for (let i = 0; i < this.keyboardKeys.length; i++) {
      this.drawKeyboardKey(i);
    }
  }

  private dispatch(kind: "click" | "hold" | "release" | "change", nodeIndex: number): void {
    for (const callback of this.callbacks) {
      if (callback.nodeIndex === nodeIndex && callback.kind === kind) {
        this.runBody(callback.body);
      }
    }
  }

  private setPressed(nodeIndex: number, pressed: boolean): void {
    const node = this.nodes[nodeIndex];
    node.value = pressed ? 1 : 0;
    this.markDirty(nodeIndex);
    for (const transition of this.transitions) {
      if (transition.node !== nodeIndex) continue;
      transition.prevValue = transition.prop === "color" ? node.fg : node.bg;
      transition.targetValue = pressed ? transition.pressedTarget : transition.baseTarget;
      transition.elapsed = 0;
      transition.active = true;
    }
  }

  private uiOnPress(nodeIndex: number): void {
    this.setPressed(nodeIndex, true);
  }

  private uiOnRelease(nodeIndex: number): void {
    this.setPressed(nodeIndex, false);
  }

  private markDirty(nodeIndex: number): void {
    if (!this.nodes[nodeIndex]) return;
    this.nodes[nodeIndex].dirty = true;
    this.markOverlappingHigherLayersDirty(nodeIndex);
  }

  private scriptTreeNames(): string[] {
    const validIdentifier = /^[$A-Z_a-z][$\w]*$/;
    const seen = new Set<string>();
    const names: string[] = [];
    for (const name of this.snapshot.uiTreeNames ?? []) {
      if (!validIdentifier.test(name) || name === "screen" || name === "ui" || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    return names;
  }

  private normalizeScript(text: string): string {
    let out = text
      .replace(/\(([$A-Z_a-z][$\w]*)\s+as\s+any\)/g, "$1")
      .replace(/\b([$A-Z_a-z][$\w]*)\s+as\s+any\b/g, "$1")
      .replace(/\b([$A-Z_a-z][$\w]*)\s+as\s+const\b/g, "$1");
    // Rewrite bare references to module-scoped variables into moduleScope.NAME
    // so reads/writes hit the shared mutable binding (mirrors the device hoisting
    // them to globals). Skip property accesses (foo.bar) so `screen.gauge.value`
    // etc. are untouched. Identifiers are the exact, finite set of module vars.
    const names = this.moduleVarNames();
    if (names.length) {
      const alt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      const re = new RegExp(`(?<![\\w.$])\\b(${alt})\\b(?!\\s*:)`, "g");
      out = out.replace(re, "moduleScope.$1");
    }
    return out;
  }

  private scriptValues(aliases: string[], locals: Record<string, unknown> = {}): unknown[] {
    return [this.screen, this.createUiFacade(), this.moduleScope, ...aliases.map(() => this.screen), ...Object.values(locals)];
  }

  private listLocal(param: string | undefined, row: number): Record<string, unknown> {
    return param ? { [param]: row } : {};
  }

  private evaluateExpression(expression: string | undefined, locals: Record<string, unknown> = {}): unknown {
    if (!expression) return undefined;
    const aliases = this.scriptTreeNames();
    const localNames = Object.keys(locals).filter((name) => /^[$A-Z_a-z][$\w]*$/.test(name));
    const localValues = Object.fromEntries(localNames.map((name) => [name, locals[name]]));
    const normalized = this.normalizeScript(expression);
    try {
      return Function("screen", "ui", "moduleScope", ...aliases, ...localNames, `"use strict"; return (${normalized});`)(...this.scriptValues(aliases, localValues));
    } catch (error) {
      this.onDiagnostics?.(`Preview expression failed: ${expression} (${error instanceof Error ? error.message : String(error)})`);
      return undefined;
    }
  }

  private runBody(body: string | undefined, locals: Record<string, unknown> = {}): void {
    if (!body) return;
    const aliases = this.scriptTreeNames();
    const localNames = Object.keys(locals).filter((name) => /^[$A-Z_a-z][$\w]*$/.test(name));
    const localValues = Object.fromEntries(localNames.map((name) => [name, locals[name]]));
    const normalized = this.normalizeScript(body);
    try {
      Function("screen", "ui", "moduleScope", ...aliases, ...localNames, `"use strict"; ${normalized}`)(...this.scriptValues(aliases, localValues));
    } catch (error) {
      this.onDiagnostics?.(`Preview callback failed: ${body} (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  private createUiFacade(): { signal<T>(initial: T): (() => T) & { set(next: T): void }; navigate(screenIdx: number): void } {
    return {
      signal<T>(initial: T) {
        let value = initial;
        const fn = (() => value) as (() => T) & { set(next: T): void };
        fn.set = (next: T) => { value = next; };
        return fn;
      },
      navigate: (screenIdx: number) => this.navigate(screenIdx),
    };
  }
}

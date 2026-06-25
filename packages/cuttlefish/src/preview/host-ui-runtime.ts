import { resolveColor } from "../ui/color.js";
import { DEFAULT_ALPHA_KEYBOARD, DEFAULT_NUMBER_KEYBOARD } from "../ui/default-keyboards.js";
import type { CSSProperty, CSSRule } from "../ui/css-parser.js";
import type { UIFontAssetModel, UIFontGlyphModel } from "../ui/font-assets.js";
import type { KeyboardTemplate, UIKeyTemplate } from "../ui/html-parser.js";
import type { UINodeModel, UIProgram, UITransitionModel } from "../ui/model.js";
import { blendRgb565, HostAdafruitGFX } from "./host-gfx.js";
import type {
  PreviewBindingSpec,
  PreviewCallbackSpec,
  PreviewInitialAssignment,
  PreviewIntervalSpec,
  PreviewPinControlSpec,
  PreviewSnapshot,
} from "./types.js";

const UI_TEXT_BUF = 32;
const UI_TOUCH_DEBOUNCE_MS = 50;
const UI_TOUCH_HOLD_MS = 600;
const UI_DRAG_THRESHOLD = 10;
const UI_KB_REPEAT_MS = 100;
const UI_KB_TEXT_H = 24;

const DEFAULT_KEY_BG = 0x4208;
const DEFAULT_KEY_FG = 0xffff;
const DEFAULT_KEY_BORDER = 0xffff;
const DEFAULT_KB_BG = 0x0000;

type MutableNode = UINodeModel;
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

function cloneProgram(program: UIProgram): { nodes: MutableNode[]; transitions: UITransitionModel[] } {
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
      value: node.value,
    })),
    transitions: program.transitions.map((transition) => ({ ...transition, active: false, elapsed: 0 })),
  };
}

export class PreviewUIRuntime {
  readonly gfx: HostAdafruitGFX;
  readonly screen: ScreenProxy = {};
  private readonly nodes: MutableNode[];
  private readonly transitions: UITransitionModel[];
  private readonly fontAssets: UIFontAssetModel[];
  private readonly bindings: PreviewBindingSpec[];
  private readonly callbacks: PreviewCallbackSpec[];
  private readonly pinControls: PreviewPinControlSpec[];
  private readonly intervals: PreviewIntervalSpec[];
  private readonly initialAssignments: PreviewInitialAssignment[];
  private readonly onFrame?: (rgba: Uint8ClampedArray) => void;
  private readonly onDiagnostics?: (message: string) => void;
  private readonly screenCount: number;
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private activeScreen = 0;
  private touchState = 0;
  private touchNode = -1;
  private touchDownTime = 0;
  private lastTouchTime = -UI_TOUCH_DEBOUNCE_MS;
  private lastReleaseTime = -UI_TOUCH_DEBOUNCE_MS;
  private lastTickTime = Date.now();
  private dragStartX = 0;
  private dragStartY = 0;
  private isDragging = false;
  private scrollNode = -1;
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
    const { nodes, transitions } = cloneProgram(snapshot.program);
    this.nodes = nodes;
    this.transitions = transitions;
    this.fontAssets = snapshot.program.fontAssets ?? [];
    this.bindings = snapshot.bindings;
    this.callbacks = snapshot.callbacks;
    this.pinControls = snapshot.pinControls;
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
  }

  private isActiveNode(node: MutableNode): boolean {
    return (node.screenId ?? 0) === this.activeScreen;
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
  }

  private advanceTransitions(deltaMs: number): void {
    for (const transition of this.transitions) {
      if (!transition.active) continue;
      transition.elapsed += deltaMs;
      const k = transition.durationMs <= 0
        ? 100
        : Math.trunc((transition.elapsed * 100) / transition.durationMs);
      const value = lerpColor(transition.prevValue, transition.targetValue, k);
      if (transition.prop === "color") this.nodes[transition.node].fg = value;
      else this.nodes[transition.node].bg = value;
      this.markDirty(transition.node);
      if (k >= 100) transition.active = false;
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
      if (this.nodes[parent].scrollable) y -= this.nodes[parent].scrollY;
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
    this.gfx.fillRect(x0, y0, x1 - x0, y1 - y0, this.parentClearColor(node));
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

  private clearDirtyScrollViewports(): boolean {
    let changed = false;
    for (const node of this.nodes) {
      if (!this.isActiveNode(node)) continue;
      if (!node.scrollable || !node.visible || node.contentHeight <= node.box.h) continue;
      if (node.dirty) {
        this.markScrollDescendantsDirty(node.index);
        for (let i = node.index; i < node.subtreeEnd; i++) {
          if (this.nodes[i]?.kind === "progress") this.nodes[i].lastTextWidth = -1;
          else if (this.nodes[i]?.kind === "range") this.nodes[i].lastTextWidth = -1;
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
      if (!node.scrollable || node.contentHeight <= node.box.h) continue;
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
        if (r > 0) this.gfx.drawRoundRect(rx, ry, rw, rh, r, color);
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

  private drawNodeBorder(node: MutableNode, drawY: number, color: number): void {
    this.drawRectOutline(node.box.x, drawY, node.box.w, node.box.h, node.borderRadius, node.borderStyle, node.borderWidth, color);
  }

  private drawNodeOutline(node: MutableNode, drawY: number): void {
    if (!node.outlineStyle || !node.outlineWidth) return;
    const w = node.outlineWidth;
    this.drawRectOutline(node.box.x - w, drawY - w, node.box.w + 2 * w, node.box.h + 2 * w, node.borderRadius + w, node.outlineStyle, w, node.outlineColor);
  }

  private markScrollDescendantsDirty(nodeIndex: number): void {
    const node = this.nodes[nodeIndex];
    for (let i = nodeIndex + 1; i < node.subtreeEnd; i++) {
      if (this.nodes[i]) this.markDirty(i);
    }
    this.markDirty(nodeIndex);
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
      if (this.isActiveNode(node) && node.scrollable && node.dirty) scrollbarDirty.add(node.index);
    }
    for (const node of this.nodes) {
      if (!node.dirty) continue;
      if (!node.visible) continue;
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
      const tw = this.textWidth(displayText, ts, node.fontFace, node.letterSpacing);
      let textX = node.box.x;
      if (node.textAlign === 1) textX = node.box.x + Math.trunc((node.box.w - tw) / 2);
      else if (node.textAlign === 2) textX = node.box.x + node.box.w - tw;
      let bColor = node.borderColor || node.fg;
      if (node.opacity < 100) bColor = blendRgb565(bColor, node.clearColor, node.opacity);

      this.gfx.withClipRect(scrollClip, () => {
        node.box.x = baseX;
        this.drawNodeShadow(node, baseY, false);
        node.box.x = drawX;
        switch (node.kind) {
          case "fill":
            if (node.gradientEnabled > 0) this.drawGradientFill(node, drawY);
            else if (node.borderRadius > 0 && node.hasBg) this.gfx.fillRoundRect(node.box.x, drawY, node.box.w, node.box.h, node.borderRadius, node.bg);
            else if (node.hasBg) this.gfx.fillRect(node.box.x, drawY, node.box.w, node.box.h, node.bg);
            this.drawNodeShadow(node, drawY, true);
            if (node.borderStyle) this.drawNodeBorder(node, drawY, bColor);
            break;
          case "text":
            this.drawTextNode(node, displayText, tw, textX, drawY, ts);
            break;
          case "button":
            this.drawButtonNode(node, displayText, tw, bColor, drawY, ts);
            break;
          case "check":
            this.drawCheckNode(node, displayText, tw, drawY, ts);
            break;
          case "radio":
            this.drawRadioNode(node, displayText, tw, drawY, ts);
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
        }
        this.drawNodeOutline(node, drawY);
      });
      changed = true;
      node.box.x = origBoxX;
      node.dirty = false;
    }
    return this.drawScrollbars(scrollbarDirty) || changed;
  }

  private drawTextNode(node: MutableNode, displayText: string | undefined, tw: number, textX: number, drawY: number, ts: number): void {
    const clearW = Math.max(node.box.w, node.lastTextWidth);
    const clearH = Math.max(node.box.h, this.textHeight(ts, node.fontFace));
    this.gfx.fillRect(node.box.x, drawY, clearW, clearH, node.hasBg ? node.bg : node.clearColor);
    node.lastTextWidth = tw;
    const textClear = node.hasBg ? node.bg : node.clearColor;
    if (node.textShadowCount > 0) {
      const shadowColor = blendRgb565(node.textShadowColor, textClear, node.textShadowAlpha);
      this.drawText(
        displayText,
        textX + node.textShadowOffsetX,
        drawY + node.textShadowOffsetY,
        shadowColor,
        shadowColor,
        ts,
        node.fontAntialias,
        node.fontFace,
        node.letterSpacing,
      );
    }
    this.drawText(displayText, textX, drawY, node.fg, textClear, ts, node.fontAntialias, node.fontFace, node.letterSpacing);
    if (node.underline) this.gfx.drawFastHLine(textX, drawY + this.textHeight(ts, node.fontFace) - 1, tw, node.fg);
  }

  private drawButtonNode(node: MutableNode, displayText: string | undefined, tw: number, bColor: number, drawY: number, ts: number): void {
    if (node.borderRadius > 0 && node.hasBg) this.gfx.fillRoundRect(node.box.x, drawY, node.box.w, node.box.h, node.borderRadius, node.bg);
    else if (node.hasBg) this.gfx.fillRect(node.box.x, drawY, node.box.w, node.box.h, node.bg);
    this.drawNodeShadow(node, drawY, true);
    if (node.borderStyle) this.drawNodeBorder(node, drawY, bColor);
    this.drawText(
      displayText,
      node.box.x + Math.trunc((node.box.w - tw) / 2),
      drawY + Math.trunc((node.box.h - this.textHeight(ts, node.fontFace)) / 2),
      node.fg,
      node.hasBg ? node.bg : node.clearColor,
      ts,
      node.fontAntialias,
      node.fontFace,
      node.letterSpacing,
    );
  }

  private drawCheckNode(node: MutableNode, displayText: string | undefined, tw: number, drawY: number, ts: number): void {
    const clearW = Math.max(node.box.w, node.lastTextWidth);
    this.gfx.fillRect(node.box.x, drawY, clearW, node.box.h, node.hasBg ? node.bg : node.clearColor);
    node.lastTextWidth = tw;

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
    this.drawText(displayText, node.box.x + 22, drawY, node.fg, node.hasBg ? node.bg : node.clearColor, ts, node.fontAntialias, node.fontFace, node.letterSpacing);
  }

  private drawRadioNode(node: MutableNode, displayText: string | undefined, tw: number, drawY: number, ts: number): void {
    const clearW = Math.max(node.box.w, node.lastTextWidth);
    this.gfx.fillRect(node.box.x, drawY, clearW, node.box.h, node.hasBg ? node.bg : node.clearColor);
    node.lastTextWidth = tw;

    const cbX = node.box.x;
    const cbY = drawY;
    if (node.value) {
      this.gfx.fillCircle(cbX + 8, cbY + 8, 7, node.fg);
      this.gfx.fillCircle(cbX + 8, cbY + 8, 3, node.hasBg ? node.bg : node.clearColor);
    } else {
      this.gfx.drawCircle(cbX + 8, cbY + 8, 7, node.fg);
    }
    this.drawText(displayText, node.box.x + 22, drawY, node.fg, node.hasBg ? node.bg : node.clearColor, ts, node.fontAntialias, node.fontFace, node.letterSpacing);
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
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      if (!node.visible) continue;
      if (!this.isActiveNode(node)) continue;
      const drawX = this.drawXForNode(i);
      const drawY = this.drawYForNode(i);
      if (this.isClippedByScroll(i, drawX, drawY)) continue;
      if (tx >= drawX && tx < drawX + node.box.w && ty >= drawY && ty < drawY + node.box.h) {
        if (this.hasAnyHandler(i)) return i;
      }
    }
    return -1;
  }

  private findScrollNode(tx: number, ty: number): number {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      if (!this.isActiveNode(node)) continue;
      if (!node.scrollable || !node.visible || node.contentHeight <= node.box.h) continue;
      const drawX = this.drawXForNode(i);
      const drawY = this.drawYForNode(i);
      if (tx >= drawX && tx < drawX + node.box.w && ty >= drawY && ty < drawY + node.box.h) {
        return i;
      }
    }
    return -1;
  }

  private hasAnyHandler(nodeIndex: number): boolean {
    const node = this.nodes[nodeIndex];
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

  private handleTouch(tx: number, ty: number): void {
    const now = Date.now();
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
      if (this.isDragging && this.scrollNode >= 0) {
        const dy = ty - this.dragStartY;
        this.dragStartX = tx;
        this.dragStartY = ty;
        const node = this.nodes[this.scrollNode];
        const maxScroll = Math.max(0, node.contentHeight - node.box.h);
        const nextScrollY = Math.max(0, Math.min(maxScroll, node.scrollY - dy));
        if (nextScrollY !== node.scrollY) {
          node.scrollY = nextScrollY;
          this.markScrollDescendantsDirty(this.scrollNode);
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
    if (node >= 0 && !this.isDragging) {
      if (elapsed < UI_TOUCH_HOLD_MS) {
        this.dispatchBuiltInClick(node);
        this.dispatch("click", node);
      }
      this.dispatch("release", node);
      if (this.nodes[node].kind === "button") this.setPressed(node, false);
      this.markDirty(node);
    }
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
    if (this.nodes[nodeIndex]) this.nodes[nodeIndex].dirty = true;
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
    return text
      .replace(/\(([$A-Z_a-z][$\w]*)\s+as\s+any\)/g, "$1")
      .replace(/\b([$A-Z_a-z][$\w]*)\s+as\s+any\b/g, "$1")
      .replace(/\b([$A-Z_a-z][$\w]*)\s+as\s+const\b/g, "$1");
  }

  private scriptValues(aliases: string[]): unknown[] {
    return [this.screen, this.createUiFacade(), ...aliases.map(() => this.screen)];
  }

  private evaluateExpression(expression: string | undefined): unknown {
    if (!expression) return undefined;
    const aliases = this.scriptTreeNames();
    const normalized = this.normalizeScript(expression);
    try {
      return Function("screen", "ui", ...aliases, `"use strict"; return (${normalized});`)(...this.scriptValues(aliases));
    } catch (error) {
      this.onDiagnostics?.(`Preview expression failed: ${expression} (${error instanceof Error ? error.message : String(error)})`);
      return undefined;
    }
  }

  private runBody(body: string | undefined): void {
    if (!body) return;
    const aliases = this.scriptTreeNames();
    const normalized = this.normalizeScript(body);
    try {
      Function("screen", "ui", ...aliases, `"use strict"; ${normalized}`)(...this.scriptValues(aliases));
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

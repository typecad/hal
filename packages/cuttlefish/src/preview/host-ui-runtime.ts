import { resolveColor } from "../ui/color.js";
import type { UINodeModel, UIProgram, UITransitionModel } from "../ui/model.js";
import { HostAdafruitGFX } from "./host-gfx.js";
import type {
  PreviewBindingSpec,
  PreviewCallbackSpec,
  PreviewInitialAssignment,
  PreviewIntervalSpec,
  PreviewPinControlSpec,
  PreviewSnapshot,
} from "./types.js";

const UI_TEXT_BUF = 16;
const UI_TOUCH_DEBOUNCE_MS = 50;
const UI_TOUCH_HOLD_MS = 600;
const UI_DRAG_THRESHOLD = 10;

type MutableNode = UINodeModel;
type ScreenProxy = Record<string, { value: number; onClick(): void; onHold(): void; onRelease(): void }>;

interface RuntimeOptions {
  onFrame?: (rgba: Uint8ClampedArray) => void;
  onDiagnostics?: (message: string) => void;
}

function clampText(text: unknown): string {
  return String(text ?? "").slice(0, UI_TEXT_BUF - 1);
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

function cloneProgram(program: UIProgram): { nodes: MutableNode[]; transitions: UITransitionModel[] } {
  return {
    nodes: program.nodes.map((node) => ({
      ...node,
      box: { ...node.box },
      classes: [...node.classes],
      options: node.options?.map((option) => ({ ...option })),
      dirty: false,
      textBuffer: "",
      hasTextBinding: false,
      lastTextWidth: node.kind === "range" ? -1 : 0,
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
  private readonly bindings: PreviewBindingSpec[];
  private readonly callbacks: PreviewCallbackSpec[];
  private readonly pinControls: PreviewPinControlSpec[];
  private readonly intervals: PreviewIntervalSpec[];
  private readonly initialAssignments: PreviewInitialAssignment[];
  private readonly onFrame?: (rgba: Uint8ClampedArray) => void;
  private readonly onDiagnostics?: (message: string) => void;
  private readonly timers: ReturnType<typeof setInterval>[] = [];
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

  constructor(private readonly snapshot: PreviewSnapshot, options: RuntimeOptions = {}) {
    const { nodes, transitions } = cloneProgram(snapshot.program);
    this.nodes = nodes;
    this.transitions = transitions;
    this.bindings = snapshot.bindings;
    this.callbacks = snapshot.callbacks;
    this.pinControls = snapshot.pinControls;
    this.intervals = snapshot.intervals;
    this.initialAssignments = snapshot.initialAssignments;
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
      Object.defineProperty(this.screen, node.id, {
        enumerable: true,
        value: {
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
        },
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
      this.nodes[transition.node].bg = value;
      this.markDirty(transition.node);
      if (k >= 100) transition.active = false;
    }
  }

  private drawYForNode(nodeIndex: number): number {
    let y = this.nodes[nodeIndex].box.y;
    let parent = this.nodes[nodeIndex].parentIndex;
    while (parent >= 0 && this.nodes[parent]) {
      if (this.nodes[parent].scrollable) y -= this.nodes[parent].scrollY;
      parent = this.nodes[parent].parentIndex;
    }
    return y;
  }

  private isClippedByScroll(nodeIndex: number, drawY: number): boolean {
    const node = this.nodes[nodeIndex];
    let parent = node.parentIndex;
    while (parent >= 0 && this.nodes[parent]) {
      const scrollParent = this.nodes[parent];
      if (
        scrollParent.scrollable &&
        (node.box.x < scrollParent.box.x ||
          node.box.x + node.box.w > scrollParent.box.x + scrollParent.box.w ||
          drawY < scrollParent.box.y ||
          drawY + node.box.h > scrollParent.box.y + scrollParent.box.h)
      ) {
        return true;
      }
      parent = scrollParent.parentIndex;
    }
    return false;
  }

  private clearDirtyScrollViewports(): boolean {
    let changed = false;
    for (const node of this.nodes) {
      if (!node.scrollable || !node.visible || node.contentHeight <= node.box.h) continue;
      if (node.dirty) {
        this.markScrollDescendantsDirty(node.index);
        for (let i = node.index; i < node.subtreeEnd; i++) {
          if (this.nodes[i]?.kind === "progress") this.nodes[i].lastTextWidth = 0;
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

  private markScrollDescendantsDirty(nodeIndex: number): void {
    const node = this.nodes[nodeIndex];
    for (let i = nodeIndex + 1; i < node.subtreeEnd; i++) {
      if (this.nodes[i]) this.markDirty(i);
    }
    this.markDirty(nodeIndex);
  }

  private drawDirty(): boolean {
    let changed = this.clearDirtyScrollViewports();
    const scrollbarDirty = new Set<number>();
    for (const node of this.nodes) {
      if (node.scrollable && node.dirty) scrollbarDirty.add(node.index);
    }
    for (const node of this.nodes) {
      if (!node.dirty) continue;
      if (!node.visible) continue;
      const drawY = this.drawYForNode(node.index);
      if (this.isClippedByScroll(node.index, drawY)) {
        node.dirty = false;
        continue;
      }

      const displayText = node.hasTextBinding ? node.textBuffer : node.text;
      const tw = displayText ? displayText.length * 12 : 0;
      let textX = node.box.x;
      if (node.textAlign === 1) textX = node.box.x + Math.trunc((node.box.w - tw) / 2);
      else if (node.textAlign === 2) textX = node.box.x + node.box.w - tw;
      const bColor = node.borderColor || node.fg;

      switch (node.kind) {
        case "fill":
          if (node.hasBg) this.gfx.fillRect(node.box.x, drawY, node.box.w, node.box.h, node.bg);
          if (node.borderStyle === 1) this.gfx.drawRect(node.box.x, drawY, node.box.w, node.box.h, bColor);
          break;
        case "text":
          this.drawTextNode(node, displayText, tw, textX, drawY);
          break;
        case "button":
          this.drawButtonNode(node, displayText, tw, bColor, drawY);
          break;
        case "check":
          this.drawCheckNode(node, displayText, tw, drawY);
          break;
        case "radio":
          this.drawRadioNode(node, displayText, tw, drawY);
          break;
        case "progress":
          this.drawProgressNode(node, drawY);
          break;
        case "range":
          this.drawRangeNode(node, drawY);
          break;
      }
      changed = true;
      node.dirty = false;
    }
    return this.drawScrollbars(scrollbarDirty) || changed;
  }

  private drawTextNode(node: MutableNode, displayText: string | undefined, tw: number, textX: number, drawY: number): void {
    const clearW = Math.max(node.box.w, node.lastTextWidth);
    this.gfx.fillRect(node.box.x, drawY, clearW, node.box.h, node.hasBg ? node.bg : node.clearColor);
    node.lastTextWidth = tw;
    this.gfx.setCursor(textX, drawY);
    this.gfx.setTextColor(node.fg);
    this.gfx.setTextSize(2);
    this.gfx.print(displayText ?? "");
    if (node.underline) this.gfx.drawFastHLine(textX, drawY + 15, tw, node.fg);
  }

  private drawButtonNode(node: MutableNode, displayText: string | undefined, tw: number, bColor: number, drawY: number): void {
    if (node.hasBg) this.gfx.fillRect(node.box.x, drawY, node.box.w, node.box.h, node.bg);
    if (node.borderStyle === 1) {
      this.gfx.drawRect(node.box.x, drawY, node.box.w, node.box.h, bColor);
    } else if (node.borderStyle === 2) {
      for (let dx = 0; dx < node.box.w; dx += 8) this.gfx.drawFastHLine(node.box.x + dx, drawY, 4, bColor);
      for (let dx = 0; dx < node.box.w; dx += 8) this.gfx.drawFastHLine(node.box.x + dx, drawY + node.box.h - 1, 4, bColor);
      for (let dy = 0; dy < node.box.h; dy += 8) this.gfx.drawFastVLine(node.box.x, drawY + dy, 4, bColor);
      for (let dy = 0; dy < node.box.h; dy += 8) this.gfx.drawFastVLine(node.box.x + node.box.w - 1, drawY + dy, 4, bColor);
    }
    this.gfx.setCursor(node.box.x + Math.trunc((node.box.w - tw) / 2), drawY + Math.trunc((node.box.h - 16) / 2));
    this.gfx.setTextColor(node.fg);
    this.gfx.setTextSize(2);
    this.gfx.print(displayText ?? "");
  }

  private drawCheckNode(node: MutableNode, displayText: string | undefined, tw: number, drawY: number): void {
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
    this.gfx.setCursor(node.box.x + 22, drawY);
    this.gfx.setTextColor(node.fg);
    this.gfx.setTextSize(2);
    this.gfx.print(displayText ?? "");
  }

  private drawRadioNode(node: MutableNode, displayText: string | undefined, tw: number, drawY: number): void {
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
    this.gfx.setCursor(node.box.x + 22, drawY);
    this.gfx.setTextColor(node.fg);
    this.gfx.setTextSize(2);
    this.gfx.print(displayText ?? "");
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

    if (prevW === 0) {
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

  private hitTest(tx: number, ty: number): number {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      if (!node.visible) continue;
      const drawY = this.drawYForNode(i);
      if (this.isClippedByScroll(i, drawY)) continue;
      if (tx >= node.box.x && tx < node.box.x + node.box.w && ty >= drawY && ty < drawY + node.box.h) {
        if (this.hasAnyHandler(i)) return i;
      }
    }
    return -1;
  }

  private findScrollNode(tx: number, ty: number): number {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      if (!node.scrollable || !node.visible || node.contentHeight <= node.box.h) continue;
      const drawY = this.drawYForNode(i);
      if (tx >= node.box.x && tx < node.box.x + node.box.w && ty >= drawY && ty < drawY + node.box.h) {
        return i;
      }
    }
    return -1;
  }

  private hasAnyHandler(nodeIndex: number): boolean {
    const node = this.nodes[nodeIndex];
    if (node.kind === "range") return true;
    if (node.tag === "check" || node.tag === "select" || node.tag === "radio") return true;
    return this.callbacks.some((callback) => callback.nodeIndex === nodeIndex);
  }

  private updateRangeValue(nodeIndex: number, tx: number): void {
    const node = this.nodes[nodeIndex];
    const rangeMin = node.rangeMin;
    const rangeMax = node.rangeMax;
    const range = rangeMax > rangeMin ? rangeMax - rangeMin : 100;
    const usable = Math.max(1, node.box.w - 8);
    const relX = tx - node.box.x - 4;
    const next = Math.max(rangeMin, Math.min(rangeMax, rangeMin + Math.trunc((relX * range) / usable)));
    if (next !== node.value) {
      node.value = next;
      this.markDirty(nodeIndex);
    }
  }

  private handleTouch(tx: number, ty: number): void {
    const now = Date.now();
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
        if (this.nodes[node].kind === "button") this.nodes[node].value = 1;
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
    const elapsed = now - this.touchDownTime;
    const node = this.touchNode;
    if (node >= 0 && !this.isDragging) {
      if (elapsed < UI_TOUCH_HOLD_MS) {
        this.dispatchBuiltInClick(node);
        this.dispatch("click", node);
      }
      this.dispatch("release", node);
      if (this.nodes[node].kind === "button") this.nodes[node].value = 0;
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
        if (candidate.tag === "radio" && candidate.name && candidate.name === node.name) {
          candidate.value = 0;
          this.markDirty(candidate.index);
        }
      }
      node.value = 1;
      this.markDirty(nodeIndex);
    }
  }

  private dispatch(kind: "click" | "hold" | "release", nodeIndex: number): void {
    for (const callback of this.callbacks) {
      if (callback.nodeIndex === nodeIndex && callback.kind === kind) {
        this.runBody(callback.body);
      }
    }
  }

  private uiOnPress(nodeIndex: number): void {
    const node = this.nodes[nodeIndex];
    node.value = 1;
    this.markDirty(nodeIndex);
    for (const transition of this.transitions) {
      if (transition.node !== nodeIndex) continue;
      transition.prevValue = node.bg;
      transition.targetValue = transition.pressedTarget;
      transition.elapsed = 0;
      transition.active = true;
    }
  }

  private uiOnRelease(nodeIndex: number): void {
    const node = this.nodes[nodeIndex];
    node.value = 0;
    this.markDirty(nodeIndex);
    for (const transition of this.transitions) {
      if (transition.node !== nodeIndex) continue;
      transition.prevValue = node.bg;
      transition.targetValue = transition.baseTarget;
      transition.elapsed = 0;
      transition.active = true;
    }
  }

  private markDirty(nodeIndex: number): void {
    if (this.nodes[nodeIndex]) this.nodes[nodeIndex].dirty = true;
  }

  private evaluateExpression(expression: string | undefined): unknown {
    if (!expression) return undefined;
    try {
      return Function("screen", "ui", `"use strict"; return (${expression});`)(this.screen, this.createUiFacade());
    } catch (error) {
      this.onDiagnostics?.(`Preview expression failed: ${expression} (${error instanceof Error ? error.message : String(error)})`);
      return undefined;
    }
  }

  private runBody(body: string | undefined): void {
    if (!body) return;
    try {
      Function("screen", "ui", `"use strict"; ${body}`)(this.screen, this.createUiFacade());
    } catch (error) {
      this.onDiagnostics?.(`Preview callback failed: ${body} (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  private createUiFacade(): { signal<T>(initial: T): () => T } {
    return {
      signal<T>(initial: T) {
        let value = initial;
        const fn = (() => value) as (() => T) & { set(next: T): void };
        fn.set = (next: T) => { value = next; };
        return fn;
      },
    };
  }
}

import { decodeConn, encode, readStatus } from "./msg.ts";
import { PixelFormat } from "./pixel.ts";
import { FontRenderOptions } from "./font.ts";

interface WindowOptions {
  title: String;
  height: number;
  width: number;
  flags?: number;
  position?: number[]; // (i32, i32)
  centered?: boolean;
  fullscreen?: boolean;
  hidden?: boolean;
  resizable?: boolean;
  minimized?: boolean;
  maximized?: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface WindowEvent extends Event {
  detail?: any;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export class Canvas extends EventTarget {
  #properties: WindowOptions;
  // Used internally.
  // @deno-lint-ignore allow-any
  #tasks: any[] = [];
  // Used internally.
  // @deno-lint-ignore allow-any
  #windowTasks: any[] = [];
  // Used internally. Too lazy to type.
  // @deno-lint-ignore allow-any
  #fonts: any[] = [];

  constructor(properties: WindowOptions) {
    super();
    this.#properties = properties;
    ["centered", "fullscreen", "hidden", "resizable", "minimized", "maximized"]
      .forEach((opt) => {
        (this.#properties as any)[opt] = (this.#properties as any)[opt] ||
          false;
      });
  }

  present() {
    this.#tasks.push("present");
  }

  clear() {
    this.#tasks.push("clear");
  }

  setDrawColor(r: number, g: number, b: number, a: number) {
    this.#tasks.push({ setDrawColor: { r, g, b, a } });
  }

  setScale(x: number, y: number) {
    this.#tasks.push({ setScale: { x, y } });
  }

  drawPoint(x: number, y: number) {
    this.#tasks.push({ drawPoint: { x, y } });
  }

  drawPoints(points: Point[]) {
    this.#tasks.push({ drawPoints: { points } });
  }

  drawLine(p1: Point, p2: Point) {
    this.#tasks.push({ drawLine: { p1, p2 } });
  }

  drawLines(points: Point[]) {
    this.#tasks.push({ drawLines: { points } });
  }

  drawRect(x: number, y: number, width: number, height: number) {
    this.#tasks.push({ drawRect: { x, y, width, height } });
  }

  drawRects(rects: Rect[]) {
    this.#tasks.push({ drawRects: { rects } });
  }

  fillRect(x: number, y: number, width: number, height: number) {
    this.#tasks.push({ fillRect: { x, y, width, height } });
  }

  fillRects(rects: Rect[]) {
    this.#tasks.push({ fillRects: { rects } });
  }

  quit() {
    this.#tasks.push("quit");
  }

  setDisplayMode(
    width: number,
    height: number,
    rate: number,
    format: PixelFormat,
  ) {
    this.#windowTasks.push({ setDisplayMode: { width, height, rate, format } });
  }

  setTitle(title: string) {
    this.#windowTasks.push({ setTitle: { title } });
  }

  setIcon(icon: string) {
    this.#windowTasks.push({ setIcon: { icon } });
  }

  setPosition(x: number, y: number) {
    this.#windowTasks.push({ setPosition: { x, y } });
  }

  setSize(width: number, height: number) {
    this.#windowTasks.push({ setSize: { width, height } });
  }

  setMinimumSize(width: number, height: number) {
    this.#windowTasks.push({ setMinimumSize: { width, height } });
  }

  setBrightness(brightness: number) {
    this.#windowTasks.push({ setBrightness: { brightness } });
  }

  setOpacity(opacity: number) {
    this.#windowTasks.push({ setOpacity: { opacity } });
  }

  show() {
    this.#windowTasks.push("show");
  }

  hide() {
    this.#windowTasks.push("hide");
  }

  raise() {
    this.#windowTasks.push("raise");
  }

  maximize() {
    this.#windowTasks.push("maximise");
  }

  minimize() {
    this.#windowTasks.push("minimize");
  }

  restore() {
    this.#windowTasks.push("restore");
  }

  loadFont(path: string, size: number, opts?: { style: string }): number {
    const options = { path, size, ...opts };
    const index = this.#fonts.push(options);
    // this.#tasks.push({ loadFont: { ...options, index } });
    return index;
  }

  renderFont(
    font: number,
    text: string,
    options: FontRenderOptions,
    target?: Rect,
  ) {
    const _font = this.#fonts[font - 1];
    if (!_font) {
      throw new Error("Font not loaded. Did you forget to call `loadFont` ?");
    }
    this.#tasks.push({ renderFont: { font, text, options, target, ..._font } });
  }

  async start() {
    init(async (conn) => {
      const window = encode(this.#properties);
      await conn.write(window);

      const videoReqBuf = await readStatus(conn);

      switch (videoReqBuf) {
        case 1:
          // CANVAS_READY
          const canvas = encode({
            software: false,
          });
          await conn.write(canvas);
          // SDL event_pump
          while (true) {
            const canvasReqBuf = await readStatus(conn);

            switch (canvasReqBuf) {
              case 1:
                // WINDOW_LOOP_ACTION
                const windowTasks = encode(this.#windowTasks);
                await conn.write(windowTasks);
                this.#windowTasks = [];
                // await conn.write(new Uint8Array(1));
                break;
              case 2:
                // CANVAS_LOOP_ACTION
                const tasks = encode(this.#tasks);
                await conn.write(tasks);
                this.#tasks = [];
                await conn.write(new Uint8Array([1]));
                break;
              case 3:
                // EVENT_PUMP
                const e = await decodeConn(conn);
                const event = new CustomEvent("event", { detail: e });
                this.dispatchEvent(event);
                break;
              default:
                await conn.write(encode(["none"]));
                await conn.write(new Uint8Array([1]));
                break;
            }
          }
          break;
        // TODO(littledivy): CANVAS_ERR
        default:
          break;
      }
    });
  }
}

async function init(cb: (conn: Deno.Conn) => Promise<void>) {
  const listener = Deno.listen({ port: 34254, transport: "tcp" });
  // TODO: Spawn client process
  const process = Deno.run({ cmd: ["target/debug/deno_sdl2"] });
  console.log("listening on 0.0.0.0:34254");

  for await (const conn of listener) {
    const reqBuf = await readStatus(conn);
    switch (reqBuf) {
      case 0:
        // VIDEO_READY
        try {
          await cb(conn);
        } catch (e) {
          const status = await process.status();
          if (status.code !== 0) {
            throw e;
          } else {
            return;
          }
        }
        break;
      default:
        break;
    }
  }

  await process.status();
}
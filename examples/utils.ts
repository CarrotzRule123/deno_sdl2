export const FPS = (cap: number) => {
  let start = performance.now();
  let frames = 0;
  return () => {
    frames++;
    // setTimeout is blocked by the event loop.
    if ((performance.now() - start) >= 1000) {
      start = performance.now();
      console.log(`FPS: ${frames}`);
      frames = 0;
    }

    Deno.sleepSync(1 / cap * 1000);
  };
};

import { expect, test as base } from "@playwright/test";
import { createWorld, type World, type WorldOptions } from "./harness/world";

interface Fixtures {
  /** Per-test setup options, overridden with `test.use({ world: {...} })`. */
  world: WorldOptions;
  network: World;
}

export const test = base.extend<Fixtures>({
  world: [{}, { option: true }],
  network: [
    async ({ context, world }, use) => {
      const network = await createWorld(context, world);
      await use(network);
      // Every request must have a recorded response.
      expect(network.unrouted, "requests with no recorded response").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

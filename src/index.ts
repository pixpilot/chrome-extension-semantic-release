/**
 * The entrypoint for the action. This file simply imports and runs the action's
 * main logic.
 */
import { run } from './main.js';

// Export the run function for local-action tool
export { run };

// eslint-disable-next-line ts/no-floating-promises
run();

/**
 * This file is used to mock the `@actions/core` module in tests.
 */
import { vi } from 'vitest';

export const debug: ReturnType<typeof vi.fn> = vi.fn();
export const error: ReturnType<typeof vi.fn> = vi.fn();
export const info: ReturnType<typeof vi.fn> = vi.fn();
export const getInput: ReturnType<typeof vi.fn> = vi.fn();
export const setOutput: ReturnType<typeof vi.fn> = vi.fn();
export const setFailed: ReturnType<typeof vi.fn> = vi.fn();
export const warning: ReturnType<typeof vi.fn> = vi.fn();

/**
 * Test setup - mocks Chrome extension APIs
 */
import { vi } from 'vitest';

// Mock chrome.storage.local
const mockStorage: Record<string, unknown> = {};

globalThis.chrome = {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        if (typeof keys === 'string') {
          return { [keys]: mockStorage[keys] };
        }
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          if (key in mockStorage) {
            result[key] = mockStorage[key];
          }
        }
        return result;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(mockStorage, items);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const keysArray = typeof keys === 'string' ? [keys] : keys;
        for (const key of keysArray) {
          delete mockStorage[key];
        }
      }),
      clear: vi.fn(async () => {
        for (const key of Object.keys(mockStorage)) {
          delete mockStorage[key];
        }
      }),
    },
    session: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
    },
  },
  runtime: {
    id: 'test-extension-id',
    sendMessage: vi.fn(),
    getManifest: vi.fn(() => ({ name: 'Test', version: '1.0.0' })),
    getContexts: vi.fn(async () => []),
  },
  offscreen: {
    createDocument: vi.fn(async () => {}),
    closeDocument: vi.fn(async () => {}),
    Reason: { DOM_PARSER: 'DOM_PARSER' },
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(async () => true),
    onAlarm: {
      addListener: vi.fn(),
    },
  },
} as unknown as typeof chrome;

// Helper to clear mock storage between tests
export function clearMockStorage() {
  for (const key of Object.keys(mockStorage)) {
    delete mockStorage[key];
  }
}

// Helper to set mock storage values
export function setMockStorage(items: Record<string, unknown>) {
  Object.assign(mockStorage, items);
}

// Helper to get mock storage (for assertions)
export function getMockStorage() {
  return { ...mockStorage };
}

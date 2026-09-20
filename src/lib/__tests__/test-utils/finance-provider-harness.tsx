import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { FinanceProvider, useFinance } from '../../context/finance-context';
import { beforeEach, afterEach } from 'vitest';

export interface FinanceHarness {
  storageMap: Map<string, string>;
  mountProvider: () => Promise<{
    getCtx: () => ReturnType<typeof useFinance>;
    root: any;
    container: any;
  }>;
}

export function setupFinanceHarness(): FinanceHarness {
  const harness: FinanceHarness = {
    storageMap: new Map<string, string>(),
    mountProvider: null as any,
  };

  const activeRoots: any[] = [];

  beforeEach(() => {
    class MockNode {
      nodeType = 1;
      childNodes: any[] = [];
      parentNode: any = null;
      ownerDocument: any = null;
      appendChild(child: any) { child.parentNode = this; this.childNodes.push(child); return child; }
      removeChild(child: any) { const idx = this.childNodes.indexOf(child); if (idx >= 0) this.childNodes.splice(idx, 1); return child; }
      insertBefore(child: any, ref: any) { const idx = this.childNodes.indexOf(ref); if (idx >= 0) this.childNodes.splice(idx, 0, child); else this.appendChild(child); return child; }
    }

    class MockElement extends MockNode {
      tagName = 'DIV';
      style = {};
      setAttribute() {}
      removeAttribute() {}
      addEventListener() {}
      removeEventListener() {}
    }

    const doc: any = new MockNode();
    doc.nodeType = 9;
    doc.defaultView = globalThis;
    doc.activeElement = null;
    doc.createElement = (tag: string) => {
      const el = new MockElement();
      el.tagName = tag.toUpperCase();
      el.ownerDocument = doc;
      return el;
    };
    doc.createElementNS = (_ns: string, tag: string) => doc.createElement(tag);
    doc.createTextNode = (val: string) => { const n: any = new MockNode(); n.nodeType = 3; n.nodeValue = val; n.ownerDocument = doc; return n; };
    doc.createComment = (val: string) => { const n: any = new MockNode(); n.nodeType = 8; n.nodeValue = val; n.ownerDocument = doc; return n; };
    doc.documentElement = doc.createElement('html');
    doc.head = doc.createElement('head');
    doc.body = doc.createElement('body');
    doc.addEventListener = () => {};
    doc.removeEventListener = () => {};

    (globalThis as any).document = doc;
    (globalThis as any).window = globalThis;
    (globalThis as any).Node = MockNode;
    (globalThis as any).Element = MockElement;
    (globalThis as any).HTMLElement = MockElement;
    (globalThis as any).HTMLIFrameElement = class extends MockElement {};
    (globalThis as any).HTMLInputElement = class extends MockElement {};
    (globalThis as any).HTMLTextAreaElement = class extends MockElement {};
    (globalThis as any).HTMLSelectElement = class extends MockElement {};
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

    harness.storageMap.clear();
    (globalThis as any).localStorage = {
      getItem: (k: string) => harness.storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => harness.storageMap.set(k, v),
      removeItem: (k: string) => harness.storageMap.delete(k),
      clear: () => harness.storageMap.clear(),
    };
  });

  afterEach(async () => {
    while (activeRoots.length > 0) {
      const root = activeRoots.pop();
      try {
        await act(async () => {
          root.unmount();
        });
      } catch {
        // cleanup silencioso
      }
    }
  });

  harness.mountProvider = async function mountProvider(): Promise<{
    getCtx: () => ReturnType<typeof useFinance>;
    root: any;
    container: any;
  }> {
    let currentCtx!: ReturnType<typeof useFinance>;
    function Consumer() {
      currentCtx = useFinance();
      return null;
    }

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);
    activeRoots.push(root);

    await act(async () => {
      root.render(React.createElement(FinanceProvider, null, React.createElement(Consumer)));
    });

    for (let i = 0; i < 25 && !currentCtx?.isLoaded; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }

    return { getCtx: () => currentCtx, root, container };
  };

  return harness;
}

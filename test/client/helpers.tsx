// @vitest-environment jsdom
/**
 * 客户端测试渲染助手：react-dom/client + act，jsdom 环境。
 * 断言一律走 DOM（textContent / className / style），禁快照。
 */
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Rendered {
  readonly container: HTMLDivElement;
  /** 全部文本（等价纯文本导出形态，用于灰度可读断言）。 */
  text(): string;
  unmount(): void;
}

export function render(element: ReactElement): Rendered {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return {
    container,
    text: () => container.textContent ?? '',
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

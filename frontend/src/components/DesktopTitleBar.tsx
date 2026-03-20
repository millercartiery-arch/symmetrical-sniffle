/* -----------------------------------------------------------------------
   src/components/DesktopTitleBar.tsx
   ----------------------------------------------------------------------- */
import React, { memo, useCallback, useEffect } from "react";
import { MinusOutlined, CloseOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../context/ThemeContext";
import "./DesktopTitleBar.css";

/**
 * 检测当前运行环境是否为 Tauri。
 * 在 SSR/Node 环境下安全访问 `window`。
 */
const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

/**
 * DesktopTitleBar Props
 *   - title: 需要在标题栏显示的文字，默认 “Cartier&Miller”
 *   - brandColor: 若不想使用 ThemeContext 的颜色，可直接传入
 */
interface DesktopTitleBarProps {
  title?: string;
  /** 覆盖 ThemeContext 中的 brandColor（可选） */
  brandColor?: string;
}

/**
 * 只在 Tauri 环境渲染。通过 CSS 变量 `--brand-color` 控制背景色，
 * 让样式文件保持干净，不必每次都在 JSX 中写 `style`.
 */
const DesktopTitleBar: React.FC<DesktopTitleBarProps> = ({
  title,
  brandColor,
}) => {
  const { t } = useTranslation();
  const { brandColor: themeBrandColor } = useTheme();

  // ---------- 颜色（优先级：prop > context > 默认） ----------
  const finalColor = brandColor ?? themeBrandColor ?? "#55616c";
  const finalTitle = title ?? t('brand.name', { defaultValue: 'Cartier&Miller' });

  // ---------- 按钮事件（动态加载 Tauri API，仅在 Tauri 环境执行，浏览器不加载） ----------
  const minimize = useCallback(async () => {
    if (!isTauri) return;
    const { appWindow } = await import("@tauri-apps/api/window");
    void appWindow.minimize().catch(console.error);
  }, []);

  const close = useCallback(async () => {
    if (!isTauri) return;
    const { appWindow } = await import("@tauri-apps/api/window");
    void appWindow.close().catch(console.error);
  }, []);

  const toggleMaximize = useCallback(async () => {
    if (!isTauri) return;
    const { appWindow } = await import("@tauri-apps/api/window");
    void appWindow.toggleMaximize().catch(console.error);
  }, []);

  // ---------- 键盘快捷键 ----------
  useEffect(() => {
    if (!isTauri) return;

    const handler = (e: KeyboardEvent) => {
      // Ctrl+M → 最小化
      if (e.ctrlKey && e.key === "m") {
        e.preventDefault();
        minimize();
        return;
      }
      // Ctrl+Shift+M → 最大化/还原
      if (e.ctrlKey && e.shiftKey && e.key === "M") {
        e.preventDefault();
        toggleMaximize();
        return;
      }
      // Alt+F4 → 关闭
      if (e.altKey && e.key === "F4") {
        e.preventDefault();
        close();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [minimize, close, toggleMaximize]);

  // ---------- 若不是 Tauri 环境直接返回 null ----------
  if (!isTauri) return null;

  return (
    <header
      className="desktop-titlebar"
      role="banner"
      // 把颜色写入 CSS 变量，CSS 中使用 var(--brand-color)
      style={{ "--brand-color": finalColor } as React.CSSProperties}
    >
      {/* ---- 拖拽区域（双击最大化） ---- */}
      <div
        className="desktop-titlebar__drag"
        data-tauri-drag-region
        onDoubleClick={toggleMaximize}
      >
        {/* 文字直接放在拖拽区域，这样双击文字也能触发 */}
        {finalTitle}
      </div>

      {/* ---- 控制按钮 ---- */}
      <div className="desktop-titlebar__controls">
        <button
          type="button"
          className="desktop-titlebar__btn"
          onClick={minimize}
          aria-label={t('desktop.minimize', { defaultValue: 'Minimize' })}
          title={`${t('desktop.minimize', { defaultValue: 'Minimize' })} (Ctrl+M)`}
        >
          <MinusOutlined />
        </button>

        <button
          type="button"
          className="desktop-titlebar__btn desktop-titlebar__btn--close"
          onClick={close}
          aria-label={t('desktop.close', { defaultValue: 'Close' })}
          title={`${t('desktop.close', { defaultValue: 'Close' })} (Alt+F4)`}
        >
          <CloseOutlined />
        </button>
      </div>
    </header>
  );
};

/* 使用 memo 防止父组件更新时不必要的重新渲染 */
export default memo(DesktopTitleBar);

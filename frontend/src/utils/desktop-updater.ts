export type DesktopUpdateInfo = {
  version?: string;
  date?: string;
  body?: string;
};

export type DesktopUpdateCheckResult = {
  supported: boolean;
  available: boolean;
  manifest?: DesktopUpdateInfo;
  error?: string;
};

export const isTauriRuntime = () =>
  typeof window !== 'undefined' && '__TAURI__' in window;

/** 获取当前应用版本（仅 Tauri 桌面端有效） */
export const getDesktopVersion = async (): Promise<string | null> => {
  if (!isTauriRuntime()) return null;
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return null;
  }
};

export const checkDesktopUpdate = async (): Promise<DesktopUpdateCheckResult> => {
  if (!isTauriRuntime()) {
    return { supported: false, available: false };
  }

  try {
    const { checkUpdate } = await import('@tauri-apps/api/updater');
    const result = await checkUpdate();

    return {
      supported: true,
      available: result.shouldUpdate,
      manifest: result.manifest
        ? {
            version: result.manifest.version,
            date: result.manifest.date,
            body: result.manifest.body,
          }
        : undefined,
    };
  } catch (error) {
    return {
      supported: true,
      available: false,
      error: error instanceof Error ? error.message : '检查更新失败',
    };
  }
};

export const installDesktopUpdate = async () => {
  const { installUpdate } = await import('@tauri-apps/api/updater');
  await installUpdate();
};

export const onDesktopUpdaterEvent = async (
  listener: (payload: { error?: string; status: string }) => void
) => {
  const { onUpdaterEvent } = await import('@tauri-apps/api/updater');
  return onUpdaterEvent(listener);
};

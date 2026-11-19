import type { AudioAPI, LocalizationAPI } from 'esengine';
import type { PageHost } from '../../framework/ui/pages';
import type { UIRouter } from '../../framework/ui/router';
import { defaults, openPreferences, type Preferences } from './preferences';

export function installSettings(host: PageHost, router: UIRouter, locale: LocalizationAPI, audio: AudioAPI,
  prefs: ReturnType<typeof openPreferences>, toast: (text: string) => void) {
  locale.addCatalog('zh', {
    settings: '设置', volume: '主音量', language: '语言 · 中文', normal: '字号 · 标准', large: '字号 · 大',
    reset: '恢复默认', resetTitle: '恢复默认设置？', resetBody: '音量、语言和字号将恢复到初始值。',
    cancel: '取消', saved: '设置已保存', locked: '此版本无法读取原设置，已保留存档。', writeError: '保存尚未确认 · 点击重试',
  });
  locale.addCatalog('en', {
    settings: 'Settings', volume: 'Volume', language: 'Language · English', normal: 'Text size · Standard',
    large: 'Text size · Large', reset: 'Reset defaults', resetTitle: 'Restore defaults?',
    resetBody: 'Restore the original volume, language and text size.', cancel: 'Cancel',
    saved: 'Settings saved', locked: 'Saved settings are protected and cannot be read by this version.',
    writeError: 'Save unconfirmed · Retry',
  });
  const apply = () => {
    audio.setMasterVolume(prefs.value.volume);
    locale.setLocale(prefs.value.language);
  };
  apply();
  let alive = true;
  let notice = prefs.readError ? 'locked' : '';
  const update = async (change: (value: Preferences) => Preferences) => {
    try {
      await prefs.update(change);
      notice = '';
    } catch (error) {
      notice = prefs.readError ? 'locked' : 'writeError';
      console.warn('[settings] device.settings', error);
    }
    if (!alive) return;
    apply();
    if (!notice) toast(locale.t('saved'));
    router.refresh();
  };
  const t = (key: string) => locale.t(key);
  const writable = () => !prefs.readError;
  const volume = (step: number) => update(v => ({ ...v,
    volume: Math.max(0, Math.min(10, Math.round(v.volume * 10) + step)) / 10 }));
  host.register({
    id: 'settings', asset: { prefab: 'assets/modules/settings/settings.esprefab' },
    bind: () => ({
      text: {
        SettingsTitle: () => t('settings'), Volume: () => t('volume') + '  ' + Math.round(100 * prefs.value.volume) + '%',
        Language: () => t('language'), TextSize: () => t(prefs.value.largeText ? 'large' : 'normal'),
        Reset: () => t('reset'), SettingsBack: () => t('back'), SaveStatus: () => notice ? t(notice) : '',
      },
      buttons: {
        Quieter: { enabled: writable, run: () => { void volume(-1); } }, Louder: { enabled: writable, run: () => { void volume(1); } },
        Language: { enabled: writable, run: () => { void update(v => ({ ...v, language: v.language === 'zh' ? 'en' : 'zh' })); } },
        TextSize: { enabled: writable, run: () => { void update(v => ({ ...v, largeText: !v.largeText })); } },
        Reset: { enabled: writable, run: () => { void router.open('resetSettings'); } }, SettingsBack: { run: () => router.back() },
        SaveStatus: { enabled: () => notice === 'writeError', run: () => { void update(v => v); } },
      },
    }),
  });
  host.register({
    id: 'resetSettings', layer: 'modal', asset: { prefab: 'assets/modules/settings/reset.esprefab' },
    bind: () => ({
      text: { ResetTitle: () => t('resetTitle'), ResetInfo: () => t('resetBody'),
        KeepSettings: () => t('cancel'), ConfirmReset: () => t('reset') },
      buttons: { KeepSettings: { run: () => router.back() },
        ConfirmReset: { run: () => { router.back(); void update(() => defaults); } } },
    }),
  });
  return () => { alive = false; };
}

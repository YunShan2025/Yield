import { useState } from "react";
import { createPortal } from "react-dom";
import { enable } from "@tauri-apps/plugin-autostart";
import { useAppStore } from "@/store/app";
import { isMobileShell } from "@/lib/platform";
import { AppIcon, type AppIconName } from "@/components/AppIcon";

const steps: {
  icon: AppIconName;
  title: string;
  body: string;
  hint: string;
}[] = [
  {
    icon: "today",
    title: "积微：把今天过好",
    body: "先收集，再从「今日」挑出真正要做的事；安排、专注、完成和收尾都在这一条线上。",
    hint: "每天从「今日」开始，只关注下一步",
  },
  {
    icon: "sparkle",
    title: "有恒：让进步看得见",
    body: "在「目标」里定方向、看进度，用「周报」回望这一周，「足迹」记下长期投入。钱流向哪里，则在「观澜」的收支总览里看清。",
    hint: "侧栏「有恒」中随时查看目标进度",
  },
  {
    icon: "layers",
    title: "目标、习惯、任务各司其职",
    body: "目标是一个长期结果，由任务与习惯的投入推着往前走；重复性的日常建习惯，它会出现在该出现的那一天；一次性的事建任务。",
    hint: "目标 ← 任务 + 习惯累计推进，三者互不替代",
  },
  {
    icon: "bell",
    title: "关掉窗口只是收进托盘",
    body: "点关闭只会放到托盘，不会退出，专注计时照常走。彻底退出请用托盘「退出应用」。建议开启开机自启，周报一类的周期任务更不容易漏。",
    hint: "彻底退出请用托盘菜单里的「退出应用」；可在设置中随时开关开机自启",
  },
];

// Android 壳没有系统托盘，开机自启也是桌面插件：最后一步换移动端文案，
// 「完成」按钮不再触发 autostart enable()（Android 未注册该插件）。
const mobileSteps = isMobileShell()
  ? steps.map((step) =>
      step.icon === "bell"
        ? {
            ...step,
            title: "专注计时不怕退到后台",
            body: "应用退到后台计时照常走；跑完后回到专注页，把这一段记成已完成任务。",
            hint: "被系统强行退出时计时会暂停，重新打开后可在专注页继续",
          }
        : step,
    )
  : steps;

export function OnboardingGuide() {
  const complete = useAppStore((state) => state.settings.onboardingComplete);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  if (complete || dismissed) return null;
  const current = mobileSteps[step];
  const last = step === mobileSteps.length - 1;

  const finish = (enableAutostart = false) => {
    setDismissed(true);
    void (async () => {
      if (enableAutostart) {
        try {
          await enable();
          await updateSettings({ autostart: true, onboardingComplete: true });
          return;
        } catch {
          /* keep going even if OS autostart is denied */
        }
      }
      await updateSettings({ onboardingComplete: true });
    })();
  };

  return createPortal(
    <div className="onboarding-backdrop" role="dialog" aria-modal="true">
      <section className="onboarding-card">
        <div className="onboarding-icon">
          <AppIcon name={current.icon} size={25} />
        </div>
        <span className="onboarding-step">
          {step + 1} / {steps.length}
        </span>
        <h2>{current.title}</h2>
        <p>{current.body}</p>
        <div className="onboarding-hint">{current.hint}</div>
        <div className="onboarding-dots">
          {mobileSteps.map((_, index) => (
            <span key={index} className={index === step ? "active" : ""} />
          ))}
        </div>
        <footer>
          <button type="button" className="btn-ghost" onClick={() => finish(false)}>
            {last ? "暂不开启" : "跳过"}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              if (!last) {
                setStep((value) => value + 1);
                return;
              }
              finish(!isMobileShell());
            }}
          >
            {last ? (isMobileShell() ? "开始使用" : "开启开机自启并开始") : "下一步"}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

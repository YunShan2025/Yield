package com.yunshan.youqiu

import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.view.WindowInsets
import android.webkit.WebView

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Debug 构建开放 WebView DevTools，供 adb forward 后用 CDP 做界面自动化验收。
    if (BuildConfig.DEBUG) {
      WebView.setWebContentsDebuggingEnabled(true)
    }
    super.onCreate(savedInstanceState)
  }

  override fun onContentChanged() {
    super.onContentChanged()
    // targetSdk 36 在 Android 15+ 上被系统强制 edge-to-edge（无法 opt-out），
    // WebView 会全屏铺到系统栏底下。这里把「左右/键盘」inset 转成内容区
    // padding；顶部 inset 不再消费——WebView 直通状态栏底下，由页面自身
    // 用 env(safe-area-inset-top) 让出高度，页面底色（含主题渐变）直通
    // 状态栏，不再有原生窗口背景与页面底色之间的分界线（真机验收反馈）。
    // 键盘弹出时 ime inset 并入 bottom，等效 adjustResize。
    // 仅 SDK 35+ 生效：低版本由系统按非 edge-to-edge 自行留白，
    // 再补 padding 会双重收缩。
    if (Build.VERSION.SDK_INT < 35) return
    // wry 由 Rust 侧 setContentView(webview)，onContentChanged 触发时内容视图已就位。
    val content = findViewById<ViewGroup>(android.R.id.content)
    content.setOnApplyWindowInsetsListener { v, insets ->
      val bars = insets.getInsets(
        WindowInsets.Type.systemBars()
          or WindowInsets.Type.displayCutout()
          or WindowInsets.Type.ime()
      )
      v.setPadding(bars.left, 0, bars.right, bars.bottom)
      insets
    }
  }

  override fun onBackPressed() {
    // 返回键退到后台而非销毁 Activity：进程内提醒调度继续走，
    // 计划通知（AlarmManager）也不受影响；符合「返回=收起应用」的移动直觉。
    moveTaskToBack(true)
  }
}

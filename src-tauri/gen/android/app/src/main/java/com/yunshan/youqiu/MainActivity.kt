package com.yunshan.youqiu

import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.inputmethod.InputMethodManager
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
    // WebView 会全屏铺到系统栏底下。这里把系统栏/刘海/键盘 inset 全部转成
    // 内容区 padding：视口从状态栏下方开始，页面内容永远不会顶进状态栏
    // （真机验收第二轮反馈）。曾试过「顶部不消费 + 页面 env(safe-area-inset-top)
    // 让位」，但 env() 在部分设备/WebView 上求值为 0（无刘海机型），标题会
    // 顶进状态栏，且滚动容器上的 padding 会随内容滚走。状态栏区域露出的
    // 是 windowBackground（colors.xml 已对齐页面底色），无缝无分界线。
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
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      insets
    }
  }

  override fun onBackPressed() {
    // 返回键语义（真机第三轮反馈：从「更多」进入子页后按返回应回「更多」，
    // 而不是整个退到后台）。接管后系统默认行为需自理：
    // ① 键盘开着→先收键盘；② 询问前端 __youqiuAndroidBack，返回 "handled"
    //    表示已消费（回「更多」/收起面板）；③ 否则退后台（原行为）。
    // 进程不销毁，应用内提醒调度与 AlarmManager 计划通知不受影响。
    val focused = currentFocus
    if (focused != null) {
      val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
      if (imm.isActive && imm.hideSoftInputFromWindow(focused.windowToken, 0)) {
        focused.clearFocus()
        return
      }
    }
    val webview = findWebView(findViewById(android.R.id.content))
    if (webview == null) {
      moveTaskToBack(true)
      return
    }
    webview.evaluateJavascript(
      "(window.__youqiuAndroidBack && window.__youqiuAndroidBack()) || ''",
    ) { result ->
      if (result != "\"handled\"") moveTaskToBack(true)
    }
  }

  private fun findWebView(view: View?): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        findWebView(view.getChildAt(i))?.let { return it }
      }
    }
    return null
  }
}

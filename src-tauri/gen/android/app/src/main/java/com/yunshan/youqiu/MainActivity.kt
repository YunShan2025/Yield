package com.yunshan.youqiu

import android.os.Bundle
import android.webkit.WebView

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Debug 构建开放 WebView DevTools，供 adb forward 后用 CDP 做界面自动化验收。
    if (BuildConfig.DEBUG) {
      WebView.setWebContentsDebuggingEnabled(true)
    }
    // 不开 edge-to-edge：WebView 停留在状态栏下方，避免 Chrome 83 安全区 env() 缺失导致内容被状态栏遮挡；
    // 键盘伸缩沿用默认 adjustResize。深色状态栏等外观定制留待 M3。
    super.onCreate(savedInstanceState)
  }
}

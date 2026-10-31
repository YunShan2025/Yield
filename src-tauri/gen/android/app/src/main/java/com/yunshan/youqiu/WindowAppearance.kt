package com.yunshan.youqiu

import android.app.Activity
import android.content.Context
import android.graphics.Color
import androidx.core.view.WindowInsetsControllerCompat

// 系统栏带与在应用主题同源（实机反馈：系统深色 + 应用浅色时，状态栏一带露出
// 的是 native DayNight 的窗口底色，和浅色应用割裂成一条黑带——DayNight 只认
// 系统深浅色，应用内主题是独立选择的）。
// 前端把解析后的 --surface-base 与明暗档经 set_window_appearance 命令（JNI）
// 传进来：贴住窗口背景（MainActivity 的 inset padding 内收内容后露出的即它），
// 图标色随底色翻。结果缓存进 SharedPreferences，下次进程首帧前由
// MainActivity.restore 恢复，杜绝重启时的底色闪变。
object WindowAppearance {
    private const val PREFS = "window_appearance"
    private const val KEY_COLOR = "background_color"
    private const val KEY_LIGHT = "light_background"

    @JvmStatic
    fun apply(activity: Activity, colorHex: String, lightBackground: Boolean) {
        val color = try {
            Color.parseColor(colorHex)
        } catch (e: IllegalArgumentException) {
            // 解析不出实色（如 glass 主题 --surface-base 为 transparent）就不动原生层。
            return
        }
        paint(activity, color, lightBackground)
        activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putInt(KEY_COLOR, color)
            .putBoolean(KEY_LIGHT, lightBackground)
            .apply()
    }

    /** 首帧前恢复上次的应用内观感；无缓存（首次启动）时保持主题的 DayNight 默认。 */
    @JvmStatic
    fun restore(activity: Activity) {
        val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!prefs.contains(KEY_COLOR)) return
        paint(
            activity,
            prefs.getInt(KEY_COLOR, Color.TRANSPARENT),
            prefs.getBoolean(KEY_LIGHT, true),
        )
    }

    private fun paint(activity: Activity, color: Int, lightBackground: Boolean) {
        activity.window.decorView.setBackgroundColor(color)
        val controller = WindowInsetsControllerCompat(activity.window, activity.window.decorView)
        controller.isAppearanceLightStatusBars = lightBackground
        controller.isAppearanceLightNavigationBars = lightBackground
    }
}

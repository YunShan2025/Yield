# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# --- JNI 反射入口保活（release 启动闪退修复）---
# 以下 Kotlin object 的 @JvmStatic 方法只被 Rust 经 wry::prelude::dispatch 在主线程用
# env.call_static_method("apply"/"read", ...) 反射调用，字节码里没有任何静态引用。
# proguard-wry.pro 的 `-keep class com.yunshan.youqiu.* { native <methods>; }` 只保类名、
# 不保这类非 native 的普通方法，release 构建里 R8 会把 apply/read 改名或删掉。结果：启动时
# 前端 applyTheme → set_window_appearance → JNI 找不到 apply，主线程抛 NoSuchMethodError
# （JS 的 try/catch 与 Rust 的 map_err 都拦不住——invoke 还没返回，进程已死），每次启动闪退；
# BackupContentReader.read 同理会在导入备份时崩。整类成员保活，锁死反射入口的名字与存在性。
# 改动这类反射助手后务必用 release APK 真机/模拟器复验一次。
-keep class com.yunshan.youqiu.WindowAppearance { *; }
-keep class com.yunshan.youqiu.BackupContentReader { *; }

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
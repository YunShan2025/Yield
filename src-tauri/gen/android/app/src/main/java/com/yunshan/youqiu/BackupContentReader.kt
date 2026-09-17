package com.yunshan.youqiu

import android.content.Context
import android.net.Uri

// 备份导入兜底通道：系统文件选择器（SAF）返回的是 content:// URI，
// Rust 的 std::fs 读不了，须经 ContentResolver 打开输入流。
// 供 src-tauri/src/lib.rs 的 read_backup_file 通过 JNI 调用。
object BackupContentReader {
    @JvmStatic
    fun read(context: Context, uri: String): String? {
        return try {
            context.contentResolver
                .openInputStream(Uri.parse(uri))
                ?.bufferedReader(Charsets.UTF_8)
                ?.use { it.readText() }
        } catch (e: Exception) {
            null
        }
    }
}

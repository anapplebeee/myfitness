# R8 规则。
#
# release 构建已开启 minifyEnabled + shrinkResources，必须有这些 keep，
# 否则 Capacitor 的 JS 桥接会被裁剪，表现为"界面能开但所有原生调用静默失效"
# ——这类问题在 debug 构建里完全看不到，只在发布包里出现。

# Capacitor 通过反射调用 @JavascriptInterface 标注的方法
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Capacitor 插件与桥接类
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class com.getcapacitor.plugin.** { *; }

# 插件通过类名反射实例化
-keepnames class * extends com.getcapacitor.Plugin

# WebView 的 JS 接口对象（Capacitor 会按名字查找）
-keepclassmembers class com.getcapacitor.Bridge {
    public *;
}

# 保留行号，便于线上崩溃定位；同时隐藏原始文件名
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# 不打印第三方库的配置警告噪声，但保留错误
-dontwarn com.getcapacitor.**

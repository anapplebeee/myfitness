package com.tieguan.fit;

import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

/**
 * 铁馆主 Activity。
 *
 * 只做一件事：让 Android 返回键符合 Web 应用的习惯。
 *
 * 默认行为是直接退出应用——用户在「训练 → 历史 → 某场详情」里按返回，
 * 会一路退到桌面，而不是回到上一页。这是 WebView 应用最常见的体验缺陷。
 *
 * 规则：
 *   WebView 还能后退 → 后退一页
 *   已经到首页      → 交给系统（退出）
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onBackPressed() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;

        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }

        super.onBackPressed();
    }
}

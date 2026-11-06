# 图谱金库 Graph Vault · 演示站

本地可点击预览（模拟账本，非主网）。

## 打开

```bash
cd /workspace/tianxin/demos/graph-vault
python3 -m http.server 8765 --bind 127.0.0.1
```

浏览器打开：http://127.0.0.1:8765/

或直接双击 `index.html`（部分浏览器对 `file://` 限制剪贴板，建议用本地 server）。

## 可点什么

- **图谱入口买入**：调金额点亮自己的节点；10s 内接力可连边（演示窗缩短）
- **我有 Agent ID**：亮度写入 +20%
- **侦察 / 接力 / 补光**：看指令文案，可「按此模板演示买入」
- **推进到下一结算**：按 60/25/15 三池分税；亮度低于静默线则「网络休眠」滚存
- **领取**：清零演示钱包可领余额

文件：`index.html` + `style.css` + `app.js`，无 CDN 依赖。

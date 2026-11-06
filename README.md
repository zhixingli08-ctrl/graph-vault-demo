# 图谱金库 Graph Vault · 演示站

可点击预览（模拟账本，非主网）。暗底活图 + 三池分税 + Agent 指令模板。

## 公网预览（给老板直接打开）

推荐（相对路径 CSS/JS 正常）：

- **https://raw.githack.com/zhixingli08-ctrl/graph-vault-demo/main/index.html**
- 备用 CDN：https://cdn.jsdelivr.net/gh/zhixingli08-ctrl/graph-vault-demo@main/index.html
- 源码仓库：https://github.com/zhixingli08-ctrl/graph-vault-demo

## 本地打开

```bash
cd /workspace/tianxin/demos/graph-vault
python3 -m http.server 8767 --bind 127.0.0.1
```

浏览器：http://127.0.0.1:8767/（仅本机 box，老板打不开）

## 可点什么

- **图谱入口买入**：调金额点亮节点；演示窗 10s 内接力连边
- **我有 Agent ID**：亮度写入 +20%
- **侦察 / 接力 / 补光**：指令文案 + 按模板演示买入
- **推进到下一结算**：60/25/15 三池分税；低于静默线则网络休眠滚存
- **领取**：清零演示钱包可领

文件：`index.html` + `style.css` + `app.js`，无 CDN 依赖。

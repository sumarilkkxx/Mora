# 本地 API 接入

API 只默认接受同源浏览器请求。外部浏览器工具需要在启动 Mora 服务前设置
`MORA_ALLOWED_ORIGINS`，多个完整来源用逗号分隔，例如
`http://localhost:3800,http://127.0.0.1:5173`。协议、主机和端口必须匹配。
不再自动信任所有 localhost 端口。写入请求使用 `application/json` 或上传所需的
`multipart/form-data`；跨源简单表单请求会返回 403。

桌面版每次启动生成新的 API 凭据，保存到 Electron userData 目录的 `api-token`。
应用窗口自动携带凭据；CLI 使用 `MORA_API_TOKEN` 环境变量，通过 `x-mora-token`
请求头发送。将 `MORA_BASE_URL` 设为桌面服务地址，并从该文件读取当前令牌，
即可继续使用 `node bin/mora.mjs`。桌面重启后需重新读取令牌。不要提交或分享此文件。

自行启动 Web 服务时，`MORA_API_TOKEN` 可选。启用后所有 API 请求都需要该请求头，
并设置 `MORA_SERVER_ORIGIN` 为服务的完整来源，以便服务端流水线安全调用自身。
普通浏览器不自动注入自定义 Web 服务的令牌，需要通过受控客户端或反向代理接入。

`HEADLESS_SMOKE=1` 的桌面检查只有在健康接口和项目接口均成功、数据库初始化和
迁移正常时才输出 `SMOKE_OK` 并退出 0；失败输出 `SMOKE_FAILED` 或启动错误并退出 1。

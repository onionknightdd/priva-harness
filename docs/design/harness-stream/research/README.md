# 研究与编写过程归档

- [harness-response-reference.md](harness-response-reference.md)：返回对象与增量字段的研究底稿，内容已整合进 [最新 API 参考](../api/harness-http-api-reference.md)；不是另一个并行维护的协议版本。
- `authoring/build-harness-stream-v3.py.txt`：旧版 Schema 与样例的生成过程。
- `authoring/write-harness-stream-v3-docs.py.txt`：旧类型和文档的生成、改写过程。
- `authoring/build-harness-reference-data.py.txt`：站点数据初次生成过程；之后的人工修订以当前 `site/src/data/reference.json` 为准。

三个历史脚本按原始内容保存为 `.txt`，仅作过程记录，不参与安装、构建或测试。它们保留当时的路径与写文件逻辑，不能当作当前目录下的再生成命令，否则会覆盖后续修订。

可重跑的验证脚本位于 [../tests/](../tests/)，旧版类型及示例位于 [../tests/fixtures/legacy/](../tests/fixtures/legacy/)。

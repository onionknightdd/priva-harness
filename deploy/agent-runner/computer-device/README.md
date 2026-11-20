# Mac 设备接入 Runner

Mac 托盘主动连接 Runner 上的 SSH 子系统 `priva-computer`。这个子系统由普通 Runner 用户运行的 Node.js 进程和 `ssh2` 提供，下文称设备服务。每台设备使用独立的 Ed25519 公钥登记。连接后，会话可以通过 `computer-use` 插件的 `registered_computers` 工具在那台 Mac 上运行桌面 worker，读取和操作它的应用。

```text
建立连接     Mac 托盘 ───── SSH 公钥认证 ──────> Runner Pod 中的设备服务
工具调用     Claude / Pi → registered_computers.js(deviceId, code)
                            → 私有 Unix socket → 设备服务 → SSH 通道
                            → 托盘 → 那台 Mac 上的桌面 worker → Mac 应用
```

SSH 用户名固定为 `device`。服务端以登记的公钥确定设备 ID，Mac 上报的名称供界面显示。服务只接受指定子系统，拒绝 shell、exec、SFTP、PTY 和端口转发。Mac 锁屏时可以报告状态，但不能启动 worker；锁屏会立即结束正在运行的 worker。一台 Mac 同一时刻只服务一个会话。协议和实现见 [Computer Use 的实现](../../../docs/architecture/computer-use-migration.md#远程设备)。

目前那台 Mac 上必须安装 ChatGPT 桌面应用并保持它运行，否则登记成功但所有桌面操作失败。这是待解决的问题，见 [待办：Mac 脱离 ChatGPT](../../../docs/architecture/computer-use-migration.md#待办mac-脱离-chatgpt)。

## 在 minikube 中配置

从仓库根目录运行现有的 `bash deploy/agent-runner/dev.sh build` 和 `bash deploy/agent-runner/dev.sh deploy`，得到包含设备服务和运行时依赖的 Linux 镜像。Runner 启动脚本支持下列环境变量。

| 变量 | 值 |
|---|---|
| `PRIVA_COMPUTER_HOST_KEY` | Pod 内 SSH 服务端 Ed25519 私钥的绝对路径 |
| `PRIVA_COMPUTER_DEVICES` | Pod 内设备公钥登记文件的绝对路径 |
| `PRIVA_COMPUTER_DIR` | 同 UID 的 MCP 服务和设备服务共享的本地目录，权限 `0700`。默认位于容器临时目录 |
| `PRIVA_COMPUTER_BIND_ADDRESS` | 设备 SSH 监听的 IP，默认为 `127.0.0.1`。使用下方 ClusterIP Service 时需监听 Pod IP 或 `0.0.0.0` |
| `PRIVA_COMPUTER_PORT` | 设备 SSH 端口，默认 `2222`，与 Service 的 `targetPort` 对应 |

前两项成对配置，设置后随容器入口启动。服务进程须能以自己的 UID 读取私钥和登记文件。将两者存为权限 `0600` 或 `0400` 的普通文件。如果集群用 Secret 投递材料，先由初始化步骤将其复制到仅 Runner 用户可访问的目录，提供正确属主和权限。私钥放在部署系统或对应设备上。Git 只记录配置方式和路径。

下列命令演示在开发环境登记**新建的测试身份**。服务端文件存在当前项目的持久卷，以便配置生效时能跨 Pod 重建。先准备独立目录，再生成测试主机和设备密钥。用同一个 shell 完成这一组命令。

```bash
k=(kubectl --context minikube -n priva-harness-dev)
umask 077
test_dir=$(mktemp -d)
ssh-keygen -q -t ed25519 -N '' -f "$test_dir/device"

device_dir=$("${k[@]}" exec deployment/agent-runner -- mktemp -d /data/home/computer-proof.XXXXXX)
"${k[@]}" exec deployment/agent-runner -- ssh-keygen -q -t ed25519 -N '' -f "$device_dir/host_key"
node -e 'const fs = require("node:fs"); console.log(JSON.stringify({"test-mac":fs.readFileSync(process.argv[1],"utf8").trim()}))' "$test_dir/device.pub" |
  "${k[@]}" exec -i deployment/agent-runner -- sh -c 'umask 077; cat > "$1/devices.json"' sh "$device_dir"

"${k[@]}" set env deployment/agent-runner \
  PRIVA_COMPUTER_HOST_KEY="$device_dir/host_key" \
  PRIVA_COMPUTER_DEVICES="$device_dir/devices.json" \
  PRIVA_COMPUTER_DIR=/tmp/priva-computer-control
"${k[@]}" rollout status deployment/agent-runner
```

`set env` 会重启此开发 Deployment。已有设备登记的环境可在其登记文件中加入设备公钥并重启设备服务，保留原有主机密钥和其他设备条目。相同公钥不能登记给多个设备 ID。登记文件在服务启动时读取。

公司部署可以通过内网 TCP 入口接入设备。先配置上表中的密钥和设备登记文件，将 `PRIVA_COMPUTER_BIND_ADDRESS` 设为 Pod IP 或 `0.0.0.0`，然后应用配套的集群内 Service。该 Service 的 DNS 名称为 `agent-runner-computer.priva-harness-dev.svc`。集群外的 Mac 使用公司内网可路由的 TCP 地址，SSH 配置固定设备服务自己的主机公钥。这样 Mac 只需有自己的 SSH 设备身份。

```text
Mac tray --SSH--> private TCP endpoint --> ClusterIP:2222 --> Pod device subsystem
                                                             |
                                                   registered device channel
                                                             |
                                 Runner MCP <-- private Unix socket in same Pod
```

```bash
kubectl --context minikube -n priva-harness-dev apply -f deploy/agent-runner/computer-device/service.yaml
```

在另一个终端开启本机回环转发。端口冲突时可更换左侧的 `18222`，并同步修改下方 SSH 配置。Pod 替换后需要重新建立转发。

```bash
kubectl --context minikube -n priva-harness-dev port-forward --address 127.0.0.1 deployment/agent-runner 18222:2222
```

返回先前 shell，通过已有的 Kubernetes 管理连接取得服务端公钥，用它固定 SSH 主机身份。测试配置只引用这个临时身份，保存在刚才创建的私有目录中。

```bash
host_public=$("${k[@]}" exec deployment/agent-runner -- cat "$device_dir/host_key.pub")
printf '[127.0.0.1]:18222 %s\n' "$host_public" > "$test_dir/known_hosts"
cat > "$test_dir/ssh_config" <<CONFIG
Host priva-computer-test
    HostName 127.0.0.1
    Port 18222
    User device
    IdentityFile "$test_dir/device"
    IdentitiesOnly yes
    IdentityAgent none
    StrictHostKeyChecking yes
    UserKnownHostsFile "$test_dir/known_hosts"
    GlobalKnownHostsFile /dev/null
    ClearAllForwardings yes
    RequestTTY no
CONFIG
```

按 [Mac 托盘说明](../../../apps/computer-tray-macos/README.md) 构建应用，然后用测试配置启动同一连接实现。

```bash
bundle="$PWD/apps/computer-tray-macos/dist/Priva Computer.app"
"$bundle/Contents/MacOS/PrivaComputerTray" --smoke \
  --host priva-computer-test --ssh-config "$test_dir/ssh_config" \
  --launcher "$bundle/Contents/Resources/cua-repl.mjs"
```

## 验证与退出

在会话里勾选 Computer Use 插件，通过 `registered_computers` 调用 `list_devices`、`device_status`，再用 `js` 操作那台 Mac。也可以在同一个 Pod 内不经模型检查设备。这里的 `test-mac` 来自登记文件，需与配置保持一致。

```bash
k=(kubectl --context minikube -n priva-harness-dev exec deployment/agent-runner --)
"${k[@]}" node dist/infrastructure/computer/cli.js list
"${k[@]}" node dist/infrastructure/computer/cli.js status test-mac
# 在那台 Mac 上打开计算器并读回窗口内容，不发送输入
"${k[@]}" node --import tsx tests/deployment/computer-device-smoke.ts app test-mac Calculator
```

`list` 显示当前在线设备。连接中断、Mac 锁屏或 worker 退出时，正在进行的调用会带着原因失败，未收到回执的动作结果未知；那台 Mac 上的 JavaScript 绑定随 worker 一起消失，重新连接后从入口调用重新开始。

退出测试托盘并停止本地端口转发。对于用上述步骤新建的专用测试配置，用 `kubectl set env` 删除该 Deployment 的三个测试环境变量，等待重启完成，然后删除该次新建的 `device_dir` 和本机 `test_dir`。已有部署按其原配置恢复。仓库内的自动化检查会自行生成和清除临时密钥，从 `services/agent-runner/ts/` 运行：

```bash
TMPDIR=/tmp npx vitest run tests/unit/infrastructure/computer tests/integration/infrastructure/computer
```

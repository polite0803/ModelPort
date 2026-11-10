#!/usr/bin/env bash
#
# 用仓库里刚构建的产物覆盖本机 WSL 的网关安装，并重启 systemd 单元。
#
# 用法（必须 root：要写安装目录并操作 system 作用域单元）：
#   npm run build && npm run build:daemon
#   sudo bash scripts/deploy-wsl-daemon.sh
#
# 可覆盖的环境变量：
#   MODELPORT_UNIT          systemd 单元名（默认 modelport）
#   MODELPORT_INSTALL_DIR   安装目录（默认取单元 ExecStart 指向的 bundle 所在目录）
#   MODELPORT_HEALTH_URL    部署后探活的地址（默认 http://127.0.0.1:8080/health）
#   MODELPORT_BACKUP        1 = 替换前备份安装目录（默认不备份；仅在备份时才有自动回滚）
#
# 安装目录里的数据（~/.modelport）不在本脚本的作用范围内：它从来不被替换，
# 回滚也只恢复程序与资源，不碰台账。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${REPO_ROOT}/out/daemon"
UNIT="${MODELPORT_UNIT:-modelport}"
HEALTH_URL="${MODELPORT_HEALTH_URL:-http://127.0.0.1:8080/health}"

die() { echo "deploy: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "需要 root：sudo bash $0"

[ -f "${SRC_DIR}/modelport-daemon.cjs" ] || die "缺少 ${SRC_DIR}/modelport-daemon.cjs —— 先跑 npm run build && npm run build:daemon"
[ -d "${SRC_DIR}/resources/channel-pack" ] || die "缺少 ${SRC_DIR}/resources/channel-pack —— 渠道包没构建"
[ -f "${SRC_DIR}/renderer/index.html" ] || die "缺少 ${SRC_DIR}/renderer/index.html —— 界面没构建"

# 安装目录：优先环境变量，其次从单元里现读，避免把上一次手工部署的路径当成契约。
unit_exec_line() {
  systemctl cat "${UNIT}" 2>/dev/null | sed -n 's/^ExecStart=//p' | head -n 1
}

resolve_install_dir() {
  if [ -n "${MODELPORT_INSTALL_DIR:-}" ]; then
    printf '%s\n' "${MODELPORT_INSTALL_DIR}"
    return
  fi
  local exec_line bundle
  exec_line="$(unit_exec_line)"
  [ -n "${exec_line}" ] || die "读不到 ${UNIT} 单元的 ExecStart（单元不存在？）"
  bundle="${exec_line##* }"
  [ -e "${bundle}" ] || die "单元指向的 bundle 不存在：${bundle}"
  bundle="$(readlink -f "${bundle}")"
  dirname "${bundle}"
}

INSTALL_DIR="$(resolve_install_dir)"
[ -d "${INSTALL_DIR}" ] || die "安装目录不存在：${INSTALL_DIR}"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${INSTALL_DIR}.bak-${STAMP}"
ROLLBACK=0

restore() {
  [ "${ROLLBACK}" -eq 1 ] || return 0
  echo "deploy: 回滚到 ${BACKUP_DIR}" >&2
  rm -rf "${INSTALL_DIR}"
  cp -a "${BACKUP_DIR}" "${INSTALL_DIR}"
}

echo "deploy: 单元 ${UNIT} / 安装目录 ${INSTALL_DIR}"

# 停服先于备份：否则备份里是正在运行的旧进程读取的那份文件，语义没关系，
# 但停服期间替换才不会被内存里的旧代码掩盖问题。
systemctl stop "${UNIT}" 2>/dev/null || true

if [ "${MODELPORT_BACKUP:-0}" = "1" ]; then
  cp -a "${INSTALL_DIR}" "${BACKUP_DIR}"
  ROLLBACK=1
  trap 'rc=$?; restore; exit $rc' EXIT
  echo "deploy: 备份 ${BACKUP_DIR}（MODELPORT_BACKUP=1）"
fi

install -m 0644 "${SRC_DIR}/modelport-daemon.cjs" "${INSTALL_DIR}/modelport-daemon.cjs"
rm -rf "${INSTALL_DIR}/resources" "${INSTALL_DIR}/renderer"
cp -a "${SRC_DIR}/resources" "${INSTALL_DIR}/resources"
cp -a "${SRC_DIR}/renderer" "${INSTALL_DIR}/renderer"

systemctl start "${UNIT}"

for _ in $(seq 1 30); do
  if systemctl is-active --quiet "${UNIT}" &&
     curl -sf -m 2 -o /dev/null "${HEALTH_URL}"; then
    ROLLBACK=0
    trap - EXIT
    echo "deploy: 完成，${UNIT} 已重启（$(systemctl show "${UNIT}" -p ActiveEnterTimestamp --value)）"
    curl -s -m 2 "${HEALTH_URL}" || true
    echo
    exit 0
  fi
  sleep 1
done

if [ "${ROLLBACK}" -eq 1 ]; then
  echo "deploy: 服务未在 30s 内通过 ${HEALTH_URL}，回滚到 ${BACKUP_DIR}" >&2
  systemctl stop "${UNIT}" 2>/dev/null || true
  restore
  ROLLBACK=0
  trap - EXIT
  systemctl start "${UNIT}" 2>/dev/null || true
else
  echo "deploy: 服务未在 30s 内通过 ${HEALTH_URL}（本次未备份，没有可回滚内容）" >&2
fi
journalctl -u "${UNIT}" -n 40 --no-pager >&2 || true
exit 1